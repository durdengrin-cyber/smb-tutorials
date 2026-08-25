import { describe, it, expect } from "vitest";
import {
  ACCEPT_WINDOW_SECONDS, SESSION_DURATION_MINUTES,
  acceptDeadlineFrom, effectiveStatus, secondsRemaining, canTransition,
} from "./session";

const iso = (d: Date) => d.toISOString();
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
