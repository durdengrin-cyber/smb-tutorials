---
name: forcing-the-refund-path
description: How to trigger the payment webhook's refund branch on demand, without winning a race
metadata:
  type: project
---

To make the payment webhook refund on demand — no timing, no luck:

1. Request → teacher accepts → student clicks **Pay** (this mints the Razorpay
   link and stamps `payment_checkout_url` on the row).
2. Browser **back** to the app, then **Cancel**. The row goes `cancelled`.
3. Read that session's `payment_checkout_url` from the database and **pay it**.

The webhook then arrives for a row that is no longer `accepted`, which is the
branch that must refund rather than keep the money
(`settle.ts`, "payment arrived while status was ...").

**Why it works:** `payment_checkout_url` is stamped when Pay is clicked and
**survives the cancel** — the Razorpay link stays live because nothing cancels
it provider-side.

**Why it matters:** the pay/cancel race is the only path in the system that can
lose money, and it cannot be won reliably by hand. This turns it into a
repeatable test. It proved the refund arm twice on 2026-08-27/28, including
that `refund()` resolves the `pay_…` id from the `plink_…` id against a real
captured payment — which an unpaid link can never prove, since its `payments`
array is empty.

Verify both sides afterwards, never just ours: the row's `refund_ref`, **and**
`GET https://api.razorpay.com/v1/refunds/{id}` showing `processed`. A reference
recorded with no refund at the provider is the worst possible outcome.

Related: [[env-local-is-tylers-to-edit]] (the probes read credentials from it).
