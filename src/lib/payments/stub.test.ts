import { describe, it, expect } from "vitest";
import { stubPort } from "./stub";

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
    const sig = port.signForTest!(body);
    const event = await port.verifyWebhook(body, sig);
    expect(event).toEqual({ sessionId: "s1", amountPaise: 50000, paymentRef: "stub_1", kind: "succeeded" });
  });

  it("rejects a payload with a wrong signature", async () => {
    const body = JSON.stringify({ sessionId: "s1", amountPaise: 50000, paymentRef: "stub_1", kind: "succeeded" });
    await expect(port.verifyWebhook(body, "deadbeef")).rejects.toThrow(/signature/i);
  });

  it("rejects a tampered payload signed for different content", async () => {
    const original = JSON.stringify({ sessionId: "s1", amountPaise: 50000, paymentRef: "stub_1", kind: "succeeded" });
    const sig = port.signForTest!(original);
    const tampered = JSON.stringify({ sessionId: "s1", amountPaise: 1, paymentRef: "stub_1", kind: "succeeded" });
    await expect(port.verifyWebhook(tampered, sig)).rejects.toThrow(/signature/i);
  });

  it("refunds and returns a reference", async () => {
    expect((await port.refund("stub_1", 50000)).refundRef).toMatch(/^stubref_/);
  });

  it("refuses to exist without a secret", () => {
    expect(() => stubPort("")).toThrow(/secret/i);
  });
});
