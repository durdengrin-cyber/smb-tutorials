import { describe, it, expect, afterEach } from "vitest";
import { stubPort } from "./stub";
import { getPaymentPort } from "./index";

const port = stubPort("test-secret");

describe("stub payment port", () => {
  it("returns a checkout url carrying the session id", async () => {
    const r = await port.createCheckout({
      sessionId: "s1", amountPaise: 50000,
      successUrl: "http://x/waiting/s1", cancelUrl: "http://x/waiting/s1",
    });
    expect(r.checkoutUrl).toContain("s1");
    expect(r.paymentRef).toMatch(/^stub_/);
  });

  it("verifies a payload it signed", async () => {
    const body = JSON.stringify({ sessionId: "s1", amountPaise: 50000, paymentRef: "stub_1", kind: "succeeded" });
    const sig = port.signForTest(body);
    const event = await port.verifyWebhook(body, sig);
    expect(event).toEqual({ sessionId: "s1", amountPaise: 50000, paymentRef: "stub_1", kind: "succeeded" });
  });

  it("rejects a payload with a wrong signature", async () => {
    const body = JSON.stringify({ sessionId: "s1", amountPaise: 50000, paymentRef: "stub_1", kind: "succeeded" });
    await expect(port.verifyWebhook(body, "deadbeef")).rejects.toThrow(/signature/i);
  });

  it("rejects a tampered payload signed for different content", async () => {
    const original = JSON.stringify({ sessionId: "s1", amountPaise: 50000, paymentRef: "stub_1", kind: "succeeded" });
    const sig = port.signForTest(original);
    const tampered = JSON.stringify({ sessionId: "s1", amountPaise: 1, paymentRef: "stub_1", kind: "succeeded" });
    await expect(port.verifyWebhook(tampered, sig)).rejects.toThrow(/signature/i);
  });

  it("rejects a missing signature", async () => {
    const body = JSON.stringify({ sessionId: "s1", amountPaise: 50000, paymentRef: "stub_1", kind: "succeeded" });
    await expect(port.verifyWebhook(body, "")).rejects.toThrow(/signature/i);
  });

  it("refunds and returns a reference", async () => {
    expect((await port.refund("stub_1", 50000)).refundRef).toMatch(/^stubref_/);
  });

  it("refuses to exist without a secret", () => {
    expect(() => stubPort("")).toThrow(/secret/i);
  });
});

describe("production refuses the stub, independent of any caller", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalProvider = process.env.PAYMENT_PROVIDER;

  afterEach(() => {
    Object.defineProperty(process.env, "NODE_ENV", { value: originalNodeEnv, configurable: true, writable: true, enumerable: true });
    if (originalProvider === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = originalProvider;
  });

  it("stubPort itself refuses to be constructed under NODE_ENV=production", () => {
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true, writable: true, enumerable: true });
    expect(() => stubPort("test-secret")).toThrow(/production/i);
  });

  it("getPaymentPort refuses under NODE_ENV=production with PAYMENT_PROVIDER=stub", () => {
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true, writable: true, enumerable: true });
    process.env.PAYMENT_PROVIDER = "stub";
    expect(() => getPaymentPort()).toThrow(/production/i);
  });

  it("getPaymentPort refuses under NODE_ENV=production with PAYMENT_PROVIDER unset", () => {
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true, writable: true, enumerable: true });
    delete process.env.PAYMENT_PROVIDER;
    expect(() => getPaymentPort()).toThrow(/production/i);
  });
});

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

  it("is not blocked in production — unlike the stub", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true, writable: true, enumerable: true });
    configure();
    try {
      expect(() => getPaymentPort()).not.toThrow();
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", { value: originalNodeEnv, configurable: true, writable: true, enumerable: true });
    }
  });
});
