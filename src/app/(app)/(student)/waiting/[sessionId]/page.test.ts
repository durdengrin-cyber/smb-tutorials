import { describe, it, expect, vi, beforeEach } from "vitest";

// Stubbed to avoid pulling in the full session/payment action chain (Stripe,
// Razorpay, the realtime client) that waiting-client.tsx imports — none of it
// runs in the scenarios below, which redirect before WaitingClient ever
// renders. Same reasoning as online-list.test.tsx stubbing ./actions.
vi.mock("./waiting-client", () => ({ WaitingClient: () => null }));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ userId: "student_1" })),
}));

vi.mock("@/lib/suspension/settle", () => ({
  settleSuspension: vi.fn(async () => false),
}));

let sessionRow: Record<string, unknown>;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "sessions") {
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: sessionRow }) }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { full_name: "Ms Rao" } }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in test: ${table}`);
    },
  }),
}));

const { default: WaitingPage } = await import("./page");

function propsFor(sessionId: string) {
  return {
    params: Promise.resolve({ sessionId }),
    searchParams: Promise.resolve({}),
  };
}

// Every scenario below redirects before returning JSX, so this always throws.
async function redirectedTo(sessionId = "s1"): Promise<string> {
  await expect(WaitingPage(propsFor(sessionId))).rejects.toThrow("REDIRECT:");
  const call = redirectMock.mock.calls.at(-1);
  if (!call) throw new Error("redirect was never called");
  return call[0];
}

beforeEach(() => {
  redirectMock.mockClear();
  // A session cancelled because its teacher was suspended (settleSuspension's
  // pending/accepted branch): money never moved, so refund_ref is null. This
  // is the shape that exposed the bug — amountPaise (the session's PRICE) is
  // always computable from hourly_rate x duration, whether or not anything
  // was ever charged.
  sessionRow = {
    id: "s1",
    student_id: "student_1",
    teacher_id: "teacher_1",
    curriculum: "CBSE",
    grade: "10",
    stream: "",
    subject: "Maths",
    status: "cancelled",
    accept_deadline: null,
    payment_deadline: null,
    started_at: null,
    duration_minutes: 60,
    hourly_rate: 500,
    refund_ref: null,
    cancellation_reason: "teacher_suspended",
  };
});

describe("WaitingPage exit to /teachers on teacher_unavailable", () => {
  // The regression this pins: attaching `amount` unconditionally on
  // teacher_unavailable told a never-charged student they'd been refunded.
  // Reverting the guard in page.tsx (attaching amount for every
  // teacher_unavailable/refunded outcome, regardless of refund_ref) makes
  // this fail.
  it("carries no amount when the session was cancelled, not refunded", async () => {
    const url = await redirectedTo();
    const query = new URL(url, "http://test").searchParams;
    expect(query.get("outcome")).toBe("teacher_unavailable");
    expect(query.has("amount")).toBe(false);
  });

  it("carries the amount when the session actually carries a refund_ref", async () => {
    sessionRow.refund_ref = "rfnd_1";
    const url = await redirectedTo();
    const query = new URL(url, "http://test").searchParams;
    expect(query.get("outcome")).toBe("teacher_unavailable");
    // hourly_rate 500 x 60 minutes -> 500 rupees -> 50000 paise.
    expect(query.get("amount")).toBe("50000");
  });
});
