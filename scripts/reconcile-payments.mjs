#!/usr/bin/env node
// The money oracle. Reads the real sessions table and asserts the M3 design
// spec's §6 money-correctness invariants. Seeds nothing, writes nothing —
// unlike the probes, this is meant to run against production data and gate
// a deploy, so exit code is the whole contract: 0 means every invariant
// holds, non-zero means a human must look before anything else ships.
//
// Usage: node scripts/reconcile-payments.mjs
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);

const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const SELECT = "id,status,payment_ref,amount_paid_paise,refund_ref,created_at";

let failures = 0;
const ok = (pass, label) => {
  console.log(`  ${pass ? "\x1b[32mHOLDS \x1b[0m" : "\x1b[31mFAILS \x1b[0m"}  ${label}`);
  if (!pass) failures++;
};

const inr = (paise) => `₹${(paise / 100).toFixed(2)}`;
const list = (rows) =>
  rows
    .map((r) => `      ${r.id}  status=${r.status.padEnd(16)} amount=${r.amount_paid_paise ?? "—"} refund_ref=${r.refund_ref ?? "—"} payment_ref=${r.payment_ref ?? "—"}`)
    .join("\n");

(async () => {
  console.log("reconcile-payments — asserting M3 design spec §6 against the live table\n");

  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sessions?select=${SELECT}&order=created_at.asc`, { headers: H });
  if (!res.ok) {
    console.error("query failed:", res.status, await res.text());
    process.exit(1);
  }
  const rows = await res.json();
  console.log(`${rows.length} row(s) in sessions\n`);

  // Invariant 3 is the one that catches everything else: `paid` is not a
  // status the row is meant to rest in — the webhook's only two exits from
  // it are `active` and `refunded`. A row sitting here means money was taken
  // and no room was ever delivered, and nothing in the product fixes it on
  // its own.
  const stuck = rows.filter((r) => r.status === "paid");
  ok(stuck.length === 0, "invariant 3 — no row is stuck at 'paid'");
  if (stuck.length > 0) console.log(list(stuck) + "\n");

  // Invariant 2: money moved (amount_paid_paise is set) must have landed
  // somewhere — either the session actually ran (active/completed) or the
  // money went back (refund_ref). Anything else is money the product is
  // holding with no story attached to it.
  const orphaned = rows.filter(
    (r) => r.amount_paid_paise !== null && r.refund_ref === null && !["active", "completed"].includes(r.status)
  );
  ok(orphaned.length === 0, "invariant 2 — every charged row reached 'active'/'completed' or carries a refund_ref");
  if (orphaned.length > 0) console.log(list(orphaned) + "\n");

  // Invariant 1: the flip side of invariant 3 — the ONLY door into `active`
  // is through a claimed payment, so an active row with no amount recorded
  // means the room-minting step ran without ever being paid for.
  const unpaidActive = rows.filter((r) => r.status === "active" && r.amount_paid_paise === null);
  ok(unpaidActive.length === 0, "invariant 1 — no 'active' row lacks a confirmed payment");
  if (unpaidActive.length > 0) console.log(list(unpaidActive) + "\n");

  // Invariant 4 is informational, not a pass/fail gate on its own — it is
  // exactly what the teacher dashboard's earnings figure is supposed to sum.
  // Printed here so a human can eyeball it against the provider dashboard
  // alongside the payment_ref list above.
  const earned = rows.filter((r) => r.status === "completed" && r.refund_ref === null);
  const totalPaise = earned.reduce((sum, r) => sum + (r.amount_paid_paise ?? 0), 0);
  console.log(`  invariant 4 (informational) — earnings across ${earned.length} completed, non-refunded session(s): ${inr(totalPaise)}`);

  const withRef = rows.filter((r) => r.payment_ref !== null);
  console.log(`\n  ${withRef.length} row(s) carry a payment_ref — match these against the provider by hand:`);
  console.log(withRef.length > 0 ? list(withRef) : "      (none)");

  console.log();
  if (failures === 0) {
    console.log("ALL INVARIANTS HOLD.");
    process.exit(0);
  } else {
    console.log(`${failures} INVARIANT(S) VIOLATED — do not deploy until a human resolves the row(s) above.`);
    process.exit(1);
  }
})().catch((e) => {
  console.error("reconciliation crashed:", e);
  process.exit(1);
});
