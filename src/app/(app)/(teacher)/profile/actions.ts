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
  // profile" policy is what authorises the write below.
  const supabase = await createClient();

  // Subjects are NOT written here any more. 0027 removed the teacher's INSERT
  // and DELETE policies on teacher_subjects, because changing what you claim
  // to be qualified to teach a child is not a form field — it goes through
  // request_subject_change, which carries a new demo video, and takes effect
  // only when an admin approves it.
  //
  // The careful delete-then-insert ordering that used to live here, and its
  // "your subjects are now empty" recovery message, are gone with it: there is
  // no longer a half-state to recover from, because this action touches one
  // table.
  //
  // v.subjects is parsed but ignored: the profile form submits none (the
  // picker is read-only there), so it arrives empty, and parseTeacherProfile
  // passes requireSubjects: false for exactly that reason.

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
