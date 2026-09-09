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
  signUpCalls: [] as { email: string; options?: { data?: Record<string, unknown> } }[],
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
      signUp: async (args: { email: string; options?: { data?: Record<string, unknown> } }) => {
        state.signUpCalls.push(args);
        return { data: { user: { id: "new-teacher-id" } }, error: null };
      },
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
import { CONSENT_VERSION } from "@/lib/consent";

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
  fd.set("demoVideoUrl", "https://youtube.com/watch?v=dQw4w9WgXcQ");
  fd.append("curricula", "CBSE");
  fd.append("grades", "10th");
  fd.append("subjects", "Science|Physics");
  fd.set("consent", "yes");
  return fd;
}

// The dual-nature bug. /tutor-signup is reachable while signed in, and this
// branch upgrades the existing account through become_teacher without ever
// reading an email or a password — but parseTutorSignUp demanded both, so the
// form made a signed-in student invent an 8-character password that was then
// discarded. Nothing told them it had been discarded, so the reasonable
// conclusion was that they had just set their password.
describe("signUpTutor — a signed-in account needs no credentials", () => {
  function upgradeFormData(): FormData {
    const fd = validTutorFormData();
    fd.delete("email");
    fd.delete("password");
    return fd;
  }

  it("upgrades an existing account from a form carrying neither", async () => {
    state.user = { id: "existing-user-id" };
    // Success ends in redirect("/setup"), which the mock throws. Reaching the
    // throw IS the pass: before this change the call returned early with
    // "Enter a valid email address." instead.
    await expect(signUpTutor(null, upgradeFormData())).rejects.toThrow("NEXT_REDIRECT");
    expect(state.rpcCalls.some((c) => c.fn === "become_teacher")).toBe(true);
    // Nothing was created; the existing account was upgraded.
    expect(state.signUpCalls).toHaveLength(0);
  });

  it("still refuses a signed-OUT signup with no credentials", async () => {
    state.user = null;
    const result = await signUpTutor(null, upgradeFormData());
    expect(result?.error).toMatch(/email/i);
    expect(state.signUpCalls).toHaveLength(0);
  });

  // The session decides, never the form: a signed-out caller must not be able
  // to reach the credential-free path by omitting fields.
  it("creates the account normally when signed out and credentials are given", async () => {
    state.user = null;
    await expect(signUpTutor(null, validTutorFormData())).rejects.toThrow("NEXT_REDIRECT");
    expect(state.signUpCalls).toHaveLength(1);
  });
});


// A rejected application must hand back what was typed. Without this every
// failure path returns { error } alone, React 19 resets the form on action
// completion, and the teacher retypes fifteen fields.
describe("signUpTutor — a rejected application is handed back, not erased", () => {
  it("returns the submitted values alongside a validation error", async () => {
    state.user = null;
    const fd = validTutorFormData();
    fd.set("demoVideoUrl", "https://vimeo.com/123456789");

    const result = await signUpTutor(null, fd);

    expect(result?.error).toMatch(/YouTube/i);
    expect(result?.values?.fullName).toBe("Google Newcomer");
    expect(result?.values?.phone).toBe("9876543210");
    expect(result?.values?.qualification).toBe("PhD in Physics");
    expect(result?.values?.curricula).toEqual(["CBSE"]);
    expect(result?.values?.grades).toEqual(["10th"]);
    expect(result?.values?.subjects).toEqual(["Science|Physics"]);
    expect(result?.values?.consent).toBe(true);
    // and the rejected value itself, so they can see what was wrong
    expect(result?.values?.demoVideoUrl).toBe("https://vimeo.com/123456789");
  });

  it("never hands the password back", async () => {
    state.user = null;
    const fd = validTutorFormData();
    fd.set("demoVideoUrl", "https://vimeo.com/123456789");

    const result = await signUpTutor(null, fd);

    expect(JSON.stringify(result)).not.toContain("password123");
  });

  // Not only the validation path: an account-creation failure erases just as
  // much, and is likelier to be the one a real teacher hits twice.
  it("returns the values when the upgrade is refused, too", async () => {
    state.user = { id: "existing-user-id" };
    state.rpcError = { message: "account has history" };

    const result = await signUpTutor(null, validTutorFormData());

    expect(result?.error).toBeTruthy();
    expect(result?.values?.fullName).toBe("Google Newcomer");
  });
});

