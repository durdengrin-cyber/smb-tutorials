import { describe, it, expect, vi, beforeEach } from "vitest";

const refundSession = vi.fn();
vi.mock("@/lib/payments/refund", () => ({ refundSession }));

const rows: Array<Record<string, unknown>> = [];
const updateSpy = vi.fn();
// Captures the two chained .eq() calls on the cancel update — (id, value)
// then (status, value) — so a test can prove the second .eq is really there
// (fix round 1: "dropping .eq('status', s.status) from the cancel" needs
// coverage of its own; the write mattering on the status it read, not just
// the id, is the guard against clobbering a session that moved on
// underneath this pass).
const updateEqSpy = vi.fn();
// True only for the one test that deliberately simulates the read query
// itself being wrongly widened (e.g. to include "active") — every other
// test goes through the real filtering below, so a widened `.in()` would
// fail them on its own merits.
let bypassInFilter = false;
let sessionsReadError: unknown = null;
let openSuspensionError: unknown = null;
let cancelUpdateError: unknown = null;
// What the cancel UPDATE ... .select() returns. One row = a real write; an
// empty array = the status guard matched nothing because the session moved on
// under us, which PostgREST reports with error: null exactly like a success.
let cancelRowsReturned: Array<{ id: string }> = [{ id: "cancelled" }];
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
          maybeSingle: () =>
            Promise.resolve({
              data: openSuspensionError ? null : openSuspension,
              error: openSuspensionError,
            }),
        };
        return s;
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        // Honours its filter arguments, like the real PostgREST `.in()`
        // does — a query that widens the status list to include "active"
        // now actually returns an active row instead of the mock silently
        // doing nothing, so a test relying on the filter means something.
        in: (column: string, values: unknown[]) => {
          if (sessionsReadError) {
            return Promise.resolve({ data: null, error: sessionsReadError });
          }
          const data = bypassInFilter
            ? rows
            : rows.filter((r) => values.includes(r[column]));
          return Promise.resolve({ data, error: null });
        },
        update: (patch: unknown) => {
          updateSpy(patch);
          return {
            eq: (idCol: string, idVal: unknown) => ({
              eq: (statusCol: string, statusVal: unknown) => {
                updateEqSpy(idCol, idVal, statusCol, statusVal);
                // .select() is required: settle uses the returned rows to tell
                // a real write from a status-guard-blocked no-op, which
                // PostgREST reports identically (`error: null`, zero rows).
                // `cancelRowsReturned` lets a test model the lost race.
                return {
                  select: () =>
                    Promise.resolve({
                      data: cancelUpdateError ? null : cancelRowsReturned,
                      error: cancelUpdateError,
                    }),
                };
              },
            }),
          };
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
  openSuspensionError = null;
  sessionsReadError = null;
  cancelUpdateError = null;
  cancelRowsReturned = [{ id: "cancelled" }];
  bypassInFilter = false;
  refundSession.mockReset();
  // Default to "the refund actually landed" so tests about which sessions
  // get refunded, not about refundSession's own confirmation, aren't forced
  // to restate it every time.
  refundSession.mockResolvedValue(true);
  updateSpy.mockReset();
  updateEqSpy.mockReset();
});

