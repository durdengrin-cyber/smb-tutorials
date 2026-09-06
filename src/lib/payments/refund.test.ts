import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { refundSession } from "./refund";

const port = { refund: vi.fn() };
vi.mock("./index", () => ({
  getPaymentPort: () => port,
  paymentProviderName: () => "stub",
}));

interface Chain {
  update: Mock<(...args: unknown[]) => Chain>;
  eq: Mock<(...args: unknown[]) => Chain>;
  is: Mock<(...args: unknown[]) => Chain>;
  select: Mock<() => Promise<{ data: unknown[] | null; error: unknown }>>;
}

// Minimal PostgREST-shaped stub: .from().update().eq().is().select()
function stubDb(result: { data: unknown[] | null; error: unknown }) {
  const chain: Chain = {
    update: vi.fn<(...args: unknown[]) => Chain>(() => chain),
    eq: vi.fn<(...args: unknown[]) => Chain>(() => chain),
    is: vi.fn<(...args: unknown[]) => Chain>(() => chain),
    select: vi.fn(() => Promise.resolve(result)),
  };
  return { from: vi.fn(() => chain), chain };
}

beforeEach(() => {
  port.refund.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("refundSession", () => {
  it("refunds, then stamps the row with the reference", async () => {
    port.refund.mockResolvedValue({ refundRef: "rfnd_1" });
    const db = stubDb({ data: [{ id: "s1" }], error: null });

    await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: "refunded", why: "test", logPrefix: "[suspension]",
    });

    expect(port.refund).toHaveBeenCalledWith("pay_1", 50000);
    expect(db.chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "refunded", refund_ref: "rfnd_1" })
    );
  });

  it("does not stamp the row when the provider throws", async () => {
    port.refund.mockRejectedValue(new Error("provider down"));
    const db = stubDb({ data: [{ id: "s1" }], error: null });

    await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: "refunded", why: "test", logPrefix: "[suspension]",
    });

    expect(db.chain.update).not.toHaveBeenCalled();
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
});
