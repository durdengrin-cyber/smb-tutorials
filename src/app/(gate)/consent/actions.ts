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

  // Presence isn't enough: `formData.get` returns whatever the request sent
  // under that name, and only the literal value the checkbox submits is
  // consent. Anything else reaching here is not a browser honouring
  // `required` — it's the check being defeated.
  if (formData.get("consent") !== "yes") {
    return { error: "Please confirm you are the student's parent or legal guardian." };
  }

  const supabase = await createClient();

  // Learner details are written before the RPC below, deliberately — not an
  // oversight. This update is retry-idempotent (the same values every
  // resubmission) and the account stays gated on consent_version regardless
  // of whether it ran, so a failure in it or in the RPC just returns the
  // guardian to this same form with an error: nothing submitted here can
  // either escape the gate half-agreed or get silently dropped on retry.
  // Recording consent FIRST would trade that safety away — if this write
  // then failed, the account would already read as consented and stop being
  // sent back here, permanently losing the learner's name and grade with no
  // path left to enter them. Teachers reach this page after a terms change
  // and have no learner, so this whole block is skipped for them.
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

  // A profile with no prior consent_version at all has never agreed to
  // anything — the Google path this whole gate exists for. A profile with a
  // prior version that is merely outdated is agreeing again after a wording
  // change, not for the first time, and 0019's CHECK constraint carries a
  // distinct value for exactly that so the log doesn't call a second
  // agreement a first one.
  const path = identity.consentVersion === null ? "google_interstitial" : "reconsent";

  const { error: consentError } = await supabase.rpc("record_consent", {
    p_version: CONSENT_VERSION,
    p_path: path,
    p_detail: null,
  });
  if (consentError) {
    console.error("[acceptConsent] consent log failed", consentError);
    return { error: "Could not record your agreement. Try again in a moment." };
  }

  redirect(resolveHome(identity.role));
}
