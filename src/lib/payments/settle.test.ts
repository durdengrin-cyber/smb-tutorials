import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { WebhookEvent } from "./index";

const refundSession = vi.fn();
vi.mock("./refund", () => ({ refundSession }));

const createSessionRoom = vi.fn();
vi.mock("@/lib/daily", () => ({ createSessionRoom }));

// settle.ts imports paymentProviderName directly (for the claim write); it
// never calls getPaymentPort itself — refundSession does, and refundSession
// is mocked wholesale above, so getPaymentPort needs no stub here.
vi.mock("./index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./index")>();
  return { ...actual, paymentProviderName: () => "stub" };
});

interface SessionRow {
  id: string;
  status: string;
  accept_deadline: string | null;
  payment_deadline: string | null;
  started_at: string | null;
  duration_minutes: number;
  hourly_rate: number;
  payment_ref: string | null;
  amount_paid_paise: number | null;
  refund_ref: string | null;
}

// Fixtures the mocked db reads/writes against. Reset in beforeEach.
let sessionRow: SessionRow | null = null;
let readError: unknown = null;
// What the claim UPDATE ... .select("id") reports.
let claimRows: Array<{ id: string }> | null = [{ id: "s1" }];
let claimError: unknown = null;
// What the post-lost-race re-read reports.
let recheckRow: { status: string; refund_ref: string | null } | null = null;
let recheckError: unknown = null;
// What the final activate UPDATE reports.
let activateError: unknown = null;

const updateSpy = vi.fn();
const eqSpy = vi.fn();
const fromSpy = vi.fn();

// Minimal PostgREST-shaped stub covering exactly the four query shapes
// settleVerifiedEvent issues against "sessions":
//   (A) select(...).eq("id", ...).maybeSingle()              — initial read
//   (B) update(...).eq("id", ...).eq("status","accepted").select("id")
//                                                              — claim (awaited directly)
//   (C) select("status, refund_ref").eq("id", ...).maybeSingle()
//                                                              — post-race re-read
//   (D) update(...).eq("id", ...).eq("status","paid")         — activate (awaited directly)
// (B) and (D) are told apart by the patch's own `status` value; (A) and (C)
// by whether the selected columns include "hourly_rate" (only (A) does).
type QueryResult = { data: unknown; error: unknown };
interface Chain {
  select: Mock<(cols: string) => Chain>;
  update: Mock<(patch: Record<string, unknown>) => Chain>;
  eq: Mock<(col: string, val: unknown) => Chain>;
  maybeSingle: Mock<() => Promise<QueryResult>>;
  then: <T>(
    onFulfilled: (v: QueryResult) => T,
    onRejected: (e: unknown) => T
  ) => Promise<T>;
}

function sessionsFrom(): Chain {
  let selectCols = "";
  let updatePatch: Record<string, unknown> | undefined;

  const chain: Chain = {
    select: vi.fn((cols: string) => {
      selectCols = cols;
      return chain;
    }),
    update: vi.fn((patch: Record<string, unknown>) => {
      updatePatch = patch;
      updateSpy(patch);
      return chain;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      eqSpy(col, val);
      return chain;
    }),
    maybeSingle: vi.fn(() => {
      if (selectCols.includes("hourly_rate")) {
        return Promise.resolve({ data: sessionRow, error: readError });
      }
      return Promise.resolve({ data: recheckRow, error: recheckError });
    }),
    then: (onFulfilled, onRejected) => {
      let result: QueryResult;
      if (updatePatch?.status === "paid") {
        result = { data: claimError ? null : claimRows, error: claimError };
      } else {
        result = { data: null, error: activateError };
      }
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      fromSpy(table);
      return sessionsFrom();
    },
  }),
}));

const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

const { settleVerifiedEvent } = await import("./settle");

// A session accepted well within its payment window, priced so 500/hr * 60min
// = 50000 paise, matching `event` below.
function baseSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "s1",
    status: "accepted",
    accept_deadline: null,
    payment_deadline: new Date(Date.now() + 60_000).toISOString(),
    started_at: null,
    duration_minutes: 60,
    hourly_rate: 500,
    payment_ref: "pay_1",
    amount_paid_paise: null,
    refund_ref: null,
    ...overrides,
  };
}

const event: WebhookEvent = {
  sessionId: "s1",
  amountPaise: 50000,
  paymentRef: "pay_1",
  kind: "succeeded",
};

