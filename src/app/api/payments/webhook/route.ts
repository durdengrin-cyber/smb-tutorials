import { createClient } from "@supabase/supabase-js";
import { getPaymentPort, paymentProviderName, type WebhookEvent } from "@/lib/payments";
import { createSessionRoom } from "@/lib/daily";
import {
  amountPaiseFor, effectiveStatus, roomTtlSeconds, type SessionStatus,
} from "@/lib/session";

// The signature check below depends on node:crypto, and every real provider
// SDK will too. Node is the App Router default, but pinning it documents a
// hard requirement of the security boundary rather than relying on a default.
export const runtime = "nodejs";

// Service role: this route is the only thing in the application permitted to
// write `paid`, `active` or `refunded` (design spec §3.3). Everything below
// runs only after the signature has been verified.
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

export async function POST(req: Request) {
  // The exact bytes. req.json() parses and re-serialises, and the signature
  // stops matching — the classic footgun in every webhook integration.
  const rawBody = await req.text();
  const signature =
    req.headers.get("x-payment-signature") ?? req.headers.get("stripe-signature") ?? "";

  let event: WebhookEvent;
  try {
    event = await getPaymentPort().verifyWebhook(rawBody, signature);
  } catch (e) {
    console.error("[webhook] signature rejected:", e);
    return new Response("bad signature", { status: 400 });
  }

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
    const { error } = await db
      .from("sessions")
      .update({
        ...(nextStatus ? { status: nextStatus } : {}),
        amount_paid_paise: event.amountPaise,
        refund_ref: refundRef,
        payment_provider: paymentProviderName(),
      })
      .eq("id", event.sessionId)
      // Guarded so a redelivery racing this one cannot overwrite a resolution
      // that already happened.
      .is("refund_ref", null);
    if (error) {
      console.error(
        `[webhook] REFUNDED BUT NOT RECORDED for ${event.sessionId}, refund ${refundRef} — ` +
          `the money is back with the student but the row does not say so; ` +
          `reconciliation will show it as unresolved:`,
        error
      );
    }
  };

  // `paid` means we claimed this charge and did not finish. A redelivery is the
  // repair, not a duplicate: createSessionRoom is idempotent by design, and the
  // activate write is guarded on `paid`. Short-circuiting here would make any
  // crash between the claim and the activation permanent.
  const alreadyClaimed = session.status === "paid";

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
      const { data: now } = await db
        .from("sessions")
        .select("status, refund_ref")
        .eq("id", event.sessionId)
        .maybeSingle();
      const resolved =
        !now ||
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
    const mint = async () =>
      createSessionRoom(
        event.sessionId,
        process.env.DAILY_API_KEY ?? "",
        fetch,
        roomTtlSeconds(startedAt, session.duration_minutes, startedAt)
      );
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
    // A room with no URL would activate a session nobody can enter, and
    // `active` has no route to `refunded` — so catch it here, where refunding
    // is still possible.
    if (!room?.url) throw new Error("Daily returned a room with no url");
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
