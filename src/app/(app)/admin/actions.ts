"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createDispatchClient } from "@/lib/supabase/admin";
import { getIdentity } from "@/lib/auth";
import { isVettingState } from "@/lib/vetting";

export async function setVettingState(formData: FormData) {
  // Checked here AND in the RPC. The RPC is the real boundary — this is the
  // fast, legible refusal, not the security control.
  const identity = await getIdentity();
  if (identity?.role !== "admin") throw new Error("not an admin");

  const teacherId = String(formData.get("teacherId") ?? "");
  const state = String(formData.get("state") ?? "");
  const note = String(formData.get("note") ?? "") || null;

  if (!isVettingState(state)) throw new Error(`invalid state: ${state}`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_vetting_state", {
    p_teacher_id: teacherId,
    p_state: state,
    p_note: note,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
}

/**
 * Lifts an open suspension.
 *
 * Suspension itself is NOT reachable from here, and that is structural rather
 * than an omission: teacher_suspensions.session_report_id is NOT NULL, so a
 * suspension cannot exist without a conduct report to hang it on. The trigger
 * on_conduct_report_suspend() opens one the moment a report is filed — at 2am,
 * without waiting for an operator — and this is the only lever that closes it.
 *
 * An operator who wants a cleared teacher out of discovery for any other
 * reason uses setVettingState(..., "unvetted"): available_teachers gates on
 * vetting_state = 'cleared', so that removes them immediately and honestly
 * says why (they are back in the queue), rather than fabricating a conduct
 * report that no student filed.
 *
 * reinstate_teacher is revoked from authenticated and granted only to
 * service_role — 0020's own comment says the operator calls it with the
 * service role "until the admin UI exists". This is that UI, so the admin
 * check above is what authorizes the elevated client below.
 */
export async function reinstateTeacher(formData: FormData) {
  const identity = await getIdentity();
  if (identity?.role !== "admin") throw new Error("not an admin");

  const teacherId = String(formData.get("teacherId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const note = String(formData.get("note") ?? "") || null;

  // The RPC raises on anything else, but failing here keeps a typo out of a
  // security-definer call entirely.
  if (outcome !== "reinstated" && outcome !== "removed") {
    throw new Error(`invalid outcome: ${outcome}`);
  }

  const supabase = createDispatchClient();
  const { error } = await supabase.rpc("reinstate_teacher", {
    p_teacher_id: teacherId,
    p_outcome: outcome,
    p_note: note,
    p_lifted_by: identity.userId,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
}

/**
 * Suspends a teacher by hand, with a reason.
 *
 * Distinct from setVettingState(..., "unvetted"), which both remove a teacher
 * from the roster but say different things. "Send back to review" means nobody
 * has checked this person yet. A suspension means an admin looked and stopped
 * them, and it carries who and why (0025). Only reinstateTeacher lifts it.
 *
 * The RPC re-checks admin in SQL and requires a non-empty reason, so this
 * function's checks are the fast, legible refusals rather than the control.
 */
export async function suspendTeacher(formData: FormData) {
  const identity = await getIdentity();
  if (identity?.role !== "admin") throw new Error("not an admin");

  const teacherId = String(formData.get("teacherId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  // Refused here as well as in SQL so the admin gets a message rather than a
  // raised exception page for the most likely mistake.
  if (!reason) throw new Error("a reason is required to suspend a teacher");

  const supabase = await createClient();
  const { error } = await supabase.rpc("suspend_teacher", {
    p_teacher_id: teacherId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
}
