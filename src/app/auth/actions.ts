"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseSignIn, parseStudentSignUp, CONSENT_VERSION } from "@/lib/validation";
import type { AuthState } from "@/lib/form-state";
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
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = parseStudentSignUp(formData);
  if (!parsed.ok) return { error: parsed.error };
  const { email, password, fullName } = parsed.value;

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        role: "student",
        full_name: fullName,
        // Stamped server-side: the client says WHETHER they agreed, the
        // server says WHEN. handle_new_user copies both onto the profile so
        // the consent survives independently of the auth record.
        consent_accepted_at: new Date().toISOString(),
        consent_version: CONSENT_VERSION,
      },
    },
  });
  if (error) return { error: error.message };

  redirect("/home");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
