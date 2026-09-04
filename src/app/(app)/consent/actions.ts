"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { CONSENT_VERSION, isGrade } from "@/lib/consent";
import { resolveHome } from "@/lib/routes";
import type { AuthState } from "@/lib/form-state";

export async function acceptConsent(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const identity = await requireUser();

  if (!formData.get("consent")) {
    return { error: "Please confirm you are the student's parent or legal guardian." };
  }

  const supabase = await createClient();

  // Teachers reach this page after a terms change; they have no learner.
  if (identity.role === "student") {
    const learnerFirstName = (formData.get("learnerFirstName") ?? "").toString().trim();
    const learnerGrade = (formData.get("learnerGrade") ?? "").toString().trim();
    if (!learnerFirstName) return { error: "Enter the student's first name." };
    if (!isGrade(learnerGrade)) return { error: "Select the student's grade." };

    const { error } = await supabase
      .from("profiles")
      .update({ learner_first_name: learnerFirstName, learner_grade: learnerGrade })
      .eq("id", identity.userId);
    if (error) return { error: "Could not save the student's details. Try again." };
  }

  const { error: consentError } = await supabase.rpc("record_consent", {
    p_version: CONSENT_VERSION,
    p_path: "google_interstitial",
    p_detail: null,
  });
  if (consentError) {
    console.error("[acceptConsent] consent log failed", consentError);
    return { error: "Could not record your agreement. Try again in a moment." };
  }

  redirect(resolveHome(identity.role));
}
