import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CheckoutRequest, CheckoutResult, PaymentPort, RefundResult, WebhookEvent,
} from "./port";
import { DuplicateRefundError } from "./port";

const RAZORPAY_API = "https://api.razorpay.com/v1";

// Plain fetch with an injected impl rather than the SDK, following daily.ts:
// it is the pattern this codebase already tests against, and the surface here
// is four calls. An SDK would also hide the raw body, which is precisely the
// thing the signature is computed over.
export function razorpayPort(
  keyId: string,
  keySecret: string,
  webhookSecret: string,
  fetchImpl: typeof fetch = fetch
): PaymentPort {
  // Fail at construction, not at the first charge. A missing webhook secret
  // in particular is silent otherwise: checkout would work, the student would
  // pay, and every webhook would fail verification — money taken, nothing
  // delivered, which is the exact failure the whole milestone is built around.
  if (!keyId) throw new Error("RAZORPAY_KEY_ID is not set");
  if (!keySecret) throw new Error("RAZORPAY_KEY_SECRET is not set");
  if (!webhookSecret) throw new Error("PAYMENT_WEBHOOK_SECRET is not set");

  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
  const headers = { Authorization: auth, "Content-Type": "application/json" };

  // Razorpay returns its reason under error.description. Surfacing it is the
  // difference between a debuggable failure and "checkout failed".
  const fail = async (res: Response, what: string): Promise<never> => {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error?.description ?? JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`razorpay ${what} failed: ${res.status} ${detail}`);
  };

  const getLink = async (linkId: string) => {
    const res = await fetchImpl(`${RAZORPAY_API}/payment_links/${linkId}`, { headers });
    if (!res.ok) await fail(res, `payment link lookup (${linkId})`);
    return res.json();
  };

  return {
    async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
      const res = await fetchImpl(`${RAZORPAY_API}/payment_links`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          amount: req.amountPaise,
          currency: "INR",
          // How the webhook maps a charge back to a session. Razorpay treats
          // reference_id as unique, which is a second lock on top of the
          // database's write-once payment_ref: a retry that tried to open a
          // SECOND charge for the same session is refused by the provider,
          // not just by us.
          //
          // MUST STAY THE BARE SESSION ID. Razorpay caps reference_id at 40
          // characters — verified live, not read in a doc: prefixing it with
          // "probe-" during the evidence step produced
          // `400 reference_id: the length must be no more than 40`. A session
          // id is a 36-character UUID, so this fits with four characters to
          // spare and no more. Do not prefix, namespace or decorate it; the
          // failure would appear only against the real API, only at checkout,
          // and only for a student who is already waiting to pay.
          reference_id: req.sessionId,
          // Notes ride onto the payment itself, so a payment.failed event —
          // which carries no payment link — can still name its session.
          notes: { session_id: req.sessionId },
          callback_url: req.successUrl,
          callback_method: "get",
          description: "SMB Tutorials — 1:1 session",
          // Deliberately no expire_by. Razorpay's minimum link lifetime is far
          // longer than our 120-second payment window, so the link cannot be
          // the thing that enforces the deadline. payment_deadline and the
          // read-time rule own that, and they already do it in Postgres time
          // rather than the provider's.
        }),
      });
      if (!res.ok) await fail(res, "payment link creation");

      const link = await res.json();
      // A 200 carrying no url would send the student to "undefined" and strand
      // an accepted session with the teacher held. Refuse instead.
      if (!link?.short_url || !link?.id) {
        throw new Error(
          `razorpay payment link creation returned no usable link: ${JSON.stringify(link)}`
        );
      }
      return { checkoutUrl: link.short_url, paymentRef: link.id };
    },

    async verifyWebhook(rawBody: string, signature: string): Promise<WebhookEvent> {
      // HMAC over the EXACT bytes received. Razorpay's own docs say not to
      // parse or re-serialise the body first; the route hands us req.text()
      // for this reason and must keep doing so.
      const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(signature ?? "", "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new Error("invalid razorpay webhook signature");
      }

      const body = JSON.parse(rawBody);
      const name: string = body?.event ?? "";

      if (name === "payment_link.paid") {
        const link = body?.payload?.payment_link?.entity;
        const payment = body?.payload?.payment?.entity;
        // reference_id is the only thing tying this money to a session. An
        // event without one is unattributable, and guessing would risk
        // stamping a foreign amount onto someone else's lesson. Throwing
        // makes the route answer 400 and alarm rather than write.
        if (!link?.reference_id) {
          throw new Error(
            `razorpay payment_link.paid carried no reference_id (link ${link?.id ?? "?"})`
          );
        }
        return {
          sessionId: link.reference_id,
          // amount_paid is what actually moved; amount is what was asked for.
          // The webhook compares this against its own computation and refunds
          // a mismatch, so the honest number matters more than the tidy one.
          amountPaise: link.amount_paid ?? payment?.amount ?? link.amount,
          paymentRef: link.id,
          kind: "succeeded",
        };
      }

      if (name === "payment.failed") {
        const payment = body?.payload?.payment?.entity;
        return {
          sessionId: payment?.notes?.session_id ?? "",
          amountPaise: payment?.amount ?? 0,
          paymentRef: payment?.id ?? "",
          kind: "failed",
        };
      }

      // Everything else — payment.captured (which arrives alongside
      // payment_link.paid), refund.processed, disputes. Acknowledged, never
      // acted on. See the note on WebhookEvent.kind for why this must not throw.
      return { sessionId: "", amountPaise: 0, paymentRef: "", kind: "ignored" };
    },

    // THE IDENTIFIER TRAP, handled here rather than in the schema. We stamp
    // the payment LINK id (plink_...) as payment_ref, because that is what
    // exists at checkout time and what the webhook's identity check matches
    // on. Refunds go against the PAYMENT id (pay_...), which does not exist
    // until the student actually pays. Rather than add a second write-once
    // column and a migration, resolve one from the other at refund time: the
    // link knows its own payments.
    async refund(
      paymentRef: string,
      amountPaise: number,
      idempotencyKey: string
    ): Promise<RefundResult> {
      const link = await getLink(paymentRef);
      const payments: Array<{ payment_id?: string; status?: string }> = link?.payments ?? [];
      const captured =
        payments.find((p) => p.status === "captured") ?? payments.find((p) => p.payment_id);

      // Loud, not silent. The caller writes a "REFUND ISSUED" alarm on
      // success, so returning a fabricated ref here would claim money went
      // back when nothing did — the worst possible lie in this system.
      if (!captured?.payment_id) {
        throw new Error(
          `razorpay refund: payment link ${paymentRef} carries no captured payment to refund`
        );
      }

      const res = await fetchImpl(`${RAZORPAY_API}/payments/${captured.payment_id}/refund`, {
        method: "POST",
        headers,
        // receipt is Razorpay's idempotency key for refund creation, per
        // their own docs: a second refund call carrying a receipt already
        // used on this payment is refused rather than issuing a second,
        // separate refund. We send the session id (idempotencyKey), which
        // is stable and unique per session, so two concurrent callers for
        // the same session collide here instead of each reaching the
        // provider for real.
        body: JSON.stringify({ amount: amountPaise, receipt: idempotencyKey }),
      });
      if (!res.ok) {
        // Peek at the body on a clone, so fail() below can still read it
        // fresh for the generic failure message — a Response body can only
        // be consumed once.
        let description: string | undefined;
        try {
          const body = await res.clone().json();
          description = body?.error?.description;
        } catch {
          description = undefined;
        }
        // This exact wording — "Duplicate receipt found for this refund
        // request" — is taken from Razorpay's published error table for
        // refund creation, not re-derived or guessed at here. It has NOT
        // been observed against a live response: producing a genuine
        // duplicate-receipt rejection needs a real captured payment refunded
        // twice, which razorpay.live.test.ts's probe cannot do without
        // spending real money. That probe DID confirm live that Razorpay
        // accepts a `receipt` field at all (a real 400, "The id provided
        // does not exist", at input_validation_failed) — it did not, and
        // could not, confirm this specific wording. Matched narrowly, by
        // exact string equality: if the live wording ever differs from what
        // is quoted here, this branch simply never matches, and the
        // rejection falls straight through to fail()'s generic, loud
        // failure — the safe direction to be wrong in.
        if (description === "Duplicate receipt found for this refund request") {
          throw new DuplicateRefundError(
            `razorpay refund of ${captured.payment_id}: receipt ${idempotencyKey} was already used — the refund already happened`
          );
        }
        await fail(res, `refund of ${captured.payment_id}`);
      }

      const refund = await res.json();
      if (!refund?.id) {
        throw new Error(`razorpay refund returned no id: ${JSON.stringify(refund)}`);
      }
      return { refundRef: refund.id };
    },

    async fetchPayment(paymentRef: string): Promise<WebhookEvent | null> {
      let link;
      try {
        link = await getLink(paymentRef);
      } catch (e) {
        // Best effort by contract (see PaymentPort.fetchPayment). This runs
        // on the screen the student is watching; a provider outage must read
        // as "no news yet", not as a crash.
        console.error(`[razorpay] fetchPayment lookup failed for ${paymentRef}:`, e);
        return null;
      }
      if (link?.status !== "paid" || !link?.reference_id) return null;
      return {
        sessionId: link.reference_id,
        amountPaise: link.amount_paid ?? link.amount,
        paymentRef: link.id,
        kind: "succeeded",
      };
    },
  };
}
