"use server";

import { createClient } from "@/lib/supabase/server";

export async function cancelSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId)
    .eq("student_id", user.id)
    .eq("status", "pending");
}

// Called by whichever participant's client notices the call is over — the
// third enforcement point is the read-time rule in effectiveStatus.
export async function completeSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("sessions")
    .update({ status: "completed" })
    .eq("id", sessionId)
    .eq("status", "active");
}
