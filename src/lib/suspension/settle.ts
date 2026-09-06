// REQUIRED, and enforced: src/lib/server-secrets.test.ts fails the build for
// any module reading a non-NEXT_PUBLIC_ *_KEY/_SECRET without this line. This
// file reads SUPABASE_SERVICE_ROLE_KEY.
import "server-only";

import { createClient } from "@supabase/supabase-js";
import { refundSession } from "@/lib/payments/refund";

// SERVER ONLY. Holds the service role.
//
// Deliberately shaped like src/lib/payments/settle.ts, which established the
// pattern: idempotent, and therefore safe to call from a page load as well as
// from the action that caused it. That is what guarantees a student whose
// teacher was just suspended gets their refund even if the REPORTER's request
// died halfway through — no cron, no queue.
//
// Why this is not in the trigger: security definer changes the privilege, not
// the claim, so auth.uid() inside on_conduct_report_suspend is still the
// reporting student. And a refund has to call the payment provider, which SQL
// cannot do.

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

export async function settleSuspension(teacherId: string): Promise<boolean> {
  const db = admin();

  // The gate, here rather than in each caller. teacher_suspensions has no
  // SELECT policy (0020), so a page component could not perform this check
  // through the user's own client anyway — and the alternative, handing a
  // page the service role to do it, is worse than making the pass gatekeep
  // itself. Callers may therefore call this unconditionally.
  const { data: open } = await db
    .from("teacher_suspensions")
    .select("id")
    .eq("teacher_id", teacherId)
    .is("lifted_at", null)
    .maybeSingle();
  if (!open) return false;

  // `active` is absent on purpose: a lesson already under way finishes
  // (spec §3.4). The child in that call is a different student who reported
  // nothing and has paid.
  const { data: sessions, error } = await db
    .from("sessions")
    .select("id, status, payment_ref, amount_paid_paise")
    .eq("teacher_id", teacherId)
    .in("status", ["pending", "accepted", "paid"]);

  if (error) {
    console.error(`[suspension] could not read sessions for ${teacherId}:`, error);
    // The gate above already found an open suspension, so `false` ("nothing
    // to settle") would be the wrong signal here — the caller would stop
    // re-reading while sessions remain uncancelled/unrefunded. `true` costs
    // one harmless extra re-read on the rare read failure; `false` risks a
    // waiting page stuck forever on a teacher who is, in fact, suspended.
    return true;
  }

  for (const s of sessions ?? []) {
    if (s.status === "paid") {
      // Money moved and the lesson has not started. refundSession is guarded
      // on `refund_ref is null`, so a second pass issues nothing.
      if (!s.payment_ref || !s.amount_paid_paise) {
        console.error(
          `[suspension] session ${s.id} is paid but carries no payment reference — ` +
            `needs manual action; not cancelling it blind.`
        );
        continue;
      }
      await refundSession(db, {
        sessionId: s.id,
        paymentRef: s.payment_ref,
        amountPaise: s.amount_paid_paise,
        nextStatus: "refunded",
        why: "teacher suspended pending review",
        logPrefix: "[suspension]",
      });
      continue;
    }

    // Checked explicitly rather than trusted to the query's `.in(...)`
    // clause alone: this function is the only backstop `active` has against
    // being swept up here, and a defence that lives only in the read filter
    // is one query edit away from cancelling a lesson already under way.
    if (s.status !== "pending" && s.status !== "accepted") continue;

    // pending / accepted: no money has moved. Payment happens AFTER accept,
    // so `accepted` means the teacher said yes and the student has not paid.
    // Guarded on the status we read, so a session that moved on underneath us
    // (a student paying in the same second) is not clobbered.
    const { error: cancelError } = await db
      .from("sessions")
      .update({ status: "cancelled", cancellation_reason: "teacher_suspended" })
      .eq("id", s.id)
      .eq("status", s.status);
    if (cancelError) {
      console.error(`[suspension] could not cancel ${s.id}:`, cancelError);
    }
  }

  return true;
}
