import { describe, it, expect } from "vitest";
import { moneyTouched } from "./student-sessions";

describe("moneyTouched", () => {
  // Stated as a fact about money rather than a list of status names: statuses
  // changed in 0002 and again in 0005, and a name list drifts silently.
  it("includes a session that was paid for", () => {
    expect(moneyTouched({ amount_paid_paise: 50000, refund_ref: null })).toBe(true);
  });

  it("includes a refunded session even though the money came back", () => {
    // A parent reconciling a bank statement sees a charge AND a reversal.
    // Hiding this row leaves them with a refund they cannot explain.
    expect(moneyTouched({ amount_paid_paise: 50000, refund_ref: "rfnd_1" })).toBe(true);
  });

  it("includes a refund recorded with no amount still on the row", () => {
    expect(moneyTouched({ amount_paid_paise: null, refund_ref: "rfnd_1" })).toBe(true);
  });

  it("includes a session cancelled AFTER it was paid for", () => {
    // Named in spec §6 because a status allowlist gets this one wrong: the
    // status reads `cancelled`, but the money moved and came back.
    expect(moneyTouched({ amount_paid_paise: 50000, refund_ref: "rfnd_2" })).toBe(true);
  });

  it("excludes a session whose payment window expired", () => {
    // Also named in spec §6: `payment_expired` looks like a real outcome but
    // nothing was ever charged, so it does not belong in a record of charges.
    expect(moneyTouched({ amount_paid_paise: null, refund_ref: null })).toBe(false);
  });

  it("excludes a request where nothing was ever charged", () => {
    // A student who tapped five teachers before one answered must not see
    // five rows for one lesson.
    expect(moneyTouched({ amount_paid_paise: null, refund_ref: null })).toBe(false);
  });
});
