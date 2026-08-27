import { getPaymentPort, type WebhookEvent } from "@/lib/payments";
import { settleVerifiedEvent } from "@/lib/payments/settle";

// The signature check below depends on node:crypto, and every real provider
// SDK will too. Node is the App Router default, but pinning it documents a
// hard requirement of the security boundary rather than relying on a default.
export const runtime = "nodejs";

// This route's whole job is the SIGNATURE. Everything after it — claim, mint,
// activate, refund — lives in settle.ts, because design spec §3.6's second
// confirmation path (verifyPaymentNow) must run exactly the same logic rather
// than a copy of it.
export async function POST(req: Request) {
  // The exact bytes. req.json() parses and re-serialises, and the signature
  // stops matching — the classic footgun in every webhook integration.
  const rawBody = await req.text();
  // x-razorpay-signature is the live one; the other two are kept so a
  // provider swap does not silently start reading an absent header.
  const signature =
    req.headers.get("x-razorpay-signature") ??
    req.headers.get("x-payment-signature") ??
    req.headers.get("stripe-signature") ??
    "";

  let event: WebhookEvent;
  try {
    event = await getPaymentPort().verifyWebhook(rawBody, signature);
  } catch (e) {
    console.error("[webhook] signature rejected:", e);
    return new Response("bad signature", { status: 400 });
  }

  return settleVerifiedEvent(event);
}
