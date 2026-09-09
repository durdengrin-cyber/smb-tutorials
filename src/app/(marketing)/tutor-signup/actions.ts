"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { notifyAdminsOfApplication } from "@/lib/notifications/dispatch";
import {
  parseTutorSignUp,
  parseTutorUpgrade,
  type TeacherProfileFields,
} from "@/lib/validation";
import { CONSENT_VERSION } from "@/lib/consent";
import { echoTutorForm, type TutorFormState } from "@/lib/form-state";
import { canBecomeTeacher, type Role } from "@/lib/routes";

export async function signUpTutor(
  _prev: TutorFormState,
  formData: FormData
): Promise<TutorFormState> {
  // Built once, up front, and attached to EVERY failure return below. React 19
  // resets the form when this action completes, so any path that returns
  // without these hands the teacher a blank fifteen-field application.
  const values = echoTutorForm(formData);
  const fail = (error: string): TutorFormState => ({ error, values });
  // Stamped once, here, so both routes into a teacher account record the same
  // agreement: the client says WHETHER they agreed, the server says WHEN.
  const consentAcceptedAt = new Date().toISOString();

  const supabase = await createClient();

  // Identity is resolved BEFORE parsing, because it decides which shape this
  // form is required to have. /tutor-signup is reachable while signed in — the
  // header offers "Go to your dashboard" on the same screen — and this branch
  // upgrades the existing account without ever reading an email or password.
  // parseTutorSignUp demanded both regardless, so a signed-in student had to
  // invent an 8-character password that was then discarded, with nothing
  // telling them it had been.
  //
  // The SESSION picks the parser, never a field the client sends: a signed-out
  // caller cannot reach the credential-free path and create an account with no
  // password.
  const {
    data: { user: existingUser },
  } = await supabase.auth.getUser();

  let teacherId: string;
  let v: TeacherProfileFields;

  if (existingUser) {
    const parsed = parseTutorUpgrade(formData);
    if (!parsed.ok) return fail(parsed.error);
    v = parsed.value;

    // Arrived via Google with teacher intent: handle_new_user() already
    // created this account as a student (Google sends no role). Upgrade it
    // only if it has no history — an account that has already been used
    // needs an admin action to change role, and admin is cycle 3.
    const [sessionRes, subjectRes] = await Promise.all([
      supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("student_id", existingUser.id),
      supabase
        .from("teacher_subjects")
        .select("teacher_id", { count: "exact", head: true })
        .eq("teacher_id", existingUser.id),
    ]);

    // A failed Postgrest query returns { count: null, error: ... }, which is
    // indistinguishable from a genuine zero unless the error is inspected
    // first. Failing open here would let a transient failure, an RLS change,
    // or schema drift silently convert an account with real history — the
    // one thing spec §5.1 says must never happen. Fail closed instead.
    if (sessionRes.error || subjectRes.error) {
      console.error("[tutorSignUp] history check failed", sessionRes.error ?? subjectRes.error);
      return fail("Couldn't verify this account. Try again in a moment.");
    }

    const { data: existing } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", existingUser.id)
      .single();

    if (
      !existing ||
      !canBecomeTeacher({
        role: existing.role as Role,
        sessionCount: sessionRes.count ?? 0,
        subjectCount: subjectRes.count ?? 0,
      })
    ) {
      return fail(
        "This account can't be converted to a teacher account. Sign out and register with a different email."
      );
    }

    // Through the RPC, not a direct update: migration 0013 makes profiles.role
    // immutable to ordinary updates, because 0001's policy constrained WHO may
    // write a row and never WHICH COLUMNS — so any signed-in student could
    // PATCH themselves to "teacher" from a browser with the public anon key.
    //
    // become_teacher re-checks canBecomeTeacher IN SQL. The TypeScript check
    // above is now the friendly half, kept because it produces a better
    // message and avoids a pointless round trip; the database is the half that
    // actually enforces the rule, for every caller and not just this one.
    const { error: upgradeError } = await supabase.rpc("become_teacher", {
      p_full_name: v.fullName,
      p_phone: v.phone,
      p_hourly_rate: v.hourlyRate,
    });
    if (upgradeError) {
      console.error("[tutorSignUp] profile upgrade failed", upgradeError);
      // The RPC raises a distinct message for an account with real history —
      // spec §5.1's "must never happen" case — which deserves saying out loud
      // rather than being flattened into a generic failure.
      const hasHistory = /has history/i.test(upgradeError.message ?? "");
      return fail(
        hasHistory
          ? "This account has already been used for sessions, so it can't be converted to a teacher account. Sign out and register with a different email."
          : "Could not upgrade this account to a teacher account."
      );
    }

    teacherId = existingUser.id;

    // handle_new_user wrote this account's profile long ago, as a student, and
    // Google sends no consent -- so nothing has logged the agreement this form
    // just collected. The RPC stamps auth.uid() and now() in SQL (0019).
    const { error: consentError } = await supabase.rpc("record_consent", {
      p_version: CONSENT_VERSION,
      p_path: "tutor_signup",
      p_detail: null,
    });
    if (consentError) {
      console.error("[tutorSignUp] consent log failed", consentError);
      return fail("Could not record your agreement. Try again in a moment.");
    }
  } else {
    const parsed = parseTutorSignUp(formData);
    if (!parsed.ok) return fail(parsed.error);
    v = parsed.value;

    const { data, error } = await supabase.auth.signUp({
      email: parsed.value.email,
      password: parsed.value.password,
      options: {
        data: {
          role: "teacher",
          full_name: v.fullName,
          phone: v.phone,
          // handle_new_user copies these onto the profile (0014), so the
          // consent survives independently of the auth record.
          consent_accepted_at: consentAcceptedAt,
          consent_version: CONSENT_VERSION,
        },
      },
    });
    if (error || !data.user) return fail(error?.message ?? "Sign up failed.");
    teacherId = data.user.id;
  }

  // handle_new_user already created the profile row; this enriches it.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      qualification: v.qualification,
      experience_years: v.experienceYears,
      specialization: v.specialization,
      teaching_level: v.teachingLevel,
      hourly_rate: v.hourlyRate,
      hours_per_week: v.hoursPerWeek,
      demo_video_url: v.demoVideoUrl,
      // The Google route has no other home for this: handle_new_user already
      // ran for that account, as a student, and Google sends no consent. Set
      // on the new-signup route too, where it is a harmless re-statement of
      // what handle_new_user just wrote, so neither route can drift into
      // leaving a teacher with no record of what they agreed to.
      consent_accepted_at: consentAcceptedAt,
      consent_version: CONSENT_VERSION,
    })
    .eq("id", teacherId);
  if (profileError) {
    return fail("Account created but profile save failed — sign in and retry.");
  }

  // Through set_initial_subjects, not a direct insert: 0027 removed the
  // teacher's INSERT policy on teacher_subjects so that changing what you
  // claim to teach has to go past an admin. The RPC is the one remaining way
  // in, and it refuses a second call — so this cannot become a back door for
  // the change flow it exists alongside.
  const { error: subjectsError } = await supabase.rpc("set_initial_subjects", {
    p_subjects: v.subjects,
  });
  if (subjectsError) {
    return fail("Account created but subjects save failed — sign in and retry.");
  }

  // Best effort, and deliberately not awaited into the failure path: an
  // operator who misses one alert can read /admin, but a teacher who cannot
  // sign up because a push service was down has lost something real.
  try {
    await notifyAdminsOfApplication(teacherId, v.fullName, v.subjects.length);
  } catch (e) {
    console.error("[tutor-signup] admin notification failed", e);
  }

  redirect("/setup");
}
