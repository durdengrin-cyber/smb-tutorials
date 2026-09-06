import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { refundSession } from "./refund";
import { DuplicateRefundError } from "./port";

const port = { refund: vi.fn() };
// Preserves the real DuplicateRefundError export (refund.ts's `instanceof`
// check needs the actual class, not a mock) while still overriding the two
// functions this test suite stubs out.
vi.mock("./index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./index")>();
  return {
    ...actual,
    getPaymentPort: () => port,
    paymentProviderName: () => "stub",
  };
});

interface StampResult {
  data: unknown[] | null;
  error: unknown;
}

interface CheckResult {
  data: { refund_ref: string } | null;
  error: unknown;
}

interface Chain {
  update: Mock<(...args: unknown[]) => Chain>;
  eq: Mock<(...args: unknown[]) => Chain>;
  is: Mock<(...args: unknown[]) => Chain>;
  // Plays two roles, matching what a real PostgrestFilterBuilder does: a
  // terminal call in the stamp write (`.select("id")`, awaited directly —
  // resolves a StampResult), and a chainable step in the attempt-1-commit
  // check (`.select("refund_ref").eq(...).maybeSingle()` — must return
  // something `.eq()` can be called on). Tests that exercise the retry or
  // the check queue distinct per-call behavior with mockImplementationOnce.
  select: Mock<(...args: unknown[]) => Chain | Promise<StampResult>>;
  maybeSingle: Mock<() => Promise<CheckResult>>;
}

// Minimal PostgREST-shaped stub: .from().update().eq().is().select() for the
// stamp write, and .from().select().eq().maybeSingle() for the attempt-1
// commit check.
function stubDb(result: StampResult) {
  const chain: Chain = {
    update: vi.fn<(...args: unknown[]) => Chain>(() => chain),
    eq: vi.fn<(...args: unknown[]) => Chain>(() => chain),
    is: vi.fn<(...args: unknown[]) => Chain>(() => chain),
    select: vi.fn<(...args: unknown[]) => Chain | Promise<StampResult>>(() =>
      Promise.resolve(result)
    ),
    maybeSingle: vi.fn<() => Promise<CheckResult>>(() =>
      Promise.resolve({ data: null, error: null })
    ),
  };
  return { from: vi.fn(() => chain), chain };
}

// Spied once, not re-spied per test: vi.spyOn on an already-spied method
// wraps a new spy around the previous one instead of replacing it, so a
// fresh spyOn() in every beforeEach would accumulate call counts and
// messages across tests. mockClear() in beforeEach resets history only.
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

beforeEach(() => {
  port.refund.mockReset();
  consoleErrorSpy.mockClear();
  consoleInfoSpy.mockClear();
});

