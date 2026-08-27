import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CheckoutRequest, CheckoutResult, PaymentPort, RefundResult, WebhookEvent,
} from "./port";

// The stub's signing capability is not on the shared PaymentPort contract —
// a real adapter must never be able to implement this member, live, by
// accident. Only code that explicitly asks for a StubPaymentPort can reach it.
export interface StubPaymentPort extends PaymentPort {
  signForTest(rawBody: string): string;
}

// A local stand-in for a payment provider, so the whole M3 flow can be built
// and walked end to end before a provider is chosen (design spec §11). It
// signs and verifies with a real HMAC, so the webhook route is exercised the
// same way a provider would exercise it.
//
// It must NEVER be reachable in production: it would let anyone mark a session
// paid. index.ts enforces that, and stub.test.ts proves it.
export function stubPort(secret: string): StubPaymentPort {
  // The guards in index.ts, the dev checkout page and its action are all
  // external to this function — they protect the paths we happen to know
  // about. This one protects the capability itself, so a future caller that
  // imports this module directly cannot mint a valid signature in production.
  if (process.env.NODE_ENV === "production") {
    throw new Error("stubPort must never be constructed in production");
  }
  if (!secret) throw new Error("stub payment port requires a secret");

  const sign = (rawBody: string) =>
    createHmac("sha256", secret).update(rawBody).digest("hex");

  return {
    async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
      const paymentRef = `stub_${req.sessionId}`;
      // A local page that stands in for the provider's hosted checkout.
      const url = new URL("/dev/checkout", req.successUrl);
      url.searchParams.set("session", req.sessionId);
      url.searchParams.set("amount", String(req.amountPaise));
      url.searchParams.set("ref", paymentRef);
      url.searchParams.set("success", req.successUrl);
      url.searchParams.set("cancel", req.cancelUrl);
      return { checkoutUrl: url.toString(), paymentRef };
    },

    async verifyWebhook(rawBody: string, signature: string): Promise<WebhookEvent> {
      const expected = sign(rawBody);
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(signature ?? "", "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new Error("invalid webhook signature");
      }
      return JSON.parse(rawBody) as WebhookEvent;
    },

    async refund(paymentRef: string): Promise<RefundResult> {
      return { refundRef: `stubref_${paymentRef}` };
    },

    // There is no provider to ask. Null is the honest answer, and it is the
    // same answer the real adapter gives for an unpaid charge, so
    // verifyPaymentNow behaves identically against both — it simply never
    // finds anything here. The dev checkout page drives the webhook directly,
    // so the stub never needs a second path.
    async fetchPayment(): Promise<WebhookEvent | null> {
      return null;
    },

    signForTest: sign,
  };
}
