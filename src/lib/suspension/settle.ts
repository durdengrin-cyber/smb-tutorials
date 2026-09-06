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
  const { data: open, error: gateError } = await db
    .from("teacher_suspensions")
    .select("id")
    .eq("teacher_id", teacherId)
    .is("lifted_at", null)
    .maybeSingle();
  if (gateError) {
    // A failed read is not "not suspended" — it is unknown, and the contract
    // below is "did I change anything", not "is there something to change".
    // Nothing was mutated, so false, same as the genuine no-suspension case.
    console.error(`[suspension] could not read teacher_suspensions for ${teacherId}:`, gateError);
    return false;
  }
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
    // Nothing was mutated, so this is `false` like every other no-op path —
    // the contract is "did I change anything", not "should the caller check
    // again". This pass is idempotent and runs again on the caller's next
    // page load regardless of what it returns, so `false` here does not
    // strand anyone: the page just renders instead of redirecting, and
    // self-heals next time the read succeeds. The opposite choice — `true`
    // on a persistent read failure (database down, a permission error) —
    // would send a waiting student's browser straight into a redirect loop
    // that never resolves, without ever showing them the page.
    return false;
  }

  // Set only where a cancel or a refund is CONFIRMED to have happened, never
  // just attempted. Three paths below reach the end of the loop having
  // changed nothing: the paid-with-no-payment_ref branch (deliberately
  // inert), a cancel update that errors, and a refund whose provider call or
  // stamp write did not land — refundSession's own return value is what
  // makes the last of those distinguishable from a real refund. Getting this
  // wrong compounds: refundSession calls the payment provider before its
  // guard, so if this flag ever read "attempted" instead of "confirmed", a
  // student's waiting page redirecting on a false `true` would run this pass
  // again and issue a second real refund against the same session.
  let acted = false;

  for (const s of sessions ?? []) {
    if (s.status === "paid") {
      // Money moved and the lesson has not started. A second pass over this
      // teacher does not re-refund this row: by then its status is
      // `refunded`, which is outside the `.in("status", [...])` filter above,
      // so the row is never read again in the first place. refundSession's
      // own `refund_ref is null` guard is a second, independent line against
      // a duplicate STAMP of the same row — it blocks recording a second
      // time, not issuing a second refund; issuing is prevented by the query
      // no longer selecting this row at all.
      if (!s.payment_ref || !s.amount_paid_paise) {
        console.error(
          `[suspension] session ${s.id} is paid but carries no payment reference — ` +
            `needs manual action; not cancelling it blind.`
        );
        continue;
      }
      const refunded = await refundSession(db, {
        sessionId: s.id,
        paymentRef: s.payment_ref,
        amountPaise: s.amount_paid_paise,
        nextStatus: "refunded",
        why: "teacher suspended pending review",
        logPrefix: "[suspension]",
      });
      if (refunded) acted = true;
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
      continue;
    }
    acted = true;
  }

  return acted;
}
