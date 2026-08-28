import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { razorpayPort } from "./razorpay";
import { getPaymentPort, paymentProviderName } from "./index";

const KEY_ID = "rzp_test_key";
const KEY_SECRET = "key_secret";
const WEBHOOK_SECRET = "webhook_secret";
const SESSION = "11111111-2222-3333-4444-555555555555";
const PLINK = "plink_TESTLINK";
const PAY = "pay_TESTPAYMENT";

const port = (fetchImpl: typeof fetch) =>
  razorpayPort(KEY_ID, KEY_SECRET, WEBHOOK_SECRET, fetchImpl);

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const sign = (raw: string) => createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");

// The shape Razorpay actually posts. These are DOCUMENTATION of the payload,
// not evidence that Razorpay sends it — spec §8 is explicit that a mock
// cannot prove a provider's contract. The live call in Task 12 Step 5 is the
// evidence; this file exists so a future change that breaks the mapping fails
// loudly instead of silently.
const paidEvent = {
  entity: "event",
  event: "payment_link.paid",
  contains: ["payment_link", "payment"],
  payload: {
    payment_link: {
      entity: {
        id: PLINK,
        entity: "payment_link",
        status: "paid",
        reference_id: SESSION,
        amount: 50000,
        amount_paid: 50000,
        currency: "INR",
      },
    },
    payment: {
      entity: { id: PAY, entity: "payment", amount: 50000, currency: "INR", status: "captured" },
    },
  },
};

describe("razorpayPort — construction", () => {
  it("refuses to build without a key id, key secret or webhook secret", () => {
    expect(() => razorpayPort("", KEY_SECRET, WEBHOOK_SECRET)).toThrow();
    expect(() => razorpayPort(KEY_ID, "", WEBHOOK_SECRET)).toThrow();
    expect(() => razorpayPort(KEY_ID, KEY_SECRET, "")).toThrow();
  });
});

