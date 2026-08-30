// Pure session rules. Nothing here touches the network — the same functions
// run in Server Actions, Server Components and the browser, which is what
// lets a serverless stack enforce deadlines without a cron.

// 30s was sized for a teacher already looking at the screen. Waking a locked
// phone does not fit inside it: delivery, noticing, unlocking, tapping. This
// is a DEADLINE, not a wait — a teacher who accepts in two seconds still
// resolves in two seconds, so the fast path costs nothing.
export const ACCEPT_WINDOW_SECONDS = 60;
export const SESSION_DURATION_MINUTES = 60;
// Daily rooms and meeting tokens expire this long after a session should
// have ended. Long enough that a call cannot die mid-lesson (design spec §9),
// short enough that the room itself caps a client with a slow clock — the
// in-call countdown runs on Date.now() and is not an authority.
export const ROOM_GRACE_MINUTES = 15;

// How long a student has to pay once their teacher has accepted. Deliberately
// more generous than the 60s accept window because checkout means leaving the
// app — a UPI flow is an app switch, an authentication and a PIN. It is also
// the number most likely to need tuning against real data, and it is in direct
// tension with how long a teacher will sit waiting (design spec §3.2).
export const PAYMENT_WINDOW_SECONDS = 120;

export type SessionStatus =
  | "pending" | "accepted" | "paid" | "active"
  | "completed" | "declined" | "timed_out" | "cancelled"
  | "payment_expired" | "refunded";

const TERMINAL: readonly SessionStatus[] = [
  "completed", "declined", "timed_out", "cancelled",
  "payment_expired", "refunded",
];

// Mirrors the transition table in the M3 design spec §3.1, which migration
// 0005's trigger enforces. The two removals matter as much as the additions:
// `pending -> active` and `accepted -> active` are GONE, because accept no
// longer produces a room. The only route to `active` is through `paid`, and
// only the service role can make that move.
const ALLOWED: Record<SessionStatus, readonly SessionStatus[]> = {
  pending: ["accepted", "declined", "timed_out", "cancelled"],
  accepted: ["paid", "payment_expired", "cancelled"],
  paid: ["active", "refunded"],
  active: ["completed"],
  completed: [],
  declined: [],
  timed_out: [],
  cancelled: [],
  payment_expired: [],
  refunded: [],
};

export function acceptDeadlineFrom(createdAt: Date): Date {
  return new Date(createdAt.getTime() + ACCEPT_WINDOW_SECONDS * 1000);
}

export function paymentDeadlineFrom(acceptedAt: Date): Date {
  return new Date(acceptedAt.getTime() + PAYMENT_WINDOW_SECONDS * 1000);
}

// What the student is charged, in paise. Rounded to whole rupees first so no
// fraction of a paise can ever reach the money column, and so checkout and
// the webhook's amount check cannot disagree by a rounding step — they both
// call this. hourly_rate is the snapshot taken at request time, which
// migration 0003 already makes immutable.
export function amountPaiseFor(
  hourlyRate: number,
  durationMinutes: number
): number {
  return Math.round((hourlyRate * durationMinutes) / 60) * 100;
}

export function secondsRemaining(deadline: string | Date, now: Date): number {
  const end = typeof deadline === "string" ? new Date(deadline) : deadline;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 1000));
}

// The single source of truth for "what is this row really?". A pending row
// past its deadline is timed out and an active row past its hour is complete,
// whatever the stored column says — this is what stops a stale row from being
// accepted later, or a teacher from being stuck out of the online list.
export function effectiveStatus(
  row: {
    status: SessionStatus;
    accept_deadline: string | null;
    payment_deadline: string | null;
    started_at: string | null;
    duration_minutes: number;
  },
  now: Date
): SessionStatus {
  if (TERMINAL.includes(row.status)) return row.status;

  if (row.status === "pending" && row.accept_deadline) {
    if (secondsRemaining(row.accept_deadline, now) === 0) return "timed_out";
  }

  // The second deadline, same mechanism as the first: a student who accepted
  // the price but never paid must release their teacher without a timer.
  if (row.status === "accepted" && row.payment_deadline) {
    if (secondsRemaining(row.payment_deadline, now) === 0) return "payment_expired";
  }

  if (row.status === "active" && row.started_at) {
    const endsAt =
      new Date(row.started_at).getTime() + row.duration_minutes * 60_000;
    if (now.getTime() >= endsAt) return "completed";
  }

  return row.status;
}

// The shape every caller needs to ask "what is this row really?" — the exact
// columns effectiveStatus reads, plus the id so a caller can act on the answer.
export interface SessionTimingRow {
  id: string;
  status: SessionStatus;
  accept_deadline: string | null;
  payment_deadline: string | null;
  started_at: string | null;
  duration_minutes: number;
}

