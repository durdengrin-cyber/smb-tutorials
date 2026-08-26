// The whole provider surface M3 needs. Anything a provider does beyond this
// is not our concern; anything we need beyond this is a change to the port,
// deliberately, in one place (design spec §3.4).
//
// This interface is also the agreed extension point for design spec decision 3
// — repeat-usage behaviour is unknown, so M3 ships per-session checkout but
// must not foreclose it. Two known future additions slot in here without
// touching a single caller:
//   authorize() / capture()  — the card-only optimisation (spec decision 4)
//   savePaymentMethod()      — stored methods, if repeat usage materialises
// Do not bake "one-off purchase" assumptions into callers; keep that knowledge
// behind this interface.

export interface CheckoutRequest {
  sessionId: string;
  amountPaise: number;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  paymentRef: string;
}

export interface WebhookEvent {
  sessionId: string;
  amountPaise: number;
  paymentRef: string;
  kind: "succeeded" | "failed";
}

export interface RefundResult {
  refundRef: string;
}

export interface PaymentPort {
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  // Throws on a bad or missing signature. Never returns a partial event.
  verifyWebhook(rawBody: string, signature: string): Promise<WebhookEvent>;
  refund(paymentRef: string, amountPaise: number): Promise<RefundResult>;
  // Test-only helper, present on the stub and absent on real adapters.
  signForTest?(rawBody: string): string;
}
