import { describe, it, expect, vi, beforeEach } from "vitest";

// canBecomeTeacher itself is covered by src/lib/routes.test.ts with plain
// numbers. What isn't covered is the call site that produces those numbers:
// a failed Postgrest count query returns { count: null, error: ... }, and
// null is indistinguishable from a genuine zero unless the error is checked
// first. These tests mock the Supabase server client to force that failure
// and assert the guard fails closed — refuses AND performs no profile write.
const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  sessionError: null as null | { message: string },
  subjectError: null as null | { message: string },
  profileUpdateCalls: [] as unknown[],
  rpcCalls: [] as { fn: string; args: unknown }[],
  rpcError: null as null | { message: string },
}));

// redirect() ends the happy path by throwing, the way Next's really does.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;push;${to};307;` });
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
    },
    from: (table: string) => {
      if (table === "sessions") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve(
                state.sessionError
                  ? { data: null, error: state.sessionError, count: null }
                  : { data: [], error: null, count: 0 }
              ),
          }),
        };
      }
      if (table === "teacher_subjects") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve(
                state.subjectError
                  ? { data: null, error: state.subjectError, count: null }
                  : { data: [], error: null, count: 0 }
              ),
          }),
          insert: () => Promise.resolve({ error: null }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: state.user?.id, role: "student" },
                error: null,
              }),
            }),
          }),
          update: (payload: unknown) => {
            state.profileUpdateCalls.push(payload);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table in mock: ${table}`);
    },
    rpc: async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args });
      return { error: state.rpcError };
    },
  }),
}));

import { signUpTutor } from "./actions";

function validTutorFormData(): FormData {
  const fd = new FormData();
  fd.set("fullName", "Google Newcomer");
  fd.set("email", "newcomer@example.com");
  fd.set("password", "password123");
  fd.set("phone", "9876543210");
  fd.set("experience", "5");
  fd.set("qualification", "PhD in Physics");
  fd.set("hourlyRate", "500");
  fd.set("hoursPerWeek", "10-20");
  fd.set("demoVideoUrl", "https://youtube.com/watch?v=abc");
  fd.append("curricula", "CBSE");
  fd.append("grades", "10th");
  fd.append("subjects", "Science|Physics");
  return fd;
}

beforeEach(() => {
  state.user = { id: "existing-user-id" };
  state.sessionError = null;
  state.subjectError = null;
  state.profileUpdateCalls = [];
  state.rpcCalls = [];
  state.rpcError = null;
});

describe("signUpTutor — history-check failure closed", () => {
  it("refuses and writes nothing when the session count query errors", async () => {
    state.sessionError = { message: "connection reset" };

    const result = await signUpTutor(null, validTutorFormData());

    expect(result).toEqual({ error: "Couldn't verify this account. Try again in a moment." });
    expect(state.profileUpdateCalls).toHaveLength(0);
  });

  it("refuses and writes nothing when the subject count query errors", async () => {
    state.subjectError = { message: "connection reset" };

    const result = await signUpTutor(null, validTutorFormData());

    expect(result).toEqual({ error: "Couldn't verify this account. Try again in a moment." });
    expect(state.profileUpdateCalls).toHaveLength(0);
  });
});

// Migration 0013 makes profiles.role immutable to ordinary updates, because
// 0001's policy constrained WHO may write a row and never WHICH COLUMNS — a
// signed-in student could PATCH themselves to "teacher" with the public anon
// key (demonstrated live, 2026-09-04). The upgrade therefore has to go through
// become_teacher, which re-checks canBecomeTeacher in SQL. If this ever
// regresses to a direct update, onboarding breaks outright against the real
// database — so pin it here where it fails fast instead.
describe("signUpTutor — the upgrade goes through become_teacher", () => {
  it("calls the RPC and never writes role directly", async () => {
    await expect(signUpTutor(null, validTutorFormData())).rejects.toThrow("NEXT_REDIRECT");

    const call = state.rpcCalls.find((c) => c.fn === "become_teacher");
    expect(call).toBeDefined();
    expect(call!.args).toEqual({
      p_full_name: "Google Newcomer",
      p_phone: "9876543210",
      p_hourly_rate: 500,
    });

    // The later profile-enrichment update is expected; a role write is not.
    for (const payload of state.profileUpdateCalls) {
      expect(payload).not.toHaveProperty("role");
    }
  });

  it("surfaces the history refusal rather than flattening it", async () => {
    // Spec §5.1's "must never happen" case: an account with real session
    // history converting to a teacher. The RPC is the thing that can still
    // catch it when the TypeScript pre-check passed on stale counts, so the
    // user needs to be told WHICH rule refused, not just that something did.
    state.rpcError = { message: "account has history and cannot be converted" };

    const result = await signUpTutor(null, validTutorFormData());

    expect(result).toEqual({
      error:
        "This account has already been used for sessions, so it can't be converted to a teacher account. Sign out and register with a different email.",
    });
  });

  it("falls back to the generic message for any other RPC failure", async () => {
    state.rpcError = { message: "connection reset by peer" };

    const result = await signUpTutor(null, validTutorFormData());

    expect(result).toEqual({
      error: "Could not upgrade this account to a teacher account.",
    });
  });
});
