// Pure session rules. Nothing here touches the network — the same functions
// run in Server Actions, Server Components and the browser, which is what
// lets a serverless stack enforce deadlines without a cron.

export const ACCEPT_WINDOW_SECONDS = 30;
export const SESSION_DURATION_MINUTES = 60;

export type SessionStatus =
  | "pending" | "accepted" | "active"
  | "completed" | "declined" | "timed_out" | "cancelled";

const TERMINAL: readonly SessionStatus[] = [
  "completed", "declined", "timed_out", "cancelled",
];

const ALLOWED: Record<SessionStatus, readonly SessionStatus[]> = {
  pending: ["active", "accepted", "declined", "timed_out", "cancelled"],
  accepted: ["active", "cancelled"], // reserved for M3, where payment sits here
  active: ["completed"],
  completed: [],
  declined: [],
  timed_out: [],
  cancelled: [],
};

export function acceptDeadlineFrom(createdAt: Date): Date {
  return new Date(createdAt.getTime() + ACCEPT_WINDOW_SECONDS * 1000);
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
    started_at: string | null;
    duration_minutes: number;
  },
  now: Date
): SessionStatus {
  if (TERMINAL.includes(row.status)) return row.status;

  if (row.status === "pending" && row.accept_deadline) {
    if (secondsRemaining(row.accept_deadline, now) === 0) return "timed_out";
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

export function hasLiveSession(
  rows: readonly SessionTimingRow[],
  now: Date
): boolean {
  return rows.some((row) => isLive(row, now));
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

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return ALLOWED[from].includes(to);
}