beforeEach(() => {
  sessionRow = baseSession();
  readError = null;
  claimRows = [{ id: "s1" }];
  claimError = null;
  recheckRow = null;
  recheckError = null;
  activateError = null;
  updateSpy.mockReset();
  eqSpy.mockReset();
  fromSpy.mockReset();
  refundSession.mockReset();
  createSessionRoom.mockReset();
  createSessionRoom.mockResolvedValue({ url: "https://daily.example/r", name: "smb-s1" });
  consoleErrorSpy.mockClear();
  consoleInfoSpy.mockClear();
});

describe("settleVerifiedEvent", () => {
  // 1. A non-succeeded event touches nothing and answers 200 — deleting this
  // guard would still return 200 for a null session read, but it would reach
  // the db first, which fromSpy below catches.
  it.each(["failed", "ignored"] as const)(
    "does nothing and answers 200 for a %s event",
    async (kind) => {
      const res = await settleVerifiedEvent({ ...event, kind });
      expect(res.status).toBe(200);
      expect(fromSpy).not.toHaveBeenCalled();
    }
  );

  // 2. A read failure asks for a retry (503), not 200 — 200 would tell the
  // provider this event is handled forever.
  it("answers 503 when the session read fails", async () => {
    readError = new Error("connection reset");
    const res = await settleVerifiedEvent(event);
    expect(res.status).toBe(503);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  // 3. An absent row is a different fact from a read failure: 200, not 503 —
  // there is nothing here to ever retry.
  it("answers 200, not 503, when no session row exists", async () => {
    sessionRow = null;
    readError = null;
    const res = await settleVerifiedEvent(event);
    expect(res.status).toBe(200);
  });

  // 4. A payment-reference mismatch writes nothing and refunds nothing —
  // money that cannot be attributed must not be stamped onto this row.
  it("writes nothing and refunds nothing on a payment-reference mismatch", async () => {
    sessionRow = baseSession({ payment_ref: "pay_OTHER" });
    const res = await settleVerifiedEvent(event);
    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("REFERENCE MISMATCH")
    );
  });

  // 5. Already resolved is a no-op on redelivery — two independent triggers,
  // status and refund_ref, both have to short-circuit on their own.
  it("no-ops when the session is already active", async () => {
    sessionRow = baseSession({ status: "active" });
    const res = await settleVerifiedEvent(event);
    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
    expect(consoleInfoSpy).toHaveBeenCalled();
  });

  it("no-ops when refund_ref is already set, even for a non-terminal status", async () => {
    sessionRow = baseSession({ status: "accepted", refund_ref: "rfnd_prior" });
    const res = await settleVerifiedEvent(event);
    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
  });

  // 6. A tampered checkout must not buy the session at the wrong price.
  it("refunds and does not activate on an amount mismatch", async () => {
    const res = await settleVerifiedEvent({ ...event, amountPaise: 12345 });
    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: "s1", paymentRef: "pay_1", amountPaise: 12345,
        nextStatus: null, logPrefix: "[webhook]",
      })
    );
    expect(String(refundSession.mock.calls[0][1].why)).toEqual(
      expect.stringContaining("amount mismatch")
    );
  });

  // The release branch: the student paid, but the row had already moved on
  // (here, the payment window lapsed) by the time this event was processed.
  // Never keep the money, never resurrect a session whose teacher moved on.
  it("refunds at the row's true status when payment arrives after it already expired", async () => {
    sessionRow = baseSession({
      status: "accepted",
      payment_deadline: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await settleVerifiedEvent(event);
    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nextStatus: "payment_expired" })
    );
  });

  describe("the claim race", () => {
    // A real DB failure on the claim write must retry, not silently accept
    // money with no record of it.
    it("answers 503 when the claim write itself errors", async () => {
      claimError = new Error("db unavailable");
      const res = await settleVerifiedEvent(event);
      expect(res.status).toBe(503);
      expect(refundSession).not.toHaveBeenCalled();
    });

    // A failed re-read after losing the claim is the wrongest failure mode
    // in the file (per the code's own comment): it must retry, not answer
    // 200 for a charge never claimed and never refunded.
    it("answers 503 when the post-race re-read fails", async () => {
      claimRows = [];
      recheckError = new Error("connection reset");
      const res = await settleVerifiedEvent(event);
      expect(res.status).toBe(503);
      expect(refundSession).not.toHaveBeenCalled();
    });

    it("answers 200 and does not refund when the row vanished after losing the race", async () => {
      claimRows = [];
      recheckRow = null;
      recheckError = null;
      const res = await settleVerifiedEvent(event);
      expect(res.status).toBe(200);
      expect(refundSession).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("vanished")
      );
    });

    it("does not refund when the re-read shows a concurrent delivery already resolved it", async () => {
      claimRows = [];
      recheckRow = { status: "paid", refund_ref: null };
      const res = await settleVerifiedEvent(event);
      expect(res.status).toBe(200);
      expect(refundSession).not.toHaveBeenCalled();
    });

    it("refunds exactly as the row's true status when the race is genuinely lost", async () => {
      claimRows = [];
      recheckRow = { status: "cancelled", refund_ref: null };
      const res = await settleVerifiedEvent(event);
      expect(res.status).toBe(200);
      expect(refundSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ nextStatus: null })
      );
      expect(String(refundSession.mock.calls[0][1].why)).toEqual(
        expect.stringContaining("lost the claim race")
      );
    });
  });

  describe("the repair path", () => {
    // `paid` with no started_at means a prior attempt claimed the charge and
    // did not finish. A redelivery must repair — mint and activate — not
    // re-run the claim CAS (which would never match, since the row is not
    // `accepted` any more).
    it("repairs a claimed-but-unfinished row instead of re-claiming it", async () => {
      sessionRow = baseSession({
        status: "paid",
        payment_deadline: new Date(Date.now() - 1000).toISOString(),
      });
      const res = await settleVerifiedEvent(event);
      expect(res.status).toBe(200);
      expect(refundSession).not.toHaveBeenCalled();
      expect(createSessionRoom).toHaveBeenCalled();
      // Exactly one write — the activate. A second, earlier call with
      // status "paid" would mean the CAS ran again instead of being skipped.
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: "active" })
      );
    });

    // Past the repair deadline, activating would hand the student a room
    // that expires mid-lesson, and `active` has no route back to `refunded`.
    it("refunds instead of activating once the repair window has passed", async () => {
      sessionRow = baseSession({
        status: "paid",
        payment_deadline: new Date(Date.now() - 20 * 60_000).toISOString(),
      });
      const res = await settleVerifiedEvent(event);
      expect(res.status).toBe(200);
      expect(createSessionRoom).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(refundSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ nextStatus: "refunded" })
      );
      expect(String(refundSession.mock.calls[0][1].why)).toEqual(
        expect.stringContaining("repair arrived too late")
      );
    });
  });

  describe("room creation", () => {
    it("refunds when the room cannot be created (both attempts fail)", async () => {
      createSessionRoom.mockRejectedValue(new Error("Daily is down"));
      const res = await settleVerifiedEvent(event);
      expect(res.status).toBe(200);
      // The claim landed (status "paid") but activation never happened.
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: "paid" })
      );
      expect(refundSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ nextStatus: "refunded" })
      );
      expect(String(refundSession.mock.calls[0][1].why)).toEqual(
        expect.stringContaining("room could not be created")
      );
    });

    it("retries once and activates when the second mint attempt succeeds", async () => {
      createSessionRoom
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValueOnce({ url: "https://daily.example/r2", name: "smb-s1" });
      const res = await settleVerifiedEvent(event);
      expect(res.status).toBe(200);
      expect(createSessionRoom).toHaveBeenCalledTimes(2);
      expect(refundSession).not.toHaveBeenCalled();
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: "active", daily_room_url: "https://daily.example/r2" })
      );
    });
  });

  // 10. The happy path.
  it("claims, mints a room, and activates on the happy path", async () => {
    const res = await settleVerifiedEvent(event);
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: "paid", amount_paid_paise: 50000, payment_provider: "stub",
      })
    );
    expect(updateSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: "active", daily_room_url: "https://daily.example/r" })
    );
    // The two writes are guarded on the statuses the header comment names:
    // the claim is a CAS on `accepted`, the activate is guarded on `paid`.
    expect(eqSpy).toHaveBeenCalledWith("status", "accepted");
    expect(eqSpy).toHaveBeenCalledWith("status", "paid");
    expect(refundSession).not.toHaveBeenCalled();
  });

  // A silent failure here is, per the code's own comment, the worst outcome
  // in the file: money taken, room minted, row stranded at `paid` forever,
  // with a 200 telling the provider not to retry. It must retry instead.
  it("answers 503 and does not refund when the activate write itself errors", async () => {
    activateError = new Error("row locked");
    const res = await settleVerifiedEvent(event);
    expect(res.status).toBe(503);
    expect(refundSession).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ACTIVATE FAILED"),
      expect.anything()
    );
  });
});