beforeEach(() => {
  state.user = { id: "existing-user-id" };
  state.sessionError = null;
  state.subjectError = null;
  state.profileUpdateCalls = [];
  state.rpcCalls = [];
  state.rpcError = null;
  state.signUpCalls = [];
});

describe("signUpTutor — history-check failure closed", () => {
  it("refuses and writes nothing when the session count query errors", async () => {
    state.sessionError = { message: "connection reset" };

    const result = await signUpTutor(null, validTutorFormData());

    expect(result).toMatchObject({ error: "Couldn't verify this account. Try again in a moment." });
    expect(state.profileUpdateCalls).toHaveLength(0);
  });

  it("refuses and writes nothing when the subject count query errors", async () => {
    state.subjectError = { message: "connection reset" };

    const result = await signUpTutor(null, validTutorFormData());

    expect(result).toMatchObject({ error: "Couldn't verify this account. Try again in a moment." });
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

    expect(result).toMatchObject({
      error:
        "This account has already been used for sessions, so it can't be converted to a teacher account. Sign out and register with a different email.",
    });
  });

  it("falls back to the generic message for any other RPC failure", async () => {
    state.rpcError = { message: "connection reset by peer" };

    const result = await signUpTutor(null, validTutorFormData());

    expect(result).toMatchObject({
      error: "Could not upgrade this account to a teacher account.",
    });
  });
});

// 0014 recorded consent for students and stopped there, so every teacher on the
// platform had consent_accepted_at NULL — the checkbox they ticked left no
// trace. Both routes into a teacher account have to leave one: a fresh signup,
// and the Google account that arrived as a student and is upgrading. The
// timestamp is the SERVER's in both cases; the client only ever says whether.
describe("signUpTutor — consent is recorded, not just required", () => {
  it("stamps consent onto a brand-new teacher signup", async () => {
    state.user = null;

    await expect(signUpTutor(null, validTutorFormData())).rejects.toThrow("NEXT_REDIRECT");

    expect(state.signUpCalls).toHaveLength(1);
    const meta = state.signUpCalls[0].options?.data ?? {};
    expect(meta.consent_version).toBe(CONSENT_VERSION);
    expect(Date.parse(String(meta.consent_accepted_at))).not.toBeNaN();
  });

  it("stamps consent when a Google account upgrades to a teacher", async () => {
    await expect(signUpTutor(null, validTutorFormData())).rejects.toThrow("NEXT_REDIRECT");

    // handle_new_user already ran for this account, as a student, with no
    // consent — Google sends none. The enrichment update is the only place
    // left to write it.
    const withConsent = state.profileUpdateCalls.find(
      (p) => (p as Record<string, unknown>).consent_version !== undefined
    ) as Record<string, unknown> | undefined;
    expect(withConsent).toBeDefined();
    expect(withConsent!.consent_version).toBe(CONSENT_VERSION);
    expect(Date.parse(String(withConsent!.consent_accepted_at))).not.toBeNaN();
  });

  it("logs a consent event when a Google account upgrades", async () => {
    await expect(signUpTutor(null, validTutorFormData())).rejects.toThrow("NEXT_REDIRECT");

    const call = state.rpcCalls.find((c) => c.fn === "record_consent");
    expect(call).toBeDefined();
    expect(call!.args).toEqual({
      p_version: CONSENT_VERSION,
      p_path: "tutor_signup",
      p_detail: null,
    });
  });
});
