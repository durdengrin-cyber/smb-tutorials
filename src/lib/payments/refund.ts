import type { SupabaseClient } from "@supabase/supabase-js";
import { getPaymentPort, paymentProviderName } from "./index";
import type { SessionStatus } from "@/lib/session";

export interface RefundArgs {
  sessionId: string;
  paymentRef: string;
  amountPaise: number;
  nextStatus: SessionStatus | null;
  why: string;
  // "[webhook]" or "[suspension]" — the operator greps these, so the caller
  // has to say which path issued the money back.
  logPrefix: string;
}

// Extracted from settle.ts. The failure-path logic is unchanged — it took
// four fix rounds to get right: the retry, the guard-blocked-versus-succeeded
// distinction, and the attempt-1-may-have-committed check. A second
// implementation would have to re-earn all of it, in the one part of the
// product that moves money.
//
// The return type is the one addition (suspension fix round 1): `true` only
// on the path where the row was actually confirmed stamped with this refund's
// reference, `false` on every other path — including the ones where the
// refund itself succeeded at the provider but the write did not confirm.
// A caller cannot tell "money moved" from "money moved AND our row says so"
// any other way, and a caller that only wants to know "did this settle
// something" (src/lib/suspension/settle.ts) needs exactly that distinction.
// The five webhook call sites in payments/settle.ts predate this and do not
// read it — `await refundSession(...)` with the value discarded still
// type-checks and behaves exactly as before.
export async function refundSession(
  db: SupabaseClient,
  args: RefundArgs
): Promise<boolean> {
  console.error(`${args.logPrefix} refunding ${args.sessionId} (${args.paymentRef}): ${args.why}`);
  let refundRef: string;
  try {
    ({ refundRef } = await getPaymentPort().refund(args.paymentRef, args.amountPaise));
  } catch (e) {
    // The one failure with no automatic recovery (design spec §9). Loud, with
    // the reference, because a human has to finish this by hand.
    console.error(
      `${args.logPrefix} REFUND FAILED for ${args.sessionId}, ref ${args.paymentRef}, ` +
        `amount ${args.amountPaise} — needs manual action:`,
      e
    );
    return false;
  }
  const stamp = () =>
    db
      .from("sessions")
      .update({
        ...(args.nextStatus ? { status: args.nextStatus } : {}),
        amount_paid_paise: args.amountPaise,
        refund_ref: refundRef,
        payment_provider: paymentProviderName(),
      })
      .eq("id", args.sessionId)
      // Guarded so a redelivery racing this one cannot overwrite a
      // resolution that already happened.
      .is("refund_ref", null)
      // Without .select, a guard-blocked write and a successful one are
      // indistinguishable — PostgREST returns 204 with error: null for a
      // zero-row match, same as the claim update earlier in this file and
      // the stamp write in payment-actions.ts.
      .select("id");

  let { data: recorded, error } = await stamp();
  // The money has already left the provider by this point — a write error
  // here (a real failure, not a blocked guard) would leave a refunded
  // charge with nothing to show for it. One retry closes the narrow
  // transient-error window cheaply; a durable fix needs an outbox, so this
  // is the proportionate answer, not the complete one (known gap).
  let retried = false;
  if (error) {
    retried = true;
    ({ data: recorded, error } = await stamp());
  }
  if (error) {
    console.error(
      `${args.logPrefix} REFUNDED BUT NOT RECORDED for ${args.sessionId}, refund ${refundRef} — ` +
        `the money is back with the student but the row does not say so; ` +
        `reconciliation will show it as unresolved:`,
      error
    );
    return false;
  }
  if (!recorded || recorded.length === 0) {
    // A guard-blocked write and attempt 1's own commit landing anyway look
    // identical from here: a transport error after a successful commit is
    // indistinguishable from one before it (same reasoning as the claim
    // error path above). If this is the retry, attempt 1 may well have
    // written refund_ref before the error surfaced — check before alarming,
    // so reconciliation's backstop (design spec §9) isn't trained to
    // distrust a line that cried wolf about money that was recorded fine.
    if (retried) {
      const { data: check } = await db
        .from("sessions")
        .select("refund_ref")
        .eq("id", args.sessionId)
        .maybeSingle();
      if (check?.refund_ref === refundRef) {
        console.info(
          `${args.logPrefix} refund ${refundRef} for ${args.sessionId} was recorded by attempt 1; ` +
            `its error was a transport failure after the commit, not a lost write.`
        );
        return true;
      }
    }
    // Genuinely absent or different: something else set refund_ref first.
    // The money is back with the student; this reference just has nowhere
    // to live, so it is named here or nowhere. This call's write did not
    // land, whatever else happened to the row — false.
    console.error(
      `${args.logPrefix} REFUND ISSUED BUT NOT RECORDED for ${args.sessionId}, refund ${refundRef} — ` +
        `the guard matched no row (already resolved by something else); this reference is not stored anywhere.`
    );
    return false;
  }
  return true;
}
