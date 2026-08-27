#!/usr/bin/env node
// Is the DEPLOYED webhook really running the Razorpay adapter with the right
// secret?
//
// Usage: node scripts/probe-deployed-webhook.mjs <full webhook url>
//   preview:    https://smb-tutorials-git-m3-payments-durdengrin-6266s-projects.vercel.app/api/payments/webhook
//   production: https://smb-tutorials.vercel.app/api/payments/webhook  (after M3 merges)
//
// Run it after ANY change to the payment env vars, and again after M3 merges
// to main — the webhook URL moves to production and none of the checks that
// passed on preview say anything about that deployment. A 400 alone cannot tell you: getPaymentPort()'s construction throw
// (missing credential, stub refused in production) is caught by the same
// try/catch that rejects a bad signature, so both look identical from outside.
//
// A correctly SIGNED request is the discriminator. If the adapter is built and
// the deployed PAYMENT_WEBHOOK_SECRET matches this one, verification passes,
// the settle path looks up a session that does not exist, and the route
// answers 200. Nothing is written — the session id is a random uuid.
import fs from "node:fs";
import crypto from "node:crypto";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const secret = env.PAYMENT_WEBHOOK_SECRET;
if (!secret) { console.error("PAYMENT_WEBHOOK_SECRET missing from .env.local"); process.exit(1); }

const url = process.argv[2];
const body = JSON.stringify({
  event: "payment_link.paid",
  payload: {
    payment_link: {
      entity: {
        id: `plink_probe${crypto.randomBytes(6).toString("hex")}`,
        reference_id: crypto.randomUUID(),   // no such session — read finds nothing
        amount: 50000, amount_paid: 50000, status: "paid",
      },
    },
    payment: { entity: { id: "pay_probe", amount: 50000 } },
  },
});
const good = crypto.createHmac("sha256", secret).update(body).digest("hex");

const post = async (sig) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": sig },
    body,
  });
  return { status: res.status, text: (await res.text()).slice(0, 60) };
};

const signed = await post(good);
const tampered = await post(good.replace(/.$/, good.endsWith("0") ? "1" : "0"));

console.log(`  correctly signed : ${signed.status}  ${signed.text}`);
console.log(`  wrong signature  : ${tampered.status}  ${tampered.text}`);
console.log();
if (signed.status === 200 && tampered.status === 400) {
  console.log("CONFIGURED — the adapter is live and the deployed secret matches .env.local.");
  process.exit(0);
}
if (signed.status === 400 && tampered.status === 400) {
  console.log("NOT CONFIGURED (or the secret differs). Both rejected, so the signature");
  console.log("never verified: either a credential is missing/misnamed on Vercel, or the");
  console.log("deployed PAYMENT_WEBHOOK_SECRET is not the one in .env.local, or this");
  console.log("deployment predates the env vars and needs a redeploy.");
  process.exit(1);
}
console.log("UNEXPECTED — investigate before running the two-browser test.");
process.exit(1);
