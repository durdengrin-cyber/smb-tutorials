import { createClient } from "@supabase/supabase-js";
import { getPaymentPort, paymentProviderName, type WebhookEvent } from "./index";
import { createSessionRoom } from "@/lib/daily";
import {
  amountPaiseFor, effectiveStatus, roomTtlSeconds, ROOM_GRACE_MINUTES,
  PAYMENT_WINDOW_SECONDS, type SessionStatus,
} from "@/lib/session";

// SERVER ONLY. Holds the service role, and is the single implementation of
// "a payment is confirmed — settle it".
//
// Extracted from the webhook route in Task 12 Step 3b, unchanged. Design spec
// §3.6 requires TWO paths to confirmation — the provider's webhook, and our
// own re-check when the student returns from checkout and no webhook arrived.
// Two paths must not mean two implementations: this logic took four fix
// rounds and nine Criticals to get right, and a second copy would drift from
// it silently, in the one part of the product that moves money.
//
// Every path below is idempotent, which is what makes it safe to call from a
// page load as well as from a webhook: the claim is a compare-and-swap on
// `accepted`, the activate is guarded on `paid`, the refund stamp is guarded
// on a null refund_ref, and room minting is idempotent by design.

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

// 200 tells the provider the event is handled and it will never redeliver.
// Use it only where redelivery would genuinely have nothing left to do.
const ok = () => new Response("ok", { status: 200 });
// 503 asks the provider to try again. Correct whenever OUR side failed and a
// retry could still succeed — the alternative is accepting money we have no
// record of.
const retry = () => new Response("temporarily unavailable", { status: 503 });

