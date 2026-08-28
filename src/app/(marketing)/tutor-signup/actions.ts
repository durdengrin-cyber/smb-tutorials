"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseTutorSignUp } from "@/lib/validation";
import type { AuthState } from "@/lib/form-state";

export async function signUpTutor(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = parseTutorSignUp(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email: v.email,
    password: v.password,
    options: {
      data: { role: "teacher", full_name: v.fullName, phone: v.phone },
    },
  });
  if (error || !data.user) return { error: error?.message ?? "Sign up failed." };
  const teacherId = data.user.id;

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
