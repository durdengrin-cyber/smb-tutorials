"use server";

import { createClient } from "@/lib/supabase/server";
import {
  canTransition,
  effectiveStatus,
  expiredAcceptedIds,
  expiredActiveIds,
  hasLiveSession,
  paymentDeadlineFrom,
  type SessionStatus,
  type SessionTimingRow,
} from "@/lib/session";

async function loadOwnSession(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, session: null };
  const { data: session } = await supabase
    .from("sessions")
    .select("id, teacher_id, student_id, status, accept_deadline, payment_deadline, started_at, duration_minutes")
    .eq("id", sessionId)
    .single();
  return { supabase, user, session };
}

export async function acceptSession(sessionId: string): Promise<{ error: string } | void> {
  const { supabase, user, session } = await loadOwnSession(sessionId);
  if (!user || !session) return { error: "Request not found." };
  if (session.teacher_id !== user.id) return { error: "Not your request." };

  // The deadline is authoritative here regardless of what the UI showed.
  const actual = effectiveStatus(
    { ...session, status: session.status as SessionStatus },
    new Date()
  );
  if (actual !== "pending") return { error: "That request has already expired." };
  if (!canTransition("pending", "accepted")) return { error: "Invalid transition." };

  // Refuse a second concurrent session for this teacher — decided with the
  // read-time rule, not the stored column, and now counting a teacher whose
  // student is mid-checkout as busy. Fail closed on a read error: the whole
  // point of this query is to decide whether the teacher is already busy, so
  // falling through to an empty list here would let a busy teacher accept a
  // second session, not merely delay one.
  const { data: openRows, error: openError } = await supabase
    .from("sessions")
    .select("id, status, accept_deadline, payment_deadline, started_at, duration_minutes")
    .eq("teacher_id", user.id)
    .in("status", ["accepted", "paid", "active"]);
  if (openError) {
    console.error(`[acceptSession] open-session read failed for teacher ${user.id}:`, openError);
    return { error: "Couldn't accept the request — try again." };
  }
  const open = (openRows ?? []).map((r) => ({
    ...r,
    status: r.status as SessionStatus,
  })) as SessionTimingRow[];

  if (hasLiveSession(open, new Date())) {
    return { error: "You are already in a session." };
  }

  // Settle both kinds of expiry, so neither keeps this teacher hostage. A
  // failed write-back here is self-healing — effectiveStatus already excludes
  // stale rows from the busy check above on this and every future read — but
  // a *permanently* failing write-back (an RLS change, a trigger rejecting on
  // clock skew) would otherwise be invisible: the column just quietly stops
  // self-correcting while every read still looks right. Log it, don't swallow it.
  const staleActive = expiredActiveIds(open, new Date());
  if (staleActive.length > 0) {
    const { error: settleActiveError } = await supabase
      .from("sessions")
      .update({ status: "completed" })
      .in("id", staleActive)
      .eq("status", "active");
    if (settleActiveError) {
      console.error(`[acceptSession] settle-active failed for ${staleActive.join(",")}:`, settleActiveError);
    }
  }
  const staleAccepted = expiredAcceptedIds(open, new Date());
  if (staleAccepted.length > 0) {
    const { error: settleAcceptedError } = await supabase
      .from("sessions")
      .update({ status: "payment_expired" })
      .in("id", staleAccepted)
      .eq("status", "accepted");
    if (settleAcceptedError) {
      console.error(`[acceptSession] settle-accepted failed for ${staleAccepted.join(",")}:`, settleAcceptedError);
    }
  }

  // No room is minted here any more. Accepting agrees a price; the room is
  // created by the webhook once the student has actually paid (M3 spec §5.3).
  const { data: updated, error } = await supabase
    .from("sessions")
    .update({
      status: "accepted",
      payment_deadline: paymentDeadlineFrom(new Date()).toISOString(),
    })
    .eq("id", sessionId)
    .eq("status", "pending")
    .select("id");
  if (error) {
    console.error(`[acceptSession] update failed for ${sessionId}:`, error);
    return { error: "Couldn't accept the request — try again." };
  }
  if (!updated || updated.length === 0) {
    return { error: "That request is no longer waiting." };
  }
  // No redirect: the teacher waits on the dashboard until the student pays.
}

export async function declineSession(sessionId: string): Promise<{ error: string } | void> {
  const { supabase, user, session } = await loadOwnSession(sessionId);
  if (!user || !session) return { error: "Request not found." };
  if (session.teacher_id !== user.id) return { error: "Not your request." };

  await supabase
    .from("sessions")
    .update({ status: "declined" })
    .eq("id", sessionId)
    .eq("status", "pending");
}
