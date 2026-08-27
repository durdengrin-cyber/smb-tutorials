"use server";

import { createClient } from "@/lib/supabase/server";

// Widened past `pending` (M3 spec §3.1 lists `accepted -> cancelled | student`
// and migration 0005's trigger permits it). A student who changed their mind
// inside the 120-second payment window previously had no exit but to let the
// window run down, which also held their teacher for the full duration.
//
// The status filter is what makes widening it safe, and it does two jobs. It
// keeps the decision in Postgres rather than in a client that read the row a
// moment ago; and if the webhook has already written `paid`, this matches zero
// rows and reports false instead of racing it. The caller MUST NOT navigate
// away on a false — a student whose payment just cleared would be walked off
// the one screen their room is about to open on.
//
// The other side of that race is already handled: a payment that lands on a
// row this cancelled sees a status that is no longer `accepted`, and the
// webhook refunds it rather than keeping the money (see api/payments/webhook).
export async function cancelSession(
  sessionId: string
): Promise<{ cancelled: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { cancelled: false };
  const { data, error } = await supabase
    .from("sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId)
    .eq("student_id", user.id)
    .in("status", ["pending", "accepted"])
    .select("id");
  if (error) {
    console.error(`[cancelSession] cancel failed for ${sessionId}:`, error);
    return { cancelled: false };
  }
  return { cancelled: (data ?? []).length > 0 };
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
