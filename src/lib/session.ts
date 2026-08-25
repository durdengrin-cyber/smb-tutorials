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

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return ALLOWED[from].includes(to);
}
