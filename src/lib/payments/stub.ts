import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CheckoutRequest, CheckoutResult, PaymentPort, RefundResult, WebhookEvent,
} from "./port";

// A local stand-in for a payment provider, so the whole M3 flow can be built
// and walked end to end before a provider is chosen (design spec §11). It
// signs and verifies with a real HMAC, so the webhook route is exercised the
// same way a provider would exercise it.
//
// It must NEVER be reachable in production: it would let anyone mark a session
// paid. index.ts enforces that, and stub.test.ts proves it.
export function stubPort(secret: string): PaymentPort {
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

    signForTest: sign,
  };
}
