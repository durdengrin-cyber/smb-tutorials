import { describe, it, expect, vi, beforeEach } from "vitest";

const refundSession = vi.fn();
vi.mock("@/lib/payments/refund", () => ({ refundSession }));

const rows: Array<Record<string, unknown>> = [];
const updateSpy = vi.fn();
// settleSuspension gatekeeps itself: it reads teacher_suspensions first and
// returns early when nothing is open. Default to "one is open" so the
// session-handling tests exercise the path they are about.
let openSuspension: { id: string } | null = { id: "sus_1" };

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "teacher_suspensions") {
        const s: Record<string, unknown> = {
          select: () => s,
          eq: () => s,
          is: () => s,
          maybeSingle: () => Promise.resolve({ data: openSuspension, error: null }),
        };
        return s;
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => Promise.resolve({ data: rows, error: null }),
        update: (patch: unknown) => {
          updateSpy(patch);
          return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
        },
      };
      return chain;
    },
  }),
}));

const { settleSuspension } = await import("./settle");

beforeEach(() => {
  rows.length = 0;
  openSuspension = { id: "sus_1" };
  refundSession.mockReset();
  updateSpy.mockReset();
});

describe("settleSuspension", () => {
  // The gate. This is what lets the waiting page and the dashboard call it on
  // every load without a suspension check of their own — and without either
  // page component needing the service role to perform one.
  it("does nothing when the teacher has no open suspension", async () => {
    openSuspension = null;
    rows.push({ id: "a", status: "paid", payment_ref: "pay_1", amount_paid_paise: 50000 });
    await settleSuspension("t1");
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
  });

  it("cancels pending and accepted, and stamps the reason", async () => {
    rows.push(
      { id: "a", status: "pending", payment_ref: null, amount_paid_paise: null },
      { id: "b", status: "accepted", payment_ref: null, amount_paid_paise: null }
    );
    await settleSuspension("t1");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        cancellation_reason: "teacher_suspended",
      })
    );
    expect(refundSession).not.toHaveBeenCalled();
  });

  it("refunds a paid session rather than cancelling it", async () => {
    rows.push({
      id: "c", status: "paid", payment_ref: "pay_1", amount_paid_paise: 50000,
    });
    await settleSuspension("t1");
    expect(refundSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: "c", paymentRef: "pay_1", amountPaise: 50000,
        nextStatus: "refunded", logPrefix: "[suspension]",
      })
    );
  });

  it("leaves an active session alone", async () => {
    rows.push({ id: "d", status: "active", payment_ref: "pay_2", amount_paid_paise: 50000 });
    await settleSuspension("t1");
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
  });

  // The property that makes it safe to call from a page load.
  it("issues the refund once when called twice", async () => {
    rows.push({ id: "c", status: "paid", payment_ref: "pay_1", amount_paid_paise: 50000 });
    await settleSuspension("t1");
    rows.length = 0;              // second pass: the row is no longer `paid`
    await settleSuspension("t1");
    expect(refundSession).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the teacher has no sessions in flight", async () => {
    await settleSuspension("t1");
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
  });
});
