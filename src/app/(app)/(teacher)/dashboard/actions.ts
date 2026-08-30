"use server";

import { createClient } from "@/lib/supabase/server";
import { leaseUntilFrom, shouldRenew } from "@/lib/availability";
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

// The durable half of "available" (spec §4.1). Presence still carries
// liveness; this carries intent, and it is what a push is authorised
// against — so it must survive the tab that created it.
export async function declareAvailable(): Promise<
  { declaredUntil: string } | { error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to go available." };

  const now = new Date();
  const until = leaseUntilFrom(now);

  const { data, error } = await supabase
    .from("teacher_availability")
    .upsert(
      {
        teacher_id: user.id,
        declared: true,
        declared_at: now.toISOString(),
        declared_until: until.toISOString(),
      },
      { onConflict: "teacher_id" }
    )
    .select("declared_until")
    .single();

  if (error || !data) {
    console.error("[declareAvailable] upsert failed", error);
    return { error: "Couldn't go available — try again." };
  }
  return { declaredUntil: data.declared_until as string };
}

export async function undeclareAvailable(): Promise<
  { ok: true } | { error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  // declared_until is cleared as well as the flag. Leaving a live lease on a
  // row whose flag is false is a contradiction waiting for a query that
  // forgets one of the two conditions.
  const { error } = await supabase
    .from("teacher_availability")
    .upsert(
      { teacher_id: user.id, declared: false, declared_until: null },
      { onConflict: "teacher_id" }
    );

  if (error) {
    console.error("[undeclareAvailable] upsert failed", error);
    return { error: "Couldn't go offline — try again." };
  }
  return { ok: true };
}

// Called by any live client on mount and on a slow interval. shouldRenew
// decides, not the caller: the halfway rule plus the 15-minute floor is what
// keeps this at ~1.4 writes/sec at 10,000 teachers instead of ~667.
export async function renewLease(): Promise<
  { declaredUntil: string } | { error: string } | { skipped: true }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  const { data: row, error: readError } = await supabase
    .from("teacher_availability")
    .select("declared, declared_until")
    .eq("teacher_id", user.id)
    .maybeSingle();

  if (readError) {
    console.error("[renewLease] read failed", readError);
    return { error: "Couldn't check your availability." };
  }
  if (!row?.declared) return { skipped: true };

  const now = new Date();
  // The server owns the floor as well as the halfway test. A client passing
  // its own lastRenewedAt could renew on every mount; this one cannot be
  // talked into it, because it only ever renews inside the second half.
  if (!shouldRenew(row.declared_until as string | null, now, null)) {
    return { skipped: true };
  }

  const until = leaseUntilFrom(now);
  const { data, error } = await supabase
    .from("teacher_availability")
    .upsert(
      { teacher_id: user.id, declared: true, declared_until: until.toISOString() },
      { onConflict: "teacher_id" }
    )
    .select("declared_until")
    .single();

  if (error || !data) {
    console.error("[renewLease] upsert failed", error);
    return { error: "Couldn't extend your availability." };
  }
  return { declaredUntil: data.declared_until as string };
}
