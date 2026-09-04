import { describe, it, expect, vi, beforeEach } from "vitest";
import { CONSENT_VERSION } from "@/lib/consent";

// createCheckout and verifyPaymentNow used to authenticate with a bare
// `supabase.auth.getUser()` — no requireUser(), no consent check. A Server
// Action is resolved by ID and run BEFORE any page renders, so requireUser()'s
// redirect to /consent could never have protected them anyway.
// requireConsentedUser() is the backstop; these tests are what would have
// caught its absence. The session lookup is mocked to return nothing, so a
// consented caller reaches the ordinary "no such session" outcome rather than
// this fix's own gate refusing it — proof the gate let it through, without
// reaching into the payment flow this fix does not touch.
const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  consentVersion: null as string | null,
  sessionsCalls: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: state.user
                  ? {
                      id: state.user.id,
                      role: "student",
                      full_name: "Test Student",
                      consent_version: state.consentVersion,
                    }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }
      state.sessionsCalls += 1;
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      };
    },
  }),
}));

import { createCheckout, verifyPaymentNow } from "./payment-actions";

beforeEach(() => {
  state.user = { id: "student-1" };
  state.consentVersion = CONSENT_VERSION;
  state.sessionsCalls = 0;
});

describe("createCheckout consent gate", () => {
  it("refuses an unconsented account", async () => {
    state.consentVersion = null;
    expect(await createCheckout("s1")).toEqual({ error: "Sign in to pay for this session." });
    expect(state.sessionsCalls).toBe(0);
  });

  it("lets a consented account past the gate", async () => {
    expect(await createCheckout("s1")).toEqual({ error: "Session not found." });
    expect(state.sessionsCalls).toBeGreaterThan(0);
  });
});

describe("verifyPaymentNow consent gate", () => {
  it("refuses an unconsented account", async () => {
    state.consentVersion = null;
    await expect(verifyPaymentNow("s1")).resolves.toBeUndefined();
    expect(state.sessionsCalls).toBe(0);
  });

  it("lets a consented account past the gate", async () => {
    await expect(verifyPaymentNow("s1")).resolves.toBeUndefined();
    expect(state.sessionsCalls).toBeGreaterThan(0);
  });
});
