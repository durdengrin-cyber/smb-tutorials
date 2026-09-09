"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireConsentedUser } from "@/lib/auth";
import { parseTeacherProfile } from "@/lib/validation";
import {
  echoTeacherProfile,
  type TeacherProfileState,
} from "@/lib/form-state";

export async function updateTeacherProfile(
  _prev: TeacherProfileState,
  formData: FormData
): Promise<TeacherProfileState> {
  // Echoed on every failure. This form already re-seeds from SAVED data, so a
  // rejected save silently reverted whatever the teacher had just typed — a
  // quieter failure than the signup form's blank one, and easier to miss.
  const values = echoTeacherProfile(formData);
  const fail = (error: string): TeacherProfileState => ({ error, values });

  // requireConsentedUser(), not requireRole(): a Server Action is resolved by
  // ID and run BEFORE any page renders, so requireRole()'s underlying
  // requireUser() redirect never gets a chance to fire for a direct call —
  // see the comment on requireConsentedUser in src/lib/auth.ts. The other
  // three actions.ts files under (app) — (student)/sessions,
  // (student)/teachers and (teacher)/dashboard — follow the same pattern.
  // Outside (app), (gate)/consent/actions.ts uses requireUser() and
  // (marketing)/tutor-signup/actions.ts a bare getUser(), so the claim does
  // not reach past this route group. The role check below is this action's
  // own: requireConsentedUser() authenticates any signed-in, consented
  // account, teacher or student.
  const identity = await requireConsentedUser();
  if (!identity || identity.role !== "teacher") {
    return fail("Sign in as a teacher to edit your profile.");
  }

  const parsed = parseTeacherProfile(formData);
  if (!parsed.ok) return fail(parsed.error);
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
    return fail("Couldn't update your subjects — try again. Nothing was changed.");
  }

  const { error: insertError } = await supabase
    .from("teacher_subjects")
    .insert(v.subjects.map((s) => ({ teacher_id: identity.userId, ...s })));
  if (insertError) {
    console.error("[updateTeacherProfile] subject insert failed", insertError);
    // The delete above already succeeded, so this teacher now has NO
    // subjects, not stale ones — a materially worse state that needs its own
    // message rather than reusing the delete-failure wording above.
    //
    // And the dashboard's "You're live for" card (which reads teacher_subjects
    // directly) is now serving a cache of subjects that no longer exist in the
    // database — without this, the teacher would be invisible in search while
    // their own dashboard kept showing them as live. Revalidate before
    // returning, not after some later success that may never come.
    revalidatePath("/dashboard");
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
    // The delete+insert above already committed the NEW subject list, so the
    // dashboard's cached "You're live for" card is stale even though the rate
    // and other profile fields didn't change — same reasoning as the insert
    // failure above, just with subjects that changed rather than vanished.
    revalidatePath("/dashboard");
    return {
      error: "Your subjects saved, but your rate and other details didn't — try again.",
    };
  }

  // The dashboard's "You're live for" card reads teacher_subjects directly.
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return null;
}