// Returns the response the WEBHOOK should send. The re-check path calls this
// too and discards the response — a status code is how we ask a provider to
// redeliver, which is meaningless to a page load, but the settling work it
// describes is identical.
export async function settleVerifiedEvent(event: WebhookEvent): Promise<Response> {
  if (event.kind !== "succeeded") return ok();

  const db = admin();
  const { data: session, error: readError } = await db
    .from("sessions")
    .select(
      "id, status, accept_deadline, payment_deadline, started_at, duration_minutes, hourly_rate, payment_ref, amount_paid_paise, refund_ref"
    )
    .eq("id", event.sessionId)
    .maybeSingle();

  // A read failure and an absent row are different facts. Answering 200 to a
  // transient outage tells the provider this event is handled and it will
  // never come back — a paid session lost to a cold schema cache.
  if (readError) {
    console.error(`[webhook] read failed for ${event.sessionId} (ref ${event.paymentRef}):`, readError);
    return retry();
  }
  if (!session) {
    console.error(`[webhook] no session for ${event.sessionId}, ref ${event.paymentRef}`);
    return ok();
  }

  // IDENTITY FIRST. The event names both a session and a charge. payment_ref
  // is the half WE stamped at checkout creation and it is unique-indexed, so
  // it is the identifier worth trusting. If they disagree, this event is not
  // about this session, and this row's money columns are not ours to write —
  // stamping a foreign amount here would make a delivered, genuinely-paid
  // lesson read as refunded. Refunding a charge we cannot attribute is its own
  // risk, so we take no automatic action and make the alarm loud instead
  // (design spec §9: this is a known gap needing a human).
  if (session.payment_ref !== event.paymentRef) {
    console.error(
      `[webhook] REFERENCE MISMATCH — needs manual action: session ${event.sessionId} ` +
        `holds ref ${session.payment_ref}, event carries ref ${event.paymentRef} ` +
        `for ${event.amountPaise} paise. No row written, no refund issued.`
    );
    return ok();
  }

  // ALREADY RESOLVED? Asked before anything is written, so a redelivery of an
  // event we have already acted on cannot act again. Two ways a charge is
  // resolved: we credited it, or we gave it back — and the two refund paths
  // leave DIFFERENT statuses, so refund_ref is the half that catches both.
  if (
    ["active", "completed"].includes(session.status) ||
    session.refund_ref
  ) {
    // A duplicate delivery is normal, but so is the second event of a
    // re-opened checkout — this is the only branch that drops a `succeeded`
    // event with no output at all otherwise, so it gets a line even though
    // it is not an error.
    console.info(
      `[webhook] already resolved, dropping: session ${event.sessionId} ` +
        `(ref ${event.paymentRef}) is ${session.status}` +
        (session.refund_ref ? `, refund_ref ${session.refund_ref}` : "")
    );
    return ok();
  }

  const refundAndRecord = async (why: string, nextStatus: SessionStatus | null) => {
    console.error(`[webhook] refunding ${event.sessionId} (${event.paymentRef}): ${why}`);
    let refundRef: string;
    try {
      ({ refundRef } = await getPaymentPort().refund(event.paymentRef, event.amountPaise));
    } catch (e) {
      // The one failure with no automatic recovery (design spec §9). Loud, with
      // the reference, because a human has to finish this by hand.
      console.error(
        `[webhook] REFUND FAILED for ${event.sessionId}, ref ${event.paymentRef}, ` +
          `amount ${event.amountPaise} — needs manual action:`,
        e
      );
      return;
    }
    const stamp = () =>
      db
        .from("sessions")
        .update({
          ...(nextStatus ? { status: nextStatus } : {}),
          amount_paid_paise: event.amountPaise,
          refund_ref: refundRef,
          payment_provider: paymentProviderName(),
        })
        .eq("id", event.sessionId)
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
        `[webhook] REFUNDED BUT NOT RECORDED for ${event.sessionId}, refund ${refundRef} — ` +
          `the money is back with the student but the row does not say so; ` +
          `reconciliation will show it as unresolved:`,
        error
      );
      return;
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
          .eq("id", event.sessionId)
          .maybeSingle();
        if (check?.refund_ref === refundRef) {
          console.info(
            `[webhook] refund ${refundRef} for ${event.sessionId} was recorded by attempt 1; ` +
              `its error was a transport failure after the commit, not a lost write.`
          );
          return;
        }
      }
      // Genuinely absent or different: something else set refund_ref first.
      // The money is back with the student; this reference just has nowhere
      // to live, so it is named here or nowhere.
      console.error(
        `[webhook] REFUND ISSUED BUT NOT RECORDED for ${event.sessionId}, refund ${refundRef} — ` +
          `the guard matched no row (already resolved by something else); this reference is not stored anywhere.`
      );
    }
  };

  // `paid` means we claimed this charge and did not finish. A redelivery is the
  // repair, not a duplicate: createSessionRoom is idempotent by design, and the
  // activate write is guarded on `paid`. Short-circuiting here would make any
  // crash between the claim and the activation permanent.
  const alreadyClaimed = session.status === "paid";

  // A repair is only useful while the room minted on the first attempt can
  // still cover a full session anchored at this attempt's clock. Past that,
  // activating would hand the student a room that expires mid-lesson — and
  // `active` has no route to `refunded`, so the money would be unrecoverable.
  // Bounded against payment_deadline because the first claim happened inside
  // that window.
  //
  // Slack must cover the worst case between the first mint and this repair:
  // the claim can happen up to PAYMENT_WINDOW_SECONDS after acceptance, and
  // the room minted then lives ROOM_GRACE_MINUTES past the session's end.
  // Deriving it here means tuning the payment window cannot silently make
  // this bound unsafe — which a bare `- 5` would have allowed.
  const repairSlackMs =
    ROOM_GRACE_MINUTES * 60_000 - PAYMENT_WINDOW_SECONDS * 1000;
  const repairDeadline =
    new Date(session.payment_deadline ?? 0).getTime() + repairSlackMs;
  if (alreadyClaimed && Date.now() > repairDeadline) {
    await refundAndRecord("repair arrived too late for the minted room", "refunded");
    return ok();
  }

  if (!alreadyClaimed) {
    // A tampered checkout must not buy a session at the wrong price. This calls
    // the SAME function checkout creation called — spec §3.3.1 requires it, and
    // two independent implementations of a money calculation will eventually
    // disagree by a rounding step.
    if (event.amountPaise !== amountPaiseFor(session.hourly_rate, session.duration_minutes)) {
      await refundAndRecord("amount mismatch", null);
      return ok();
    }

    const actual = effectiveStatus(
      { ...session, status: session.status as SessionStatus },
      new Date()
    );

    // The student paid, but we already released the teacher. Never keep the
    // money, and never resurrect a session whose teacher has moved on. The row
    // takes its true status so the stored column stops disagreeing with the
    // read-time rule.
    if (actual !== "accepted") {
      await refundAndRecord(`payment arrived while status was ${actual}`, actual);
      return ok();
    }

    // Claim the transition. This is a compare-and-swap: a concurrent delivery
    // re-evaluates the qualifier against the updated row and matches nothing.
    const { data: claimed, error: claimError } = await db
      .from("sessions")
      .update({
        status: "paid",
        amount_paid_paise: event.amountPaise,
        payment_provider: paymentProviderName(),
      })
      .eq("id", event.sessionId)
      .eq("status", "accepted")
      .select("id");

    // Answering 200 here would accept money we have no record of: the row is
    // still `accepted`, amount_paid_paise is null, and reconciliation keys on
    // that column being set — so nothing in the system would ever know.
    if (claimError) {
      console.error(`[webhook] claim failed for ${event.sessionId} (ref ${event.paymentRef}):`, claimError);
      return retry();
    }

    if (!claimed || claimed.length === 0) {
      // Zero rows is not automatically a duplicate. Re-read to find out which:
      // a row that moved on is a duplicate; a row that left `accepted` some
      // other way — expired, cancelled — is a race we lost, and the student's
      // money must go back exactly as the expiry branch above would have sent it.
      const { data: now, error: recheckError } = await db
        .from("sessions")
        .select("status, refund_ref")
        .eq("id", event.sessionId)
        .maybeSingle();
      // This branch's entire job is deciding whether to give the student's
      // money back. Its wrongest failure mode is not a race, it is a
      // transient read outage: on a null-data error, `!now` would read as
      // "resolved" and return 200 for a charge that was never claimed and
      // never refunded, with no log at all — C4's exact defect class,
      // reintroduced in the one branch that exists to prevent it.
      if (recheckError) {
        console.error(`[webhook] re-read failed for ${event.sessionId} (ref ${event.paymentRef}):`, recheckError);
        return retry();
      }
      if (!now) {
        console.error(`[webhook] session vanished for ${event.sessionId} (ref ${event.paymentRef}) after losing the claim race`);
        return ok();
      }
      const resolved =
        now.refund_ref !== null ||
        ["paid", "active", "completed"].includes(now.status);
      if (resolved) return ok();
      await refundAndRecord(`lost the claim race; row is now ${now.status}`, null);
      return ok();
    }
  }

  // Mint the room and activate. Reached both by a fresh claim and by a
  // redelivery repairing a `paid` row.
  const startedAt = new Date();
  let roomUrl: string;
  try {
    const mint = async () => {
      const room = await createSessionRoom(
        event.sessionId,
        process.env.DAILY_API_KEY ?? "",
        fetch,
        roomTtlSeconds(startedAt, session.duration_minutes, startedAt)
      );
      // A room with no URL would activate a session nobody can enter, and
      // `active` has no route to `refunded` — so this must fail the same way
      // a thrown mint does, inside the function the retry wraps, not after it.
      if (!room?.url) throw new Error("Daily returned a room with no url");
      return room;
    };
    // Retry once (design spec §7). Minting is idempotent, and a single
    // transient 5xx should not cost a student the lesson they just paid for —
    // refunds are the one thing with no recovery path.
    let room;
    try {
      room = await mint();
    } catch (first) {
      console.error(`[webhook] room mint attempt 1 failed for ${event.sessionId}, retrying:`, first);
      room = await mint();
    }
    roomUrl = room.url;
  } catch (e) {
    console.error(`[webhook] room mint failed for ${event.sessionId}:`, e);
    // We hold their money and cannot deliver. `paid` is never a terminal
    // state (design spec §6 invariant 3) — refund is the only honest exit.
    await refundAndRecord("room could not be created", "refunded");
    return ok();
  }

  const { error: activateError } = await db
    .from("sessions")
    .update({
      status: "active",
      started_at: startedAt.toISOString(),
      daily_room_url: roomUrl,
    })
    .eq("id", event.sessionId)
    .eq("status", "paid");

  // A silent failure here is the worst outcome in the file: money taken, room
  // minted, row stranded at `paid` forever, and a 200 telling the provider not
  // to retry. Ask for the retry instead — the mint is idempotent, so the
  // redelivery repairs it.
  if (activateError) {
    console.error(
      `[webhook] ACTIVATE FAILED for ${event.sessionId} — row is stranded at 'paid' ` +
        `with a room already minted; retrying via the provider:`,
      activateError
    );
    return retry();
  }

  return ok();
}
