import { describe, it, expect } from "vitest";
import {
  ACCEPT_WINDOW_SECONDS, SESSION_DURATION_MINUTES,
  acceptDeadlineFrom, effectiveStatus, secondsRemaining, canTransition,
  hasLiveSession, expiredActiveIds, hasOpenRequest, roomTtlSeconds,
  ROOM_GRACE_MINUTES, type SessionTimingRow,
  PAYMENT_WINDOW_SECONDS, paymentDeadlineFrom, amountPaiseFor,
  expiredAcceptedIds, type SessionStatus, pickOpenRequest,
} from "./session";

const NOW = new Date("2026-08-25T12:00:00.000Z");

describe("constants", () => {
  it("matches the spec", () => {
    expect(ACCEPT_WINDOW_SECONDS).toBe(60);
    expect(SESSION_DURATION_MINUTES).toBe(60);
  });
});

describe("acceptDeadlineFrom", () => {
  it("is 60 seconds after creation", () => {
    expect(acceptDeadlineFrom(NOW).toISOString()).toBe("2026-08-25T12:01:00.000Z");
  });

  it("gives a sleeping phone time to be woken", () => {
    // 30s was sized for a teacher already looking at the screen. Waking a
    // locked phone does not fit inside it: delivery, noticing, unlocking,
    // tapping. This is a DEADLINE, not a wait — a teacher who accepts in two
    // seconds still resolves in two seconds, so the fast path costs nothing.
    expect(ACCEPT_WINDOW_SECONDS).toBe(60);
    expect(acceptDeadlineFrom(new Date("2026-08-30T10:00:00Z")).toISOString())
      .toBe("2026-08-30T10:01:00.000Z");
  });
});

describe("secondsRemaining", () => {
  it("counts down and never goes negative", () => {
    expect(secondsRemaining("2026-08-25T12:00:30.000Z", NOW)).toBe(30);
    expect(secondsRemaining("2026-08-25T11:59:00.000Z", NOW)).toBe(0);
  });
});

describe("effectiveStatus", () => {
  const base = { payment_deadline: null, started_at: null, duration_minutes: 60 };

  it("leaves a live pending request pending", () => {
    expect(effectiveStatus(
      { ...base, status: "pending", accept_deadline: "2026-08-25T12:00:10.000Z" }, NOW
    )).toBe("pending");
  });

  it("treats an expired pending request as timed out", () => {
    expect(effectiveStatus(
      { ...base, status: "pending", accept_deadline: "2026-08-25T11:59:59.000Z" }, NOW
    )).toBe("timed_out");
  });

  it("treats an active session past its hour as completed", () => {
    expect(effectiveStatus(
      { status: "active", accept_deadline: null, payment_deadline: null,
        started_at: "2026-08-25T10:59:00.000Z", duration_minutes: 60 }, NOW
    )).toBe("completed");
  });

  it("leaves an active session inside its hour active", () => {
    expect(effectiveStatus(
      { status: "active", accept_deadline: null, payment_deadline: null,
        started_at: "2026-08-25T11:30:00.000Z", duration_minutes: 60 }, NOW
    )).toBe("active");
  });

  it("never rewrites a terminal status", () => {
    for (const s of ["completed", "declined", "timed_out", "cancelled"] as const) {
      expect(effectiveStatus(
        { ...base, status: s, accept_deadline: "2026-08-25T11:00:00.000Z" }, NOW
      )).toBe(s);
    }
  });
});

