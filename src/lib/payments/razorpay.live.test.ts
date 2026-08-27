import { describe, it, expect } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { razorpayPort } from "./razorpay";

// THE EVIDENCE STEP (Task 12 Step 5, design spec §8). Every other test in
// this directory asserts against a mock and is therefore documentation, not
// evidence — M2 shipped a broken Daily payload precisely because a mock-based
// test agreed with the bug and passed a full code review. This file calls the
// REAL Razorpay test-mode API through the REAL adapter, so what it proves is
// the code that ships, not a restatement of it.
//
// Skipped unless asked for, because it needs credentials and the network:
//   RAZORPAY_LIVE_PROBE=1 npx vitest run src/lib/payments/razorpay.live.test.ts
//
// WHAT THIS CANNOT PROVE, stated so nobody reads a green run as more than it
// is: a webhook signed by Razorpay itself. That requires Razorpay to actually
// send one, which requires a real test payment in a browser — Task 13's
// manual gate. What this does prove is that our credentials work, that our
// request shape is one Razorpay accepts, and that the response carries the
// fields the adapter reads.

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);

const KEY_ID = env.RAZORPAY_KEY_ID ?? "";
const KEY_SECRET = env.RAZORPAY_KEY_SECRET ?? "";
const WEBHOOK_SECRET = env.PAYMENT_WEBHOOK_SECRET ?? "";
const enabled = process.env.RAZORPAY_LIVE_PROBE === "1";

describe.skipIf(!enabled)("razorpay — LIVE test-mode calls", () => {
  // Never let this file touch a live key. A live payment link is a real
  // demand for money from whoever opens it.
  it("refuses to run against anything but a test key", () => {
    expect(KEY_ID).toMatch(/^rzp_test_/);
    expect(KEY_SECRET.length).toBeGreaterThan(0);
    expect(WEBHOOK_SECRET.length).toBeGreaterThan(0);
  });

  it("creates a real payment link, reads it back, and cancels it", async () => {
    const port = razorpayPort(KEY_ID, KEY_SECRET, WEBHOOK_SECRET);
    // A throwaway reference id: Razorpay treats reference_id as unique, so
    // reusing a real session id here would poison that session's checkout.
    // A BARE uuid, deliberately — Razorpay caps reference_id at 40 chars and
    // a prefixed one (42) is rejected. This mirrors what the app sends, which
    // is the whole point: a probe using a different shape would prove nothing
    // about the shape that ships.
    const reference = crypto.randomUUID();
    expect(reference.length).toBe(36);

    const { checkoutUrl, paymentRef } = await port.createCheckout({
      sessionId: reference,
      amountPaise: 50000, // amountPaiseFor(500, 60) — the app's real figure
      successUrl: "https://smb-tutorials.vercel.app/waiting/probe",
      cancelUrl: "https://smb-tutorials.vercel.app/waiting/probe",
    });

    console.info(`[live] created ${paymentRef} -> ${checkoutUrl}`);
    expect(paymentRef).toMatch(/^plink_/);
    expect(checkoutUrl).toMatch(/^https:\/\//);

    // The second confirmation path against a link nobody has paid: null is
    // the correct answer, and proves the lookup itself works rather than
    // only proving creation works.
    await expect(port.fetchPayment(paymentRef)).resolves.toBe(null);

    // Read the raw link back and assert the exact fields the adapter depends
    // on are present and named what we think. This is the half that catches
    // an API drift the mocks would happily agree with.
    const auth = `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`;
    const res = await fetch(`https://api.razorpay.com/v1/payment_links/${paymentRef}`, {
      headers: { Authorization: auth },
    });
    expect(res.ok).toBe(true);
    const link = await res.json();
    expect(link.id).toBe(paymentRef);
    expect(link.reference_id).toBe(reference);
    expect(link.amount).toBe(50000);
    expect(link.currency).toBe("INR");
    expect(link.status).toBe("created");
    expect(link.notes?.session_id).toBe(reference);
    // refund() resolves the pay_... id from this array. It is empty until
    // someone pays, but the FIELD must exist — its absence is what would
    // break refunds, and it would break them only after money had moved.
    expect(link).toHaveProperty("payments");
    console.info(`[live] payments field on an unpaid link: ${JSON.stringify(link.payments)}`);

    // Don't leave a payable link lying around in the account.
    const cancelled = await fetch(
      `https://api.razorpay.com/v1/payment_links/${paymentRef}/cancel`,
      { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" } }
    );
    console.info(`[live] cancel ${paymentRef}: ${cancelled.status}`);
    expect(cancelled.ok).toBe(true);
  }, 45_000);

  it("rejects a wrongly-signed webhook and accepts a correctly-signed one", async () => {
    // Our half of the signature contract, exercised through the shipped code.
    // Razorpay's half — that it signs the way we expect — is Task 13's gate.
    const port = razorpayPort(KEY_ID, KEY_SECRET, WEBHOOK_SECRET);
    const raw = JSON.stringify({
      event: "payment_link.paid",
      payload: {
        payment_link: { entity: { id: "plink_x", reference_id: "s", amount: 50000, amount_paid: 50000 } },
        payment: { entity: { id: "pay_x", amount: 50000 } },
      },
    });
    const good = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    await expect(port.verifyWebhook(raw, good)).resolves.toMatchObject({ kind: "succeeded" });
    await expect(port.verifyWebhook(raw, good.replace(/.$/, "0"))).rejects.toThrow();
  });
});
