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

// Design spec §3.2 enforcement point 1: the student's countdown marks its own
// request timed out. The `lt` on the deadline makes Postgres, not the client
// clock, the authority on whether the window has actually closed — a fast
// client can fire this early and simply write nothing.
export async function timeOutSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("sessions")
    .update({ status: "timed_out" })
    .eq("id", sessionId)
    .eq("student_id", user.id)
    .eq("status", "pending")
    .lt("accept_deadline", new Date().toISOString());
}
