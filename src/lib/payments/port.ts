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
  // "ignored" was added for the first real adapter (Task 12) and is not
  // decoration. A provider sends events we never asked to act on — Razorpay
  // delivers payment.captured alongside payment_link.paid, plus
  // refund.processed and dispute events. verifyWebhook must not throw for
  // those: the route answers 400 on a throw, the provider reads that as a
  // failure, and it retries an event we were never going to act on, forever.
  // The stub never needed this because it only ever sent what we handed it.
  kind: "succeeded" | "failed" | "ignored";
}

export interface RefundResult {
  refundRef: string;
}

export interface PaymentPort {
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  // Throws on a bad or missing signature. Never returns a partial event.
  verifyWebhook(rawBody: string, signature: string): Promise<WebhookEvent>;
  refund(paymentRef: string, amountPaise: number): Promise<RefundResult>;
  // Ask the provider directly what happened to a charge — design spec §3.6's
  // SECOND confirmation path, for when a webhook never arrives. Returns the
  // same event shape the webhook produces, so one code path can settle a
  // payment whichever way the news reaches us; null means "no payment yet",
  // which is the ordinary answer while a student is still at checkout.
  //
  // Returns null rather than throwing on a provider outage: this runs on a
  // page the student is looking at, and an outage must not surface as a
  // crash on the waiting screen.
  fetchPayment(paymentRef: string): Promise<WebhookEvent | null>;
}