describe("canTransition", () => {
  it("allows the real paths", () => {
    expect(canTransition("pending", "accepted")).toBe(true);
    expect(canTransition("pending", "declined")).toBe(true);
    expect(canTransition("pending", "timed_out")).toBe(true);
    expect(canTransition("pending", "cancelled")).toBe(true);
    expect(canTransition("active", "completed")).toBe(true);
  });
  it("refuses resurrection and skipping", () => {
    expect(canTransition("completed", "active")).toBe(false);
    expect(canTransition("timed_out", "active")).toBe(false);
    expect(canTransition("declined", "active")).toBe(false);
    expect(canTransition("pending", "completed")).toBe(false);
  });
  it("no longer allows accept to jump straight to a room", () => {
    // M3 puts payment between them: the only route to `active` is via `paid`.
    // A caller that still asks for pending -> active is a caller that has not
    // been migrated, and this is the assertion that finds it.
    expect(canTransition("pending", "active")).toBe(false);
    expect(canTransition("accepted", "active")).toBe(false);
    expect(canTransition("accepted", "paid")).toBe(true);
    expect(canTransition("paid", "active")).toBe(true);
  });
});

// NOW is 2026-08-25T12:00:00Z; a 60-minute session that started at 11:30 is
// half done, one that started at 10:30 is over.
const live: SessionTimingRow = {
  id: "live", status: "active", accept_deadline: null, payment_deadline: null,
  started_at: "2026-08-25T11:30:00.000Z", duration_minutes: 60,
};
const expired: SessionTimingRow = {
  id: "expired", status: "active", accept_deadline: null, payment_deadline: null,
  started_at: "2026-08-25T10:30:00.000Z", duration_minutes: 60,
};
// Never produced by acceptSession, which writes started_at in the same update
// that sets `active`. Only a direct write to the table can create it.
const forged: SessionTimingRow = {
  id: "forged", status: "active", accept_deadline: null, payment_deadline: null,
  started_at: null, duration_minutes: 60,
};

describe("hasLiveSession", () => {
  it("is false with no rows", () => {
    expect(hasLiveSession([], NOW)).toBe(false);
  });

  it("counts an active session inside its hour", () => {
    expect(hasLiveSession([live], NOW)).toBe(true);
  });

  it("does not count an active session past its hour", () => {
    // The whole point: a row left `active` by two closed browsers must not
    // keep its teacher out of the product forever.
    expect(hasLiveSession([expired], NOW)).toBe(false);
  });

  it("does not count an active row with no started_at", () => {
    // effectiveStatus cannot expire this row, so believing it would lock the
    // teacher out permanently.
    expect(hasLiveSession([forged], NOW)).toBe(false);
  });

  it("finds a live row among finished ones", () => {
    expect(hasLiveSession([expired, forged, live], NOW)).toBe(true);
  });
});

describe("expiredActiveIds", () => {
  it("returns nothing when every active row is still running", () => {
    expect(expiredActiveIds([live], NOW)).toEqual([]);
  });

  it("names the rows whose hour has passed", () => {
    expect(expiredActiveIds([live, expired], NOW)).toEqual(["expired"]);
  });

  it("leaves a row with no started_at alone", () => {
    // Settling it to `completed` would fold a forged row into earnings.
    expect(expiredActiveIds([forged], NOW)).toEqual([]);
  });

  it("ignores rows that are not stored active", () => {
    const done: SessionTimingRow = { ...expired, id: "done", status: "completed" };
    expect(expiredActiveIds([done], NOW)).toEqual([]);
  });
});

describe("hasOpenRequest", () => {
  const pending = (deadline: string): SessionTimingRow => ({
    id: "p", status: "pending", accept_deadline: deadline, payment_deadline: null,
    started_at: null, duration_minutes: 60,
  });

  it("is false with no rows", () => {
    expect(hasOpenRequest([], NOW)).toBe(false);
  });

  it("counts a request still inside its window", () => {
    expect(hasOpenRequest([pending("2026-08-25T12:00:20.000Z")], NOW)).toBe(true);
  });

  it("does not count a request whose window has passed", () => {
    expect(hasOpenRequest([pending("2026-08-25T11:59:59.000Z")], NOW)).toBe(false);
  });

  it("counts a call that is still running", () => {
    expect(hasOpenRequest([live], NOW)).toBe(true);
  });

  it("does not count a finished call, or a forged one", () => {
    expect(hasOpenRequest([expired, forged], NOW)).toBe(false);
  });
});