describe("razorpayPort.createCheckout", () => {
  it("creates a payment link with the amount in paise and the session as reference_id", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({ id: PLINK, short_url: "https://rzp.io/i/abc", status: "created" })
    ) as unknown as typeof fetch;

    const result = await port(fetchImpl).createCheckout({
      sessionId: SESSION,
      amountPaise: 50000,
      successUrl: "https://app.test/waiting/x",
      cancelUrl: "https://app.test/waiting/x",
    });

    expect(result).toEqual({ checkoutUrl: "https://rzp.io/i/abc", paymentRef: PLINK });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.razorpay.com/v1/payment_links");
    expect(init.method).toBe("POST");
    // Basic auth, key id as user, key secret as password.
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`
    );
    const body = JSON.parse(init.body);
    expect(body.amount).toBe(50000);
    expect(body.currency).toBe("INR");
    // reference_id is how the webhook maps a charge back to a session.
    expect(body.reference_id).toBe(SESSION);
    expect(body.callback_url).toBe("https://app.test/waiting/x");
    expect(body.callback_method).toBe("get");
    // Notes ride along onto the payment, so a payment.failed event can still
    // name the session even though it carries no payment link.
    expect(body.notes.session_id).toBe(SESSION);
  });

  it("throws when Razorpay refuses the link", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({ error: { description: "reference_id already exists" } }, 400)
    ) as unknown as typeof fetch;
    await expect(
      port(fetchImpl).createCheckout({
        sessionId: SESSION, amountPaise: 50000,
        successUrl: "https://app.test/w", cancelUrl: "https://app.test/w",
      })
    ).rejects.toThrow(/razorpay/i);
  });

  it("throws rather than returning a link with no url", async () => {
    // A 200 with a missing short_url would otherwise send the student to
    // "undefined" and strand an accepted session.
    const fetchImpl = vi.fn(async () => jsonRes({ id: PLINK })) as unknown as typeof fetch;
    await expect(
      port(fetchImpl).createCheckout({
        sessionId: SESSION, amountPaise: 50000,
        successUrl: "https://app.test/w", cancelUrl: "https://app.test/w",
      })
    ).rejects.toThrow();
  });
});

describe("razorpayPort.verifyWebhook", () => {
  const noFetch = (() => { throw new Error("verifyWebhook must not call the network"); }) as unknown as typeof fetch;

  it("maps a genuinely signed payment_link.paid to a succeeded event", async () => {
    const raw = JSON.stringify(paidEvent);
    const event = await port(noFetch).verifyWebhook(raw, sign(raw));
    expect(event).toEqual({
      sessionId: SESSION,
      amountPaise: 50000,
      paymentRef: PLINK,
      kind: "succeeded",
    });
  });

  it("rejects a wrong signature", async () => {
    const raw = JSON.stringify(paidEvent);
    await expect(port(noFetch).verifyWebhook(raw, sign("something else"))).rejects.toThrow();
  });

  it("rejects a tampered body", async () => {
    const raw = JSON.stringify(paidEvent);
    const signature = sign(raw);
    const tampered = raw.replace('"amount":50000', '"amount":1');
    await expect(port(noFetch).verifyWebhook(tampered, signature)).rejects.toThrow();
  });

  it("rejects a missing signature", async () => {
    const raw = JSON.stringify(paidEvent);
    await expect(port(noFetch).verifyWebhook(raw, "")).rejects.toThrow();
  });

  it("maps payment.failed to a failed event, carrying the session from notes", async () => {
    const failed = {
      event: "payment.failed",
      payload: {
        payment: {
          entity: { id: PAY, amount: 50000, status: "failed", notes: { session_id: SESSION } },
        },
      },
    };
    const raw = JSON.stringify(failed);
    const event = await port(noFetch).verifyWebhook(raw, sign(raw));
    expect(event.kind).toBe("failed");
    expect(event.sessionId).toBe(SESSION);
  });

  it("ignores events it does not act on instead of throwing", async () => {
    // We subscribe to payment.captured and refund.processed for visibility.
    // Throwing here would make the route answer 400, which Razorpay reads as
    // a failure and retries — forever, for an event we never wanted to act on.
    for (const name of ["payment.captured", "refund.processed", "payment.dispute.created"]) {
      const raw = JSON.stringify({ event: name, payload: {} });
      const event = await port(noFetch).verifyWebhook(raw, sign(raw));
      expect(event.kind).toBe("ignored");
    }
  });

  it("refuses a payment_link.paid with no reference_id rather than inventing one", async () => {
    const orphan = JSON.parse(JSON.stringify(paidEvent));
    delete orphan.payload.payment_link.entity.reference_id;
    const raw = JSON.stringify(orphan);
    await expect(port(noFetch).verifyWebhook(raw, sign(raw))).rejects.toThrow();
  });
});

describe("razorpayPort.refund — the payment id is not the payment link id", () => {
  it("resolves the payment id from the link, then refunds against it", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith(`/payment_links/${PLINK}`)) {
        return jsonRes({
          id: PLINK, status: "paid", amount: 50000, amount_paid: 50000,
          reference_id: SESSION,
          payments: [{ payment_id: PAY, status: "captured", amount: 50000 }],
        });
      }
      return jsonRes({ id: "rfnd_TEST", entity: "refund", amount: 50000 });
    }) as unknown as typeof fetch;

    const result = await port(fetchImpl).refund(PLINK, 50000);
    expect(result).toEqual({ refundRef: "rfnd_TEST" });
    expect(calls[0]).toBe(`https://api.razorpay.com/v1/payment_links/${PLINK}`);
    expect(calls[1]).toBe(`https://api.razorpay.com/v1/payments/${PAY}/refund`);
  });

  it("throws when the link carries no captured payment", async () => {
    // Refunding nothing must be loud: the webhook's caller records a
    // REFUND ISSUED alarm on success, so a silent no-op here would claim
    // money was returned when it never was.
    const fetchImpl = vi.fn(async () =>
      jsonRes({ id: PLINK, status: "created", payments: [] })
    ) as unknown as typeof fetch;
    await expect(port(fetchImpl).refund(PLINK, 50000)).rejects.toThrow();
  });

  it("throws when the refund call itself fails", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("/payment_links/")
        ? jsonRes({ id: PLINK, status: "paid", payments: [{ payment_id: PAY, status: "captured" }] })
        : jsonRes({ error: { description: "refund failed" } }, 400)
    ) as unknown as typeof fetch;
    await expect(port(fetchImpl).refund(PLINK, 50000)).rejects.toThrow();
  });
});

