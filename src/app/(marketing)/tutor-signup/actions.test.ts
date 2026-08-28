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