describe("roomTtlSeconds", () => {
  it("covers the session plus the grace window", () => {
    // Starting now, a 60-minute session with a 15-minute grace = 4500s.
    expect(roomTtlSeconds(NOW, 60, NOW)).toBe((60 + ROOM_GRACE_MINUTES) * 60);
  });

  it("shrinks for a token minted mid-call, pinning the same end", () => {
    const halfway = new Date("2026-08-25T12:30:00.000Z");
    expect(roomTtlSeconds(NOW, 60, halfway)).toBe((30 + ROOM_GRACE_MINUTES) * 60);
  });

  it("never issues a dead credential", () => {
    const longAfter = new Date("2026-08-26T12:00:00.000Z");
    expect(roomTtlSeconds(NOW, 60, longAfter)).toBe(60);
  });
});

describe("paymentDeadlineFrom", () => {
  it("is 120 seconds after acceptance", () => {
    expect(paymentDeadlineFrom(NOW).toISOString()).toBe("2026-08-25T12:02:00.000Z");
    expect(PAYMENT_WINDOW_SECONDS).toBe(120);
  });
});

describe("amountPaiseFor", () => {
  it("charges the full hourly rate for a 60-minute session", () => {
    expect(amountPaiseFor(500, 60)).toBe(50000);
  });
  it("prorates a shorter session", () => {
    expect(amountPaiseFor(500, 30)).toBe(25000);
  });
  it("rounds to whole rupees before converting to paise", () => {
    // 500 * 20 / 60 = 166.67 -> 167 rupees -> 16700 paise. Never a fraction
    // of a paise, and never a float sneaking into a money column.
    expect(amountPaiseFor(500, 20)).toBe(16700);
  });
  it("returns an integer for every input it is given", () => {
    for (const [rate, mins] of [[500, 60], [499, 45], [1, 7], [12345, 13]]) {
      expect(Number.isInteger(amountPaiseFor(rate, mins))).toBe(true);
    }
  });
});

describe("effectiveStatus — payment window", () => {
  const accepted = (deadline: string | null) => ({
    status: "accepted" as const,
    accept_deadline: "2026-08-25T11:59:00.000Z",
    payment_deadline: deadline,
    started_at: null,
    duration_minutes: 60,
  });

  it("leaves an accepted row alone inside its window", () => {
    expect(effectiveStatus(accepted("2026-08-25T12:00:30.000Z"), NOW)).toBe("accepted");
  });
  it("expires an accepted row past its window", () => {
    expect(effectiveStatus(accepted("2026-08-25T11:59:59.000Z"), NOW)).toBe("payment_expired");
  });
  it("cannot expire an accepted row with no payment_deadline", () => {
    // Mirrors the pending/accept_deadline rule. Migration 0005 makes this
    // unreachable with a CHECK; the guard keeps the pure function honest.
    expect(effectiveStatus(accepted(null), NOW)).toBe("accepted");
  });
  it("never rewrites the new terminal statuses", () => {
    for (const s of ["payment_expired", "refunded"] as const) {
      expect(effectiveStatus({ ...accepted(null), status: s }, NOW)).toBe(s);
    }
  });
});

describe("hasLiveSession — a teacher awaiting payment is busy", () => {
  const row = (status: SessionStatus, paymentDeadline: string | null): SessionTimingRow => ({
    id: status, status, accept_deadline: null, payment_deadline: paymentDeadline,
    started_at: null, duration_minutes: 60,
  });

  it("counts a teacher whose student is mid-checkout", () => {
    expect(hasLiveSession([row("accepted", "2026-08-25T12:01:00.000Z")], NOW)).toBe(true);
  });
  it("counts a paid session whose room is still being minted", () => {
    expect(hasLiveSession([row("paid", null)], NOW)).toBe(true);
  });
  it("does not count an accepted session whose window has passed", () => {
    // Otherwise a student who wandered off locks their teacher out.
    expect(hasLiveSession([row("accepted", "2026-08-25T11:59:00.000Z")], NOW)).toBe(false);
  });
});

