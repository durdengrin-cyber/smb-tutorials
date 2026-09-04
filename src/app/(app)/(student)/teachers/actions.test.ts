import { describe, it, expect, vi, beforeEach } from "vitest";
import { CONSENT_VERSION } from "@/lib/consent";

// requestSession used to authenticate with a bare `supabase.auth.getUser()`
// — no requireUser(), no consent check. A Server Action is resolved by ID and
// run BEFORE any page renders, so requireUser()'s redirect to /consent could
// never have protected it anyway: an unconsented account could open a real
// session request, push a notification to a teacher, and start a checkout.
// requireConsentedUser() is the backstop; this test is what would have caught
// its absence. The open-request read is mocked to error, so a consented
// caller reaches THAT failure rather than this fix's own gate — proof the
// gate let it through, without reaching into the rest of the request flow.
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
        select: () => ({
          eq: () => ({
            in: async () => ({ data: null, error: { message: "boom" } }),
          }),
        }),
      };
    },
  }),
}));

import { requestSession } from "./actions";

const validInput = {
  teacherId: "teacher-1",
  subject: "Physics",
  curriculum: "CBSE",
  grade: "10th",
  stream: "Science",
};

beforeEach(() => {
  state.user = { id: "student-1" };
  state.consentVersion = CONSENT_VERSION;
  state.sessionsCalls = 0;
});

describe("requestSession consent gate", () => {
  it("refuses an unconsented account", async () => {
    state.consentVersion = null;
    expect(await requestSession(validInput)).toEqual({ error: "Sign in to start a session." });
    expect(state.sessionsCalls).toBe(0);
  });

  it("lets a consented account past the gate", async () => {
    expect(await requestSession(validInput)).toEqual({
      error: "Couldn't start the request — try again.",
    });
    expect(state.sessionsCalls).toBeGreaterThan(0);
  });
});
