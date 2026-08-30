import { describe, it, expect } from "vitest";
import {
  LEASE_SECONDS,
  RENEW_FLOOR_SECONDS,
  leaseUntilFrom,
  isLeaseLive,
  shouldRenew,
  formatLeaseEnd,
} from "./availability";

const at = (iso: string) => new Date(iso);

describe("leaseUntilFrom", () => {
  it("buys exactly four hours", () => {
    expect(leaseUntilFrom(at("2026-08-30T10:00:00Z")).toISOString()).toBe(
      "2026-08-30T14:00:00.000Z"
    );
    expect(LEASE_SECONDS).toBe(4 * 60 * 60);
  });
});

describe("isLeaseLive", () => {
  it("is false when never declared", () => {
    expect(isLeaseLive(null, at("2026-08-30T10:00:00Z"))).toBe(false);
  });

  it("is true while time remains", () => {
    expect(
      isLeaseLive("2026-08-30T14:00:00Z", at("2026-08-30T13:59:59Z"))
    ).toBe(true);
  });

  // The boundary decides whether a lapsed teacher is listed for one more
  // request. Exactly-expired counts as lapsed.
  it("is false at the instant it expires", () => {
    expect(
      isLeaseLive("2026-08-30T14:00:00Z", at("2026-08-30T14:00:00Z"))
    ).toBe(false);
  });
});

describe("shouldRenew", () => {
  it("does not renew above the halfway point", () => {
    // 2h01m left of a 4h lease.
    expect(
      shouldRenew("2026-08-30T14:00:00Z", at("2026-08-30T11:59:00Z"), null)
    ).toBe(false);
  });

  it("renews below the halfway point", () => {
    // 1h59m left of a 4h lease.
    expect(
      shouldRenew("2026-08-30T14:00:00Z", at("2026-08-30T12:01:00Z"), null)
    ).toBe(true);
  });

  // The floor is what stops four open tabs, or a remount loop, turning a
  // rare write into a frequent one. Without it the halfway rule fires on
  // every single mount for the whole second half of the lease.
  it("refuses a second renewal inside the 15-minute floor", () => {
    expect(
      shouldRenew(
        "2026-08-30T14:00:00Z",
        at("2026-08-30T12:05:00Z"),
        at("2026-08-30T12:00:00Z")
      )
    ).toBe(false);
    expect(RENEW_FLOOR_SECONDS).toBe(15 * 60);
  });

  it("allows a renewal once the floor has passed", () => {
    expect(
      shouldRenew(
        "2026-08-30T14:00:00Z",
        at("2026-08-30T12:16:00Z"),
        at("2026-08-30T12:00:00Z")
      )
    ).toBe(true);
  });

  it("never renews a lease that has already lapsed", () => {
    // A lapsed lease is a fresh decision by the teacher, not a renewal.
    expect(
      shouldRenew("2026-08-30T14:00:00Z", at("2026-08-30T14:00:01Z"), null)
    ).toBe(false);
  });

  it("never renews when not declared", () => {
    expect(shouldRenew(null, at("2026-08-30T12:00:00Z"), null)).toBe(false);
  });
});

describe("formatLeaseEnd", () => {
  it("renders a short local wall-clock time", () => {
    const out = formatLeaseEnd("2026-08-30T14:00:00Z");
    expect(out).toMatch(/\d/);
    expect(out).not.toContain("T");
  });
});
