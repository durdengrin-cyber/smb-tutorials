import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | Record<string, unknown>,
  pathname: "/sessions",
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-pathname", state.pathname]]),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: state.profile, error: null }) }),
      }),
    }),
  }),
}));

import { requireUser, requireConsentedUser } from "./auth";
import { CONSENT_VERSION } from "./consent";

beforeEach(() => {
  state.user = { id: "u1" };
  state.pathname = "/sessions";
  state.profile = {
    id: "u1", role: "student", full_name: "Asha", consent_version: CONSENT_VERSION,
  };
});

describe("requireUser consent gate", () => {
  // The live hole: Google sign-in mints an account with no consent at all.
  it("sends an account with no consent to /consent", async () => {
    state.profile = { id: "u1", role: "student", full_name: "Asha", consent_version: null };
    // state.pathname is /sessions; the gate now carries it through.
    await expect(requireUser()).rejects.toMatchObject({
      to: "/consent?next=%2Fsessions",
    });
  });

  it("sends an account on a superseded version to /consent", async () => {
    state.profile = { id: "u1", role: "student", full_name: "Asha", consent_version: "2026-09-04" };
    await expect(requireUser()).rejects.toMatchObject({
      to: "/consent?next=%2Fsessions",
    });
  });

  it("lets a consented account through", async () => {
    await expect(requireUser()).resolves.toMatchObject({ userId: "u1" });
  });

  // Without this the gate redirects /consent to itself, forever.
  it("does not redirect /consent to itself", async () => {
    state.profile = { id: "u1", role: "student", full_name: "Asha", consent_version: null };
    state.pathname = "/consent";
    await expect(requireUser()).resolves.toMatchObject({ userId: "u1" });
  });

  // proxy-session.ts forwards pathname + query string as x-pathname
  // (request.nextUrl.pathname + request.nextUrl.search). Comparing that raw
  // value against "/consent" is query-sensitive: a linked
  // "/consent?next=..." would fail the exemption and reopen the loop this
  // test above just closed.
  // A CONSENT_VERSION bump interrupts people mid-task, and the bare redirect
  // threw away where they were going. /sessions never links a live call, so a
  // student who refreshed during a paid lesson — or sat on /waiting after
  // paying — consented and had no route back into it but browser history.
  it("carries the attempted path through to /consent", async () => {
    state.profile = { id: "u1", role: "student", full_name: "Asha", consent_version: "2026-09-05-guardian" };
    state.pathname = "/waiting/abc-123";
    await expect(requireUser()).rejects.toMatchObject({
      to: "/consent?next=%2Fwaiting%2Fabc-123",
    });
  });

  it("keeps the query string of the attempted path", async () => {
    state.profile = { id: "u1", role: "student", full_name: "Asha", consent_version: null };
    state.pathname = "/call/s1?rejoin=1";
    await expect(requireUser()).rejects.toMatchObject({
      to: "/consent?next=%2Fcall%2Fs1%3Frejoin%3D1",
    });
  });

  it("does not redirect /consent to itself when a query string is present", async () => {
    state.profile = { id: "u1", role: "student", full_name: "Asha", consent_version: null };
    state.pathname = "/consent?next=%2Fsessions";
    await expect(requireUser()).resolves.toMatchObject({ userId: "u1" });
  });
});

describe("requireConsentedUser", () => {
  // The gate this exists to close: a Server Action bypasses requireUser()'s
  // redirect entirely (Next resolves an action by ID and runs it before any
  // page renders), so this is the only check standing between an unconsented
  // account and a mutation.
  it("refuses an account that has not consented", async () => {
    state.profile = { id: "u1", role: "student", full_name: "Asha", consent_version: null };
    await expect(requireConsentedUser()).resolves.toBeNull();
  });

  it("refuses an account on a superseded version", async () => {
    state.profile = { id: "u1", role: "student", full_name: "Asha", consent_version: "2026-09-04" };
    await expect(requireConsentedUser()).resolves.toBeNull();
  });

  it("refuses a signed-out caller", async () => {
    state.user = null;
    await expect(requireConsentedUser()).resolves.toBeNull();
  });

  it("returns the identity for a consented account", async () => {
    await expect(requireConsentedUser()).resolves.toMatchObject({ userId: "u1" });
  });
});