describe("refundSession", () => {
  it("refunds, then stamps the row with the reference", async () => {
    port.refund.mockResolvedValue({ refundRef: "rfnd_1" });
    const db = stubDb({ data: [{ id: "s1" }], error: null });

    const result = await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: "refunded", why: "test", logPrefix: "[suspension]",
    });

    // The session id is the idempotency key sent to the provider — one
    // session can be refunded at most once (refund_ref is single-valued,
    // `refunded` is terminal — src/lib/session.ts), so it is stable and
    // unique per refund.
    expect(port.refund).toHaveBeenCalledWith("pay_1", 50000, "s1");
    expect(db.chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "refunded", refund_ref: "rfnd_1" })
    );
    // A caller like settleSuspension gates "did I act" on this value directly.
    expect(result).toBe(true);
  });

  it("does not stamp the row when the provider throws", async () => {
    port.refund.mockRejectedValue(new Error("provider down"));
    const db = stubDb({ data: [{ id: "s1" }], error: null });

    const result = await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: "refunded", why: "test", logPrefix: "[suspension]",
    });

    expect(db.chain.update).not.toHaveBeenCalled();
    const alarm = consoleErrorSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("REFUND FAILED")
    );
    expect(alarm).toBeDefined();
    expect(result).toBe(false);
  });

  it("does not stamp the row and logs at info, not as a failure, when the provider reports a duplicate receipt", async () => {
    // A concurrent or retried call already used this session's idempotency
    // key — the money already moved under that call. This must never read
    // as "REFUND FAILED ... needs manual action": that would send a human
    // chasing a refund that already happened.
    port.refund.mockRejectedValue(
      new DuplicateRefundError("razorpay refund: receipt s1 was already used")
    );
    const db = stubDb({ data: [{ id: "s1" }], error: null });

    const result = await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: "refunded", why: "test", logPrefix: "[suspension]",
    });

    expect(db.chain.update).not.toHaveBeenCalled();
    expect(result).toBe(false);
    const info = consoleInfoSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("already issued")
    );
    expect(info).toBeDefined();
    const failureAlarm = consoleErrorSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("REFUND FAILED")
    );
    expect(failureAlarm).toBeUndefined();
  });

  it("omits status from the write when nextStatus is null", async () => {
    port.refund.mockResolvedValue({ refundRef: "rfnd_2" });
    const db = stubDb({ data: [{ id: "s1" }], error: null });

    await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: null, why: "test", logPrefix: "[webhook]",
    });

    const written = db.chain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(written).not.toHaveProperty("status");
    expect(written.refund_ref).toBe("rfnd_2");
  });

  it("retries the stamp write once on a transient error, then succeeds without alarming", async () => {
    port.refund.mockResolvedValue({ refundRef: "rfnd_retry" });
    const db = stubDb({ data: [{ id: "s1" }], error: null });
    db.chain.select
      .mockImplementationOnce(() =>
        Promise.resolve({ data: null, error: new Error("transient write error") })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({ data: [{ id: "s1" }], error: null })
      );

    const result = await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: "refunded", why: "test", logPrefix: "[suspension]",
    });

    expect(db.chain.update).toHaveBeenCalledTimes(2);
    expect(port.refund).toHaveBeenCalledTimes(1);
    // Only the initial "refunding ..." line — no failure alarm at any level.
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toEqual(expect.stringContaining("refunding"));
    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("returns false and logs REFUNDED BUT NOT RECORDED when the retry also errors", async () => {
    port.refund.mockResolvedValue({ refundRef: "rfnd_both_fail" });
    const db = stubDb({ data: [{ id: "s1" }], error: null });
    db.chain.select
      .mockImplementationOnce(() =>
        Promise.resolve({ data: null, error: new Error("transient write error 1") })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({ data: null, error: new Error("transient write error 2") })
      );

    const result = await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: "refunded", why: "test", logPrefix: "[suspension]",
    });

    expect(db.chain.update).toHaveBeenCalledTimes(2);
    expect(port.refund).toHaveBeenCalledTimes(1);
    // Money already left the provider and neither write landed — this is the
    // one path that gets a human, not a retry: nothing recovers it further.
    const alarm = consoleErrorSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("REFUNDED BUT NOT RECORDED")
    );
    expect(alarm).toBeDefined();
    expect(result).toBe(false);
  });

  it("logs REFUND ISSUED BUT NOT RECORDED when the first attempt's guard blocks the write, and does not re-refund", async () => {
    port.refund.mockResolvedValue({ refundRef: "rfnd_guard" });
    // Zero rows, no error, on the very first attempt: retried stays false —
    // a redelivery already resolved this row before this call got here.
    const db = stubDb({ data: [], error: null });

    const result = await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: "refunded", why: "test", logPrefix: "[suspension]",
    });

    expect(db.chain.select).toHaveBeenCalledTimes(1);
    expect(db.chain.maybeSingle).not.toHaveBeenCalled();
    expect(port.refund).toHaveBeenCalledTimes(1);
    const alarm = consoleErrorSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("REFUND ISSUED BUT NOT RECORDED")
    );
    expect(alarm).toBeDefined();
    expect(result).toBe(false);
  });

  it("logs at info, not error, when the retry's guard-block turns out to be attempt 1's own commit", async () => {
    port.refund.mockResolvedValue({ refundRef: "rfnd_c1" });
    const db = stubDb({ data: [{ id: "s1" }], error: null });
    db.chain.select
      // Attempt 1: a real write error — retried becomes true.
      .mockImplementationOnce(() =>
        Promise.resolve({ data: null, error: new Error("transient write error") })
      )
      // Attempt 2 (the retry): guard matched no row.
      .mockImplementationOnce(() => Promise.resolve({ data: [], error: null }))
      // The follow-up check query's own `.select("refund_ref")` — must be
      // chainable so `.eq(...).maybeSingle()` still works.
      .mockImplementationOnce(() => db.chain);
    db.chain.maybeSingle.mockResolvedValueOnce({
      data: { refund_ref: "rfnd_c1" },
      error: null,
    });

    const result = await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: "refunded", why: "test", logPrefix: "[suspension]",
    });

    expect(db.chain.select).toHaveBeenCalledTimes(3);
    expect(db.chain.maybeSingle).toHaveBeenCalledTimes(1);
    const info = consoleInfoSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("recorded by attempt 1")
    );
    expect(info).toBeDefined();
    const errorAlarm = consoleErrorSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("NOT RECORDED")
    );
    expect(errorAlarm).toBeUndefined();
    expect(result).toBe(true);
  });
});