describe("razorpayPort.fetchPayment — the second confirmation path (spec §3.6)", () => {
  it("returns a succeeded event when the link has been paid", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({
        id: PLINK, status: "paid", amount: 50000, amount_paid: 50000,
        reference_id: SESSION, payments: [{ payment_id: PAY, status: "captured" }],
      })
    ) as unknown as typeof fetch;
    await expect(port(fetchImpl).fetchPayment(PLINK)).resolves.toEqual({
      sessionId: SESSION, amountPaise: 50000, paymentRef: PLINK, kind: "succeeded",
    });
  });

  it("returns null while the link is still unpaid", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({ id: PLINK, status: "created", amount: 50000, amount_paid: 0, reference_id: SESSION })
    ) as unknown as typeof fetch;
    await expect(port(fetchImpl).fetchPayment(PLINK)).resolves.toBe(null);
  });

  it("returns null rather than throwing when the lookup fails", async () => {
    // This drives a best-effort re-check on a page the student is looking at.
    // A provider outage must not surface as a crash on the waiting screen.
    const fetchImpl = vi.fn(async () => jsonRes({ error: {} }, 500)) as unknown as typeof fetch;
    await expect(port(fetchImpl).fetchPayment(PLINK)).resolves.toBe(null);
  });
});

// getPaymentPort() and paymentProviderName() live in ./index, but their only
// real branch is razorpay now that the stub is gone — so their behaviour is
// tested alongside the adapter it dispatches to.
describe("getPaymentPort — the razorpay branch", () => {
  const saved = {
    provider: process.env.PAYMENT_PROVIDER,
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET,
  };
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };

  afterEach(() => {
    restore("PAYMENT_PROVIDER", saved.provider);
    restore("RAZORPAY_KEY_ID", saved.keyId);
    restore("RAZORPAY_KEY_SECRET", saved.keySecret);
    restore("PAYMENT_WEBHOOK_SECRET", saved.webhookSecret);
  });

  const configure = (overrides: Record<string, string | undefined> = {}) => {
    process.env.PAYMENT_PROVIDER = "razorpay";
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = "s";
    process.env.PAYMENT_WEBHOOK_SECRET = "w";
    for (const [k, v] of Object.entries(overrides)) restore(k, v);
  };

  it("returns a working port when every credential is present", () => {
    configure();
    const port = getPaymentPort();
    expect(typeof port.createCheckout).toBe("function");
    // The §3.6 second path is part of the contract now, not optional.
    expect(typeof port.fetchPayment).toBe("function");
  });

  it("refuses at construction when a credential is missing", () => {
    // Not at the first charge. A missing webhook secret is the dangerous one:
    // checkout would work, the student would pay, and every webhook would
    // fail verification — money taken, nothing delivered.
    for (const missing of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "PAYMENT_WEBHOOK_SECRET"]) {
      configure({ [missing]: undefined });
      expect(() => getPaymentPort(), `missing ${missing}`).toThrow(new RegExp(missing));
    }
  });

  it("is not blocked in production", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true, writable: true, enumerable: true });
    configure();
    try {
      expect(() => getPaymentPort()).not.toThrow();
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", { value: originalNodeEnv, configurable: true, writable: true, enumerable: true });
    }
  });

  it("refuses loudly rather than defaulting when PAYMENT_PROVIDER is unset", () => {
    delete process.env.PAYMENT_PROVIDER;
    expect(() => getPaymentPort()).toThrow(/PAYMENT_PROVIDER is unset/);
    expect(() => paymentProviderName()).toThrow(/PAYMENT_PROVIDER is unset/);
  });

  it("paymentProviderName reports the configured provider — this value is written onto real payment rows", () => {
    configure();
    expect(paymentProviderName()).toBe("razorpay");
  });
});
