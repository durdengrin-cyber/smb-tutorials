"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireConsentedUser } from "@/lib/auth";
import { parseTeacherProfile } from "@/lib/validation";
import type { AuthState } from "@/lib/form-state";

export async function updateTeacherProfile(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  // requireConsentedUser(), not requireRole(): a Server Action is resolved by
  // ID and run BEFORE any page renders, so requireRole()'s underlying
  // requireUser() redirect never gets a chance to fire for a direct call —
  // see the comment on requireConsentedUser in src/lib/auth.ts, and every
  // other actions.ts in this app follows the same pattern. The role check
  // below is this action's own: requireConsentedUser() authenticates any
  // signed-in, consented account, teacher or student.
  const identity = await requireConsentedUser();
  if (!identity || identity.role !== "teacher") {
    return { error: "Sign in as a teacher to edit your profile." };
  }

  const parsed = parseTeacherProfile(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;

  // Under the caller's own client, never the service role: RLS's "update own
  // profile", "teacher manages own subjects" and "teacher deletes own
  // subjects" policies (migration 0001) are what authorise every write below.
  const supabase = await createClient();

  // Subjects first, profile second. If the profile update lands and the
  // subject write then fails, the teacher ends up with a new rate and stale
  // subjects — a rate that no longer matches what it was set for. Doing the
  // subject replacement first means a failed profile update instead leaves
  // correct subjects and an old rate, which is the less wrong half.
  const { error: deleteError } = await supabase
    .from("teacher_subjects")
    .delete()
    .eq("teacher_id", identity.userId);
  if (deleteError) {
    console.error("[updateTeacherProfile] subject delete failed", deleteError);
    return { error: "Couldn't update your subjects — try again. Nothing was changed." };
  }

  const { error: insertError } = await supabase
    .from("teacher_subjects")
    .insert(v.subjects.map((s) => ({ teacher_id: identity.userId, ...s })));
  if (insertError) {
    console.error("[updateTeacherProfile] subject insert failed", insertError);
    // The delete above already succeeded, so this teacher now has NO
    // subjects, not stale ones — a materially worse state that needs its own
    // message rather than reusing the delete-failure wording above.
    return {
      error:
        "Your subjects are now empty because part of the save failed — reselect your subjects and try again.",
    };
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: v.fullName,
      phone: v.phone,
      experience_years: v.experienceYears,
      qualification: v.qualification,
      specialization: v.specialization,
      teaching_level: v.teachingLevel,
      hourly_rate: v.hourlyRate,
      hours_per_week: v.hoursPerWeek,
      demo_video_url: v.demoVideoUrl,
      bio: v.bio,
    })
    .eq("id", identity.userId);
  if (profileError) {
    console.error("[updateTeacherProfile] profile update failed", profileError);
    return {
      error: "Your subjects saved, but your rate and other details didn't — try again.",
    };
  }

  // The dashboard's "You're live for" card reads teacher_subjects directly.
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return null;
}
