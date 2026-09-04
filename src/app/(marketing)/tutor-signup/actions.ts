"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseTutorSignUp } from "@/lib/validation";
import type { AuthState } from "@/lib/form-state";
import { canBecomeTeacher, type Role } from "@/lib/routes";

export async function signUpTutor(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = parseTutorSignUp(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;

  const supabase = await createClient();

  const {
    data: { user: existingUser },
  } = await supabase.auth.getUser();

  let teacherId: string;

  if (existingUser) {
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
      return { error: "Couldn't verify this account. Try again in a moment." };
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
      return {
        error:
          "This account can't be converted to a teacher account. Sign out and register with a different email.",
      };
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
      return {
        error: hasHistory
          ? "This account has already been used for sessions, so it can't be converted to a teacher account. Sign out and register with a different email."
          : "Could not upgrade this account to a teacher account.",
      };
    }

    teacherId = existingUser.id;
  } else {
    const { data, error } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: {
        data: { role: "teacher", full_name: v.fullName, phone: v.phone },
      },
    });
    if (error || !data.user) return { error: error?.message ?? "Sign up failed." };
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
    })
    .eq("id", teacherId);
  if (profileError) {
    return { error: "Account created but profile save failed — sign in and retry." };
  }

  const { error: subjectsError } = await supabase
    .from("teacher_subjects")
    .insert(v.subjects.map((s) => ({ teacher_id: teacherId, ...s })));
  if (subjectsError) {
    return { error: "Account created but subjects save failed — sign in and retry." };
  }

  redirect("/setup");
}