// A row is only genuinely live if it is still active AND carries the clock the
// read-time rule needs. acceptSession always writes started_at in the same
// update that sets `active`, so an active row without one was not produced by
// this application; treating it as live is what would let a forged row lock a
// teacher out of the product forever.
const isLive = (row: SessionTimingRow, now: Date) =>
  row.started_at !== null && effectiveStatus(row, now) === "active";

// A teacher is busy from the moment they accept, not from the moment the call
// starts. Without this they would be offered a second request while their
// first student is still at the checkout screen.
const isBusy = (row: SessionTimingRow, now: Date) => {
  const status = effectiveStatus(row, now);
  if (status === "accepted" || status === "paid") return true;
  return isLive(row, now);
};

export function hasLiveSession(
  rows: readonly SessionTimingRow[],
  now: Date
): boolean {
  return rows.some((row) => isBusy(row, now));
}

// Rows stored `active` that the read-time rule already considers finished.
// Deriving that on every read is not enough on its own: the stored column is
// what a concurrency check counts and what a stale row keeps hostage, so the
// derivation has to be written back.
export function expiredActiveIds(
  rows: readonly SessionTimingRow[],
  now: Date
): string[] {
  return rows
    .filter(
      (row) =>
        row.status === "active" &&
        row.started_at !== null &&
        effectiveStatus(row, now) === "completed"
    )
    .map((row) => row.id);
}

// The settle-on-read twin of expiredActiveIds, for the payment window.
export function expiredAcceptedIds(
  rows: readonly SessionTimingRow[],
  now: Date
): string[] {
  return rows
    .filter(
      (row) =>
        row.status === "accepted" &&
        row.payment_deadline !== null &&
        effectiveStatus(row, now) === "payment_expired"
    )
    .map((row) => row.id);
}

// Absolute expiry for a session's room and tokens, as a ttl from `now`. Both
// are pinned to the same wall-clock end, so reloading mid-call cannot extend a
// call past the room it lives in.
export function roomTtlSeconds(
  startedAt: string | Date,
  durationMinutes: number,
  now: Date
): number {
  const start =
    typeof startedAt === "string" ? new Date(startedAt) : startedAt;
  const endsAt =
    start.getTime() + (durationMinutes + ROOM_GRACE_MINUTES) * 60_000;
  // Never issue a dead credential: a late join still gets a usable minute.
  return Math.max(60, Math.ceil((endsAt - now.getTime()) / 1000));
}

// "Does this student already have something in flight?" A student with two
// live requests can have both accepted; the loser's teacher then sits alone
// for an hour and that row later counts toward their earnings.
export function hasOpenRequest(
  rows: readonly SessionTimingRow[],
  now: Date
): boolean {
  return rows.some((row) => {
    const status = effectiveStatus(row, now);
    return status === "pending" || isBusy(row, now);
  });
}

// The columns needed to decide whether a request is still worth showing.
// Narrower than SessionTimingRow on purpose: this answers a question about
// open requests, none of which can be `active`, so started_at and
// duration_minutes have nothing to say about them.
export interface OpenRequestRow {
  status: SessionStatus;
  accept_deadline: string | null;
  payment_deadline: string | null;
}

// Is this row still a request the teacher can act on, or has its clock run
// out? `paid` is the exception and deliberately has no deadline check: the
// money is in and only the webhook moves the row from here — the trigger
// permits `payment_expired` out of `accepted` alone. Dropping a paid row
// because its payment_deadline lapsed while the room was being minted would
// leave the eventual `active` update with no card to match, stranding the
// teacher out of a session already paid for.
const isOpenRequest = (row: OpenRequestRow, now: Date): boolean => {
  if (row.status === "paid") return true;
  const deadline =
    row.status === "pending" ? row.accept_deadline
    : row.status === "accepted" ? row.payment_deadline
    : null;
  return deadline !== null && secondsRemaining(deadline, now) > 0;
};

// Which of a teacher's open rows their dashboard should show, given a list
// already ordered newest-first. A session this teacher is COMMITTED to
// outranks a newer request, whatever the timestamps say: ordering by
// created_at alone let a second student's pending row mask the teacher's own
// in-flight one on a mid-payment reload — the same stranding M2's Critical 1
// closed, arriving by another route. There can be at most one committed row,
// because acceptSession refuses a second, so the first match wins and
// anything behind it is a request that could only ever have failed.
//
// This is defence in depth, not the fix. The root fix is presence: a teacher
// is untracked from the online list the moment they accept, so the second
// request should not be sendable in the first place (M3 spec §9).
export function pickOpenRequest<T extends OpenRequestRow>(
  rows: readonly T[],
  now: Date
): T | null {
  const open = rows.filter((row) => isOpenRequest(row, now));
  return (
    open.find((row) => row.status === "accepted" || row.status === "paid") ??
    open[0] ??
    null
  );
}

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return ALLOWED[from].includes(to);
}
