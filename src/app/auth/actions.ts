"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseSignIn, parseStudentSignUp } from "@/lib/validation";
import { CONSENT_VERSION } from "@/lib/consent";
import {
  echoStudentForm,
  type AuthState,
  type StudentFormState,
} from "@/lib/form-state";
import { safeNext } from "@/lib/routes";

export async function signIn(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = parseSignIn(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.value);
  if (error) return { error: "Invalid email or password." };

  const target = safeNext(formData.get("next"), "/home");
  redirect(target);
}

export async function signUpStudent(
  _prev: StudentFormState,
  formData: FormData
): Promise<StudentFormState> {
  // Echoed back on every failure: React 19 resets the form when this action
  // completes, so returning a bare { error } makes a parent re-enter their
  // name, their child's name and grade, and their email — and re-tick the
  // guardian consent — because they mistyped a password they cannot see.
  const values = echoStudentForm(formData);
  const fail = (error: string): StudentFormState => ({ error, values });

  const parsed = parseStudentSignUp(formData);
  if (!parsed.ok) return fail(parsed.error);
  const { email, password, fullName, learnerFirstName, learnerGrade } = parsed.value;

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        role: "student",
        full_name: fullName,
        // Stamped server-side: the client says WHETHER they agreed, the
        // server says WHEN. handle_new_user copies both onto the profile AND
        // writes the consent_events row, in one transaction (0019).
        consent_accepted_at: new Date().toISOString(),
        consent_version: CONSENT_VERSION,
        learner_first_name: learnerFirstName,
        learner_grade: learnerGrade,
      },
    },
  });
  if (error) return fail(error.message);

  redirect("/home");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
