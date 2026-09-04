import { describe, it, expect, vi, beforeEach } from "vitest";
import { CONSENT_VERSION } from "@/lib/consent";

// These three actions used to authenticate with a bare `supabase.auth.getUser()`
// — no requireUser(), no consent check. A Server Action is resolved by ID and
// run BEFORE any page renders, so requireUser()'s redirect to /consent could
// never have protected them anyway. requireConsentedUser() is the backstop;
// these tests are what would have caught its absence.
const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  consentVersion: null as string | null,
  sessionsCalls: 0,
  updateError: null as null | { message: string },
  matchedRows: [{ id: "s1" }] as unknown[],
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
      // "sessions": a single chainable builder. Counting calls to it is what
      // lets the "consented" tests prove the code reached the database at
      // all, distinct from the "unconsented" tests proving it never did.
      state.sessionsCalls += 1;
      const builder = {
        update: () => builder,
        eq: () => builder,
        in: () => builder,
        lt: () => builder,
        select: async () => ({ data: state.matchedRows, error: state.updateError }),
        then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
          resolve({ data: state.matchedRows, error: state.updateError }),
      };
      return builder;
    },
  }),
}));

import { cancelSession, completeSession, timeOutSession } from "./actions";

beforeEach(() => {
  state.user = { id: "student-1" };
  state.consentVersion = CONSENT_VERSION;
  state.sessionsCalls = 0;
  state.updateError = null;
  state.matchedRows = [{ id: "s1" }];
});

describe("cancelSession consent gate", () => {
  it("refuses an unconsented account", async () => {
    state.consentVersion = null;
    expect(await cancelSession("s1")).toEqual({ cancelled: false });
    expect(state.sessionsCalls).toBe(0);
  });

  it("lets a consented account proceed", async () => {
    expect(await cancelSession("s1")).toEqual({ cancelled: true });
    expect(state.sessionsCalls).toBeGreaterThan(0);
  });
});

describe("completeSession consent gate", () => {
  it("refuses an unconsented account", async () => {
    state.consentVersion = null;
    await completeSession("s1");
    expect(state.sessionsCalls).toBe(0);
  });

  it("lets a consented account proceed", async () => {
    await completeSession("s1");
    expect(state.sessionsCalls).toBeGreaterThan(0);
  });
});

describe("timeOutSession consent gate", () => {
  it("refuses an unconsented account", async () => {
    state.consentVersion = null;
    await timeOutSession("s1");
    expect(state.sessionsCalls).toBe(0);
  });

  it("lets a consented account proceed", async () => {
    await timeOutSession("s1");
    expect(state.sessionsCalls).toBeGreaterThan(0);
  });
});