describe("expiredAcceptedIds", () => {
  const row = (id: string, deadline: string): SessionTimingRow => ({
    id, status: "accepted", accept_deadline: null, payment_deadline: deadline,
    started_at: null, duration_minutes: 60,
  });

  it("names accepted rows whose payment window has closed", () => {
    expect(expiredAcceptedIds(
      [row("live", "2026-08-25T12:01:00.000Z"), row("gone", "2026-08-25T11:59:00.000Z")], NOW
    )).toEqual(["gone"]);
  });
  it("returns nothing when every row is still inside its window", () => {
    expect(expiredAcceptedIds([row("live", "2026-08-25T12:01:00.000Z")], NOW)).toEqual([]);
  });
  it("ignores rows that are not stored accepted", () => {
    expect(expiredAcceptedIds(
      [{ ...row("x", "2026-08-25T11:00:00.000Z"), status: "cancelled" }], NOW
    )).toEqual([]);
  });
});

describe("pickOpenRequest — which row the teacher's dashboard shows", () => {
  const row = (
    id: string,
    status: SessionStatus,
    { accept = null, payment = null }: { accept?: string | null; payment?: string | null } = {}
  ) => ({ id, status, accept_deadline: accept, payment_deadline: payment });

  const LIVE = "2026-08-25T12:01:00.000Z";
  const PASSED = "2026-08-25T11:59:00.000Z";

  it("returns null when there is nothing open", () => {
    expect(pickOpenRequest([], NOW)).toBe(null);
  });

  it("returns the only live pending request", () => {
    expect(pickOpenRequest([row("a", "pending", { accept: LIVE })], NOW)?.id).toBe("a");
  });

  it("prefers a session the teacher is committed to over a newer pending request", () => {
    // The regression this exists to stop: the catch-up query orders by
    // created_at desc, so a second student's request arrives first in the
    // list and used to mask the teacher's own in-flight row, stranding them
    // mid-payment-window with a card that can only fail.
    const rows = [
      row("newer-pending", "pending", { accept: LIVE }),
      row("mine", "accepted", { payment: LIVE }),
    ];
    expect(pickOpenRequest(rows, NOW)?.id).toBe("mine");
  });

  it("prefers a paid row over a newer pending request", () => {
    const rows = [
      row("newer-pending", "pending", { accept: LIVE }),
      row("mine", "paid", { payment: LIVE }),
    ];
    expect(pickOpenRequest(rows, NOW)?.id).toBe("mine");
  });

  it("keeps a paid row whose payment window has since passed", () => {
    // Money is in and the webhook is minting the room; payment_deadline no
    // longer governs (the trigger only allows accepted -> payment_expired).
    // Dropping it here would leave the eventual `active` update with no card
    // to match, stranding the teacher out of a session already paid for.
    expect(pickOpenRequest([row("paid-late", "paid", { payment: PASSED })], NOW)?.id).toBe("paid-late");
  });

  it("skips an accepted row whose payment window has closed", () => {
    // It reads as payment_expired, so showing it would offer a dead card and
    // hide a genuine pending request behind it.
    const rows = [
      row("stale", "accepted", { payment: PASSED }),
      row("real", "pending", { accept: LIVE }),
    ];
    expect(pickOpenRequest(rows, NOW)?.id).toBe("real");
  });

  it("skips a pending row whose accept window has closed", () => {
    expect(pickOpenRequest([row("gone", "pending", { accept: PASSED })], NOW)).toBe(null);
  });

  it("skips rows carrying no deadline at all", () => {
    expect(pickOpenRequest([row("nodeadline", "pending")], NOW)).toBe(null);
  });

  it("ignores statuses that are not open requests", () => {
    expect(pickOpenRequest([row("done", "completed", { accept: LIVE })], NOW)).toBe(null);
  });

  it("falls back to the first still-open row when none is committed", () => {
    const rows = [
      row("newest", "pending", { accept: LIVE }),
      row("older", "pending", { accept: LIVE }),
    ];
    expect(pickOpenRequest(rows, NOW)?.id).toBe("newest");
  });
});
