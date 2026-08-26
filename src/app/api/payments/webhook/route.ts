import { createClient } from "@supabase/supabase-js";
import { getPaymentPort, paymentProviderName } from "@/lib/payments";
import { createSessionRoom } from "@/lib/daily";
import {
  amountPaiseFor, effectiveStatus, roomTtlSeconds, type SessionStatus,
} from "@/lib/session";

// Service role: this route is the only thing in the application permitted to
// write `paid`, `active` or `refunded` (design spec §3.3). Everything below
// runs only after the signature has been verified.
const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

// Always 200 once the signature is good. A non-200 makes the provider retry
// forever, and every path below is idempotent, so a retry buys nothing.
const ok = () => new Response("ok", { status: 200 });

export async function POST(req: Request) {
  // The exact bytes. req.json() parses and re-serialises, and the signature
  // stops matching — the classic footgun in every webhook integration.
  const rawBody = await req.text();
  const signature =
    req.headers.get("x-payment-signature") ?? req.headers.get("stripe-signature") ?? "";

  let event;
  try {
    event = await getPaymentPort().verifyWebhook(rawBody, signature);
  } catch (e) {
    console.error("[webhook] signature rejected:", e);
    return new Response("bad signature", { status: 400 });
  }

  if (event.kind !== "succeeded") return ok();

  const db = admin();
  const { data: session } = await db
    .from("sessions")
    .select(
      "id, status, accept_deadline, payment_deadline, started_at, duration_minutes, hourly_rate, payment_ref, amount_paid_paise"
    )
    .eq("id", event.sessionId)
    .single();

  if (!session) {
    console.error(`[webhook] no session for ${event.sessionId}, ref ${event.paymentRef}`);
    return ok();
  }

  const refundAndRecord = async (why: string, keepStatus: boolean) => {
    console.error(`[webhook] refunding ${event.sessionId} (${event.paymentRef}): ${why}`);
    try {
      const { refundRef } = await getPaymentPort().refund(event.paymentRef, event.amountPaise);
      await db
        .from("sessions")
        .update(
          keepStatus
            ? { amount_paid_paise: event.amountPaise, refund_ref: refundRef,
                payment_provider: paymentProviderName() }
            : { status: "refunded", amount_paid_paise: event.amountPaise,
                refund_ref: refundRef, payment_provider: paymentProviderName() }
        )
        .eq("id", event.sessionId);
    } catch (e) {
      // The one failure with no automatic recovery (design spec §9). Loud, with
      // the reference, because a human has to finish this by hand.
      console.error(
        `[webhook] REFUND FAILED for ${event.sessionId}, ref ${event.paymentRef}, ` +
          `amount ${event.amountPaise} — needs manual action:`,
        e
      );
    }
  };

  // The event names both a session and a charge. Trusting the session id alone
  // would let the payload decide which session gets marked paid; the charge
  // reference is the half WE stamped at checkout creation, and it is unique-
  // indexed. If they disagree, this event is not about this session — a replay
  // carrying another session's reference, a provider bug, or something worse —
  // and the honest response is to give the money back rather than credit a
  // session nobody paid for.
  if (session.payment_ref !== event.paymentRef) {
    await refundAndRecord(
      `payment_ref mismatch: row has ${session.payment_ref}, event carries ${event.paymentRef}`,
      true
    );
    return ok();
  }

  // A tampered checkout must not buy a session at the wrong price. This calls
  // the SAME function checkout creation called — spec §3.3.1 requires it, and
  // two independent implementations of a money calculation will eventually
  // disagree by a rounding step.
  if (event.amountPaise !== amountPaiseFor(session.hourly_rate, session.duration_minutes)) {
    await refundAndRecord("amount mismatch", true);
    return ok();
  }

  const actual = effectiveStatus(
    { ...session, status: session.status as SessionStatus },
    new Date()
  );

  // Already paid, already running, or already finished: a duplicate delivery.
  if (["paid", "active", "completed"].includes(session.status)) return ok();

  // The case people get wrong: the student paid, but we already released the
  // teacher. Never keep the money, and never resurrect a session whose teacher
  // has moved on. The row keeps its true status; refund_ref records the money.
  if (actual !== "accepted") {
    await refundAndRecord(`payment arrived while status was ${actual}`, true);
    return ok();
  }

  // Claim the transition. The status guard makes this idempotent: a second
  // delivery affects zero rows and falls through harmlessly.
  const { data: claimed } = await db
    .from("sessions")
    .update({
      status: "paid",
      amount_paid_paise: event.amountPaise,
      payment_provider: paymentProviderName(),
    })
    .eq("id", event.sessionId)
    .eq("status", "accepted")
    .select("id");
  if (!claimed || claimed.length === 0) return ok();

  // Mint the room. Idempotent since M2's review, so a retried webhook that
  // already created the room gets the same room back rather than a 400.
  const startedAt = new Date();
  try {
    const room = await createSessionRoom(
      event.sessionId,
      process.env.DAILY_API_KEY ?? "",
      fetch,
      roomTtlSeconds(startedAt, session.duration_minutes, startedAt)
    );
    await db
      .from("sessions")
      .update({
        status: "active",
        started_at: startedAt.toISOString(),
        daily_room_url: room.url,
      })
      .eq("id", event.sessionId)
      .eq("status", "paid");
  } catch (e) {
    console.error(`[webhook] room mint failed for ${event.sessionId}:`, e);
    // We hold their money and cannot deliver. `paid` is never a terminal
    // state (design spec §6 invariant 3) — refund is the only honest exit.
    await refundAndRecord("room could not be created", false);
  }

  return ok();
}
