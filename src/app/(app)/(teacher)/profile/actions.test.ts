import { describe, it, expect, vi, beforeEach } from "vitest";
import { CONSENT_VERSION } from "@/lib/consent";

// updateTeacherProfile authenticates through requireConsentedUser() rather
// than requireRole("teacher"): a Server Action is resolved by ID and run
// BEFORE any page renders, so requireRole()'s underlying requireUser()
// redirect never gets a chance to fire for a direct call. The role check is
// this action's own, since requireConsentedUser() accepts any signed-in,
// consented account.
const calls = vi.hoisted(() => ({
  deleteEq: vi.fn(),
  insert: vi.fn(),
  profileUpdateEq: vi.fn(),
}));

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  role: "teacher" as string,
  consentVersion: null as string | null,
  deleteError: null as null | { message: string },
  insertError: null as null | { message: string },
  profileError: null as null | { message: string },
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
                      role: state.role,
                      full_name: "Teacher",
                      consent_version: state.consentVersion,
                    }
                  : null,
                error: null,
              }),
            }),
          }),
          update: (payload: unknown) => ({
            eq: async (...args: unknown[]) => {
              calls.profileUpdateEq(payload, ...args);
              return { error: state.profileError };
            },
          }),
        };
      }
      // teacher_subjects
      return {
        delete: () => ({
          eq: async (...args: unknown[]) => {
            calls.deleteEq(...args);
            return { error: state.deleteError };
          },
        }),
        insert: async (rows: unknown[]) => {
          calls.insert(rows);
          return { error: state.insertError };
        },
      };
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { updateTeacherProfile } from "./actions";

function validFormData(): FormData {
  const fd = new FormData();
  const set = (k: string, v: string | string[]) =>
    (Array.isArray(v) ? v : [v]).forEach((x) => fd.append(k, x));
  set("fullName", "Dr. Rao");
  set("phone", "9876543210");
  set("experience", "8");
  set("qualification", "PhD Physics");
  set("specialization", "Mechanics");
  set("teachingLevel", "school");
  set("hourlyRate", "600");
  set("hoursPerWeek", "10-20");
  set("demoVideoUrl", "https://youtu.be/dQw4w9WgXcQ");
  set("bio", "Hello students");
  set("curricula", "CBSE");
  set("grades", ["11th", "12th"]);
  set("subjects", "Science|Physics");
  return fd;
}

beforeEach(() => {
  state.user = { id: "teacher-1" };
  state.role = "teacher";
  state.consentVersion = CONSENT_VERSION;
  state.deleteError = null;
  state.insertError = null;
  state.profileError = null;
  calls.deleteEq.mockClear();
  calls.insert.mockClear();
  calls.profileUpdateEq.mockClear();
  vi.mocked(revalidatePath).mockClear();
});

describe("updateTeacherProfile", () => {
  it("refuses an unauthenticated caller", async () => {
    state.user = null;
    expect(await updateTeacherProfile(null, validFormData())).toMatchObject({
      error: "Sign in as a teacher to edit your profile.",
    });
    expect(calls.deleteEq).not.toHaveBeenCalled();
  });

  // The form never gets to say who it is editing — role comes from the
  // caller's own session, not from anything the client sent.
  it("refuses a signed-in student", async () => {
    state.role = "student";
    expect(await updateTeacherProfile(null, validFormData())).toMatchObject({
      error: "Sign in as a teacher to edit your profile.",
    });
    expect(calls.deleteEq).not.toHaveBeenCalled();
  });

  it("rejects invalid input before writing anything", async () => {
    const fd = validFormData();
    fd.set("hourlyRate", "0");
    const result = await updateTeacherProfile(null, fd);
    expect(result?.error).toMatch(/rate/i);
    expect(calls.deleteEq).not.toHaveBeenCalled();
  });

  it("saves and revalidates both the profile and dashboard on full success", async () => {
    const result = await updateTeacherProfile(null, validFormData());
    expect(result).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/profile");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("says which half saved when subjects succeed but the profile update fails", async () => {
    state.profileError = { message: "boom" };
    const result = await updateTeacherProfile(null, validFormData());
    expect(result?.error).toMatch(/subjects saved/i);
    // Subjects already committed to their new value here, so the dashboard's
    // cache is stale even though the rate/profile fields didn't change.
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).not.toHaveBeenCalledWith("/profile");
  });
});

// 0027 took subjects out of this action entirely. Changing what you claim to
// be qualified to teach a child is not a form field: it goes through
// request_subject_change, carries a new demo video, and takes effect only when
// an admin approves it. The three tests that used to sit here documented the
// delete-then-insert ordering and its "your subjects are now empty" recovery
// message — a half-state that can no longer occur, because this action touches
// one table.
describe("updateTeacherProfile leaves subjects alone", () => {
  it("neither deletes nor inserts subjects", async () => {
    await updateTeacherProfile(null, validFormData());
    expect(calls.deleteEq).not.toHaveBeenCalled();
    expect(calls.insert).not.toHaveBeenCalled();
  });

  it("still saves the profile row", async () => {
    await updateTeacherProfile(null, validFormData());
    expect(calls.profileUpdateEq).toHaveBeenCalled();
  });

  // The delete used to run first, so a failing subject write left a teacher
  // with none. That failure mode is gone with the write itself: a broken
  // subject table cannot now affect a profile save at all.
  it("saves the profile even if the subject table would have refused", async () => {
    state.deleteError = { message: "permission denied for table teacher_subjects" };
    state.insertError = { message: "permission denied for table teacher_subjects" };
    const result = await updateTeacherProfile(null, validFormData());
    expect(result?.error).toBeUndefined();
    expect(calls.profileUpdateEq).toHaveBeenCalled();
  });
});