describe("settleSuspension", () => {
  // The gate. This is what lets the waiting page and the dashboard call it on
  // every load without a suspension check of their own — and without either
  // page component needing the service role to perform one.
  it("does nothing when the teacher has no open suspension", async () => {
    openSuspension = null;
    rows.push({ id: "a", status: "paid", payment_ref: "pay_1", amount_paid_paise: 50000 });
    await expect(settleSuspension("t1")).resolves.toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
  });

  // Fix round 1, minor: a failed gate read was silently treated as "not
  // suspended". It must return false (nothing was mutated) but must not be
  // silent about why.
  it("returns false and logs when the gate read itself fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    openSuspensionError = new Error("connection reset");
    await expect(settleSuspension("t1")).resolves.toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  // Fix round 1, critical 1: the contract is "did I change anything", not
  // "should the caller check again". A read failure changes nothing, so this
  // must be false even though a suspension is open — true here would send a
  // waiting student's browser into a redirect loop that never resolves.
  it("returns false, not true, when the sessions read fails", async () => {
    sessionsReadError = new Error("db unavailable");
    await expect(settleSuspension("t1")).resolves.toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
  });

  it("cancels pending and accepted, and stamps the reason", async () => {
    rows.push(
      { id: "a", status: "pending", payment_ref: null, amount_paid_paise: null },
      { id: "b", status: "accepted", payment_ref: null, amount_paid_paise: null }
    );
    await expect(settleSuspension("t1")).resolves.toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        cancellation_reason: "teacher_suspended",
      })
    );
    expect(refundSession).not.toHaveBeenCalled();
    // The second .eq is the guard against clobbering a session that moved on
    // underneath this pass — coverage for it having been silently droppable.
    expect(updateEqSpy).toHaveBeenCalledWith("id", "a", "status", "pending");
    expect(updateEqSpy).toHaveBeenCalledWith("id", "b", "status", "accepted");
  });

  // A cancel that LOST the status race mutated nothing, and PostgREST reports
  // that identically to a success — `error: null`, zero rows. Without
  // `.select()` this returned true, and the waiting page would redirect for a
  // write that never happened. refund.ts defends the same way, for the same
  // reason.
  it("returns false when the cancel matched no row", async () => {
    rows.push({ id: "a", status: "pending", payment_ref: null, amount_paid_paise: null });
    cancelRowsReturned = [];
    await expect(settleSuspension("t1")).resolves.toBe(false);
    // It still ATTEMPTED the write — this is about what it reports, not about
    // skipping work.
    expect(updateSpy).toHaveBeenCalled();
  });

  it("refunds a paid session rather than cancelling it", async () => {
    rows.push({
      id: "c", status: "paid", payment_ref: "pay_1", amount_paid_paise: 50000,
    });
    await expect(settleSuspension("t1")).resolves.toBe(true);
    expect(refundSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: "c", paymentRef: "pay_1", amountPaise: 50000,
        nextStatus: "refunded", logPrefix: "[suspension]",
      })
    );
  });

  // Fix round 1, critical 2: attempting a refund is not the same as
  // confirming one. refundSession returning false (provider failed, or the
  // stamp write never landed) must not be reported to the caller as "acted".
  it("does not report acted when refundSession fails to confirm the stamp", async () => {
    refundSession.mockResolvedValue(false);
    rows.push({ id: "c", status: "paid", payment_ref: "pay_1", amount_paid_paise: 50000 });
    await expect(settleSuspension("t1")).resolves.toBe(false);
    expect(refundSession).toHaveBeenCalledTimes(1);
  });

  // Fix round 1, critical 2: a cancel update that errors changed nothing.
  it("does not report acted when the cancel update errors", async () => {
    cancelUpdateError = new Error("row locked");
    rows.push({ id: "a", status: "pending", payment_ref: null, amount_paid_paise: null });
    await expect(settleSuspension("t1")).resolves.toBe(false);
    expect(updateEqSpy).toHaveBeenCalledWith("id", "a", "status", "pending");
  });

  it("leaves an active session out of the query, honouring the real .in() filter", async () => {
    rows.push({ id: "d", status: "active", payment_ref: "pay_2", amount_paid_paise: 50000 });
    await expect(settleSuspension("t1")).resolves.toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
  });

  // The in-code guard (settle.ts:120) is a second, independent line of
  // defence, not a restatement of the query filter above — this test forces
  // the read to behave as if the query had been (wrongly) widened to include
  // "active", proving the code itself still will not touch that row.
  it("still leaves an active session alone even if the query filter is widened", async () => {
    bypassInFilter = true;
    rows.push({ id: "d", status: "active", payment_ref: "pay_2", amount_paid_paise: 50000 });
    await expect(settleSuspension("t1")).resolves.toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
  });

  // The property that makes it safe to call from a page load.
  it("issues the refund once when called twice, and reports true only the time it acted", async () => {
    rows.push({ id: "c", status: "paid", payment_ref: "pay_1", amount_paid_paise: 50000 });
    await expect(settleSuspension("t1")).resolves.toBe(true);
    rows.length = 0;              // second pass: the row is no longer `paid`
    await expect(settleSuspension("t1")).resolves.toBe(false);
    expect(refundSession).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the teacher has no sessions in flight", async () => {
    await expect(settleSuspension("t1")).resolves.toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
  });
});
