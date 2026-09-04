"use server";

import { createClient } from "@/lib/supabase/server";
import { requireConsentedUser } from "@/lib/auth";
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
  // requireConsentedUser(), not a bare getUser(): a Server Action is
  // resolved by ID and run before any page renders, so requireUser()'s
  // redirect on /consent never gets a chance to fire for this call.
  const identity = await requireConsentedUser();
  if (!identity) return { supabase, identity: null, session: null };
  const { data: session } = await supabase
    .from("sessions")
    .select("id, teacher_id, student_id, status, accept_deadline, payment_deadline, started_at, duration_minutes")
    .eq("id", sessionId)
    .single();
  return { supabase, identity, session };
}

export async function acceptSession(sessionId: string): Promise<{ error: string } | void> {
  const { supabase, identity, session } = await loadOwnSession(sessionId);
  if (!identity || !session) return { error: "Request not found." };
  if (session.teacher_id !== identity.userId) return { error: "Not your request." };

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
    .eq("teacher_id", identity.userId)
    .in("status", ["accepted", "paid", "active"]);
  if (openError) {
    console.error(`[acceptSession] open-session read failed for teacher ${identity.userId}:`, openError);
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
  const { supabase, identity, session } = await loadOwnSession(sessionId);
  if (!identity || !session) return { error: "Request not found." };
  if (session.teacher_id !== identity.userId) return { error: "Not your request." };

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
  const identity = await requireConsentedUser();
  if (!identity) return { error: "Sign in to go available." };

  const now = new Date();
  const until = leaseUntilFrom(now);

  const { data, error } = await supabase
    .from("teacher_availability")
    .upsert(
      {
        teacher_id: identity.userId,
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
  const identity = await requireConsentedUser();
  if (!identity) return { error: "Sign in first." };

  // declared_until is cleared as well as the flag. Leaving a live lease on a
  // row whose flag is false is a contradiction waiting for a query that
  // forgets one of the two conditions.
  const { error } = await supabase
    .from("teacher_availability")
    .upsert(
      { teacher_id: identity.userId, declared: false, declared_until: null },
      { onConflict: "teacher_id" }
    );

  if (error) {
    console.error("[undeclareAvailable] upsert failed", error);
    return { error: "Couldn't go offline — try again." };
  }
  return { ok: true };
}

// Called by any live client on mount and on a slow interval. shouldRenew
// decides whether this WRITES, not the caller: the halfway rule plus the
// 15-minute floor is what keeps this at ~1.4 writes/sec at 10,000 teachers
// instead of ~667.
//
// It always returns the AUTHORITATIVE lease, though, whether or not it wrote.
// That is what makes this a reconciliation and not merely a renewal, and it is
// load-bearing: this used to return `{ skipped: true }` for BOTH "no write
// needed yet" and "this teacher is not declared at all", and the client did
// nothing with either. So a dashboard left open could never learn its lease
// had gone — it kept rendering "Available until 07:33" indefinitely while the
// server said the teacher was not declared, and students correctly saw nobody.
// Observed live on 2026-09-04, and the exact failure §6.3 says must never
// happen again: a teacher believing they are reachable while they are not.
//
// It matters more because devices are first-class (spec §7): going offline on
// a phone has to correct the laptop, and this tick is the only thing that can.
export async function renewLease(): Promise<
  { declaredUntil: string | null } | { error: string }
> {
  const supabase = await createClient();
  const identity = await requireConsentedUser();
  if (!identity) return { error: "Sign in first." };

  const { data: row, error: readError } = await supabase
    .from("teacher_availability")
    .select("declared, declared_until")
    .eq("teacher_id", identity.userId)
    .maybeSingle();

  if (readError) {
    console.error("[renewLease] read failed", readError);
    return { error: "Couldn't check your availability." };
  }
  // Not declared — including no row at all. Report the lease as gone rather
  // than as "nothing to do", so a client holding a stale live lease corrects.
  if (!row?.declared) return { declaredUntil: null };

  const now = new Date();
  // The server owns the floor as well as the halfway test. A client passing
  // its own lastRenewedAt could renew on every mount; this one cannot be
  // talked into it, because it only ever renews inside the second half.
  if (!shouldRenew(row.declared_until as string | null, now, null)) {
    // No write needed. Still hand back what the server actually holds — this
    // covers the declared-but-LAPSED row too, where the honest answer is a
    // past timestamp the client will render as Offline.
    return { declaredUntil: (row.declared_until as string | null) ?? null };
  }

  const until = leaseUntilFrom(now);
  const { data, error } = await supabase
    .from("teacher_availability")
    .upsert(
      { teacher_id: identity.userId, declared: true, declared_until: until.toISOString() },
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
