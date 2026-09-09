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
  // Defaults reproduce the original mock's shape: the open-request read
  // errors, so every pre-existing test still fails at that exact point and
  // never reaches the teacher lookup or the insert below.
  openRequestRows: [] as unknown[],
  openRequestError: { message: "boom" } as { message: string } | null,
  teacherProfile: null as { id: string; hourly_rate: number; role: string } | null,
  insertError: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            // Two different profiles rows are read through this same table:
            // getIdentity() reads the CALLER's own row (eq("id", student
            // id)), and requestSession separately reads the TEACHER's row
            // (eq("id", input.teacherId)) to snapshot hourly_rate. Branching
            // on the id argument is what lets one mock serve both.
            eq: (_col: string, id: string) => ({
              single: async () => {
                if (state.teacherProfile && id === state.teacherProfile.id) {
                  return { data: state.teacherProfile, error: null };
                }
                return {
                  data: state.user
                    ? {
                        id: state.user.id,
                        role: "student",
                        full_name: "Test Student",
                        consent_version: state.consentVersion,
                      }
                    : null,
                  error: null,
                };
              },
            }),
          }),
        };
      }
      state.sessionsCalls += 1;
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({ data: state.openRequestRows, error: state.openRequestError }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: state.insertError ? null : { id: "session-1", student_name: "Test Student" },
              error: state.insertError,
            }),
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
  state.openRequestRows = [];
  state.openRequestError = { message: "boom" };
  state.teacherProfile = null;
  state.insertError = null;
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

describe("requestSession rate race", () => {
  // enforce_session_insert VALIDATES new.hourly_rate against the teacher's
  // live profile and raises 'hourly_rate must match the teacher profile' on a
  // mismatch — it does not snapshot the rate onto the row itself (the action
  // does that, reading it fresh right before this insert). Reachable in the
  // narrow window between that re-read and the trigger's own check, not the
  // wider one between the student loading the list and clicking Start, which
  // the re-read already closes. Verified live against the trigger: a
  // mismatched insert returns { code: "P0001", message: "hourly_rate must
  // match the teacher profile" }, which is the exact string this test and the
  // fix both key on.
  beforeEach(() => {
    // Past the open-request gate, so the insert itself is reached.
    state.openRequestError = null;
    state.openRequestRows = [];
    state.teacherProfile = { id: "teacher-1", hourly_rate: 500, role: "teacher" };
  });

  it("turns the raw trigger error into an explanation a student can act on", async () => {
    state.insertError = { message: "hourly_rate must match the teacher profile" };
    expect(await requestSession(validInput)).toEqual({
      error:
        "That teacher's rate changed while your request was being placed — try again to get their current price.",
    });
  });

  it("leaves every other insert failure with the generic message", async () => {
    state.insertError = { message: "some unrelated database error" };
    expect(await requestSession(validInput)).toEqual({
      error: "Couldn't start the request — try again.",
    });
  });
});
