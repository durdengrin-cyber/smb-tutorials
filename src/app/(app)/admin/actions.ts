"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
