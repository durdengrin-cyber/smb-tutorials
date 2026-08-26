import { describe, it, expect } from "vitest";
import {
  ACCEPT_WINDOW_SECONDS, SESSION_DURATION_MINUTES,
  acceptDeadlineFrom, effectiveStatus, secondsRemaining, canTransition,
  hasLiveSession, expiredActiveIds, hasOpenRequest, roomTtlSeconds,
  ROOM_GRACE_MINUTES, type SessionTimingRow,
} from "./session";

const NOW = new Date("2026-08-25T12:00:00.000Z");

describe("constants", () => {
  it("matches the spec", () => {
    expect(ACCEPT_WINDOW_SECONDS).toBe(30);
    expect(SESSION_DURATION_MINUTES).toBe(60);
  });
});

describe("acceptDeadlineFrom", () => {
  it("is 30 seconds after creation", () => {
    expect(acceptDeadlineFrom(NOW).toISOString()).toBe("2026-08-25T12:00:30.000Z");
  });
});

describe("secondsRemaining", () => {
  it("counts down and never goes negative", () => {
    expect(secondsRemaining("2026-08-25T12:00:30.000Z", NOW)).toBe(30);
    expect(secondsRemaining("2026-08-25T11:59:00.000Z", NOW)).toBe(0);
  });
});

describe("effectiveStatus", () => {
  const base = { started_at: null, duration_minutes: 60 };

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
      { status: "active", accept_deadline: null,
        started_at: "2026-08-25T10:59:00.000Z", duration_minutes: 60 }, NOW
    )).toBe("completed");
  });

  it("leaves an active session inside its hour active", () => {
    expect(effectiveStatus(
      { status: "active", accept_deadline: null,
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
    expect(canTransition("pending", "active")).toBe(true);
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
});

// NOW is 2026-08-25T12:00:00Z; a 60-minute session that started at 11:30 is
// half done, one that started at 10:30 is over.
const live: SessionTimingRow = {
  id: "live", status: "active", accept_deadline: null,
  started_at: "2026-08-25T11:30:00.000Z", duration_minutes: 60,
};
const expired: SessionTimingRow = {
  id: "expired", status: "active", accept_deadline: null,
  started_at: "2026-08-25T10:30:00.000Z", duration_minutes: 60,
};
// Never produced by acceptSession, which writes started_at in the same update
// that sets `active`. Only a direct write to the table can create it.
const forged: SessionTimingRow = {
  id: "forged", status: "active", accept_deadline: null,
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
    id: "p", status: "pending", accept_deadline: deadline,
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
