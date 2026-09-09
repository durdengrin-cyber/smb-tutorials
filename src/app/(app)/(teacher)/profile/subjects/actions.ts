"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { parseSubjectChangeRequest } from "@/lib/validation";
import {
  echoSubjectRequest,
  type SubjectRequestState,
} from "@/lib/form-state";

/**
 * A teacher asking to change what they teach.
 *
 * Nothing here writes teacher_subjects. 0027 removed the teacher's INSERT and
 * DELETE policies on that table, so the request is a row an admin acts on —
 * the subjects change when decide_subject_change approves it, and not before.
 * A teacher keeps teaching what they were already cleared for while it waits,
 * because freezing them would punish asking.
 */
export async function requestSubjectChange(
  _prev: SubjectRequestState,
  formData: FormData
): Promise<SubjectRequestState> {
  await requireRole("teacher");

  // Echoed on every failure. Without it, React 19's post-action reset reverts
  // every chip to defaultChecked — the teacher's CURRENT subjects — so someone
  // who ticked two new ones and mistyped the link would fix the link and
  // resubmit a request for the subjects they already have. The same defect
  // fixed on the tutor, student and profile forms in this branch.
  const values = echoSubjectRequest(formData);
  const fail = (error: string): SubjectRequestState => ({ error, values });

  const parsed = parseSubjectChangeRequest(formData);
  if (!parsed.ok) return fail(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_subject_change", {
    p_subjects: parsed.value.subjects,
    p_demo_video_url: parsed.value.demoVideoUrl,
  });

  if (error) {
    console.error("[requestSubjectChange] rpc failed", error);
    // The RPC raises a distinct message when one is already waiting, which is
    // the likeliest refusal and deserves saying rather than being flattened.
    return fail(
      /already have a request/i.test(error.message)
        ? "You already have a subject change waiting for review."
        : "Couldn't send your request — try again in a moment."
    );
  }

  revalidatePath("/profile/subjects");
  revalidatePath("/profile");
  return null;
}
