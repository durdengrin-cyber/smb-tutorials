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
    const [{ count: sessionCount }, { count: subjectCount }] = await Promise.all([
      supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("student_id", existingUser.id),
      supabase
        .from("teacher_subjects")
        .select("teacher_id", { count: "exact", head: true })
        .eq("teacher_id", existingUser.id),
    ]);

    const { data: existing } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", existingUser.id)
      .single();

    if (
      !existing ||
      !canBecomeTeacher({
        role: existing.role as Role,
        sessionCount: sessionCount ?? 0,
        subjectCount: subjectCount ?? 0,
      })
    ) {
      return {
        error:
          "This account can't be converted to a teacher account. Sign out and register with a different email.",
      };
    }

    const { error: upgradeError } = await supabase
      .from("profiles")
      .update({ role: "teacher", full_name: v.fullName, phone: v.phone, hourly_rate: v.hourlyRate })
      .eq("id", existingUser.id);
    if (upgradeError) {
      return { error: "Could not upgrade this account to a teacher account." };
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

  redirect("/home");
}
