# M3 — Payments: Design Spec

**Date:** 2026-08-26
**Status:** approved in brainstorming; implementation plan not yet written
**Parent spec:** `2026-08-24-smb-tutorials-design.md` (§10 M3, §9 lifecycle, §12 open policy)
**Predecessor:** `2026-08-25-m2-presence-instant-pick-design.md` (shipped 2026-08-26)

---

## 1. Purpose

Insert payment between a teacher accepting a request and the video room being
created, so that money is collected for every session and no session runs
unpaid.

The parent spec describes this in one line — *"Insert Stripe Checkout between
accept and room creation"* — which understates it. M2 shipped a different flow
from the one the parent spec describes: it goes `pending → active`, minting the
Daily room inside `acceptSession`. M3 therefore does not bolt payment onto the
side of the loop; it **reopens the state machine at its most sensitive point**,
and that state machine is now enforced by a database trigger.

---

## 2. Decisions made in brainstorming

Each of these was put to the user and chosen explicitly. They are settled;
do not re-litigate them during planning or implementation.

1. **M3 ships before the redesign**, on a UI that is known to be temporary. The
   trade-off was stated when the choice was offered — the redesign then has to
   absorb the payment surfaces, and admin/payouts stays manual while real money
   is moving — and this order was chosen anyway.
2. **The flow is designed processor-agnostic.** A payment *port* with one
   adapter; the provider is chosen at implementation time, not now. This is a
   deliberate deviation from the parent spec's locked "Stripe Checkout" and is
   recorded as such (see §11). The motive: the market is Indian K-12 paying in
   INR, UPI is how most Indian consumers pay, and the current state of Stripe
   India's domestic/UPI support was not confirmed. The hard parts of this
   design — where payment sits, the second deadline, the webhook contract, the
   state machine — are provider-independent.
3. **Per-session checkout**, because repeat-usage behaviour is unknown. The
   schema and state machine must not foreclose stored payment methods or a
   prepaid balance later, but neither is built now.
4. **Payment sits after accept** (Approach A of three considered):
   `pick → accept → pay → room`. Rejected alternatives, with reasons:
   - *Pay before request*: removes the teacher-waiting problem entirely, but
     makes every decline and timeout a refund. In India that matters more than
     the parent spec allows for — UPI refunds take days and processor fees are
     frequently non-refundable — so it generates the worst friction on the
     worst-case path.
   - *Authorize on pick, capture on accept*: the best experience on paper, but
     auth/capture is a card feature and UPI generally does not support it.
     Adopting it would force either cards-only (wrong for this market) or a
     provider decision now (explicitly deferred). **Held as a card-only
     optimisation to add later, not a foundation.**
5. **Screens built for M3 are deliberately minimal and disposable** in styling,
   because the redesign will rebuild them. State logic correct; visual
   investment near zero.

**The cost of decision 4, stated plainly:** the teacher waits while the student
checks out, and can be ghosted. The design work is in making that wait short,
visible and safely reversible. This is the milestone's central tension.

---

## 3. Architecture

### 3.1 The state machine

M2 left `accepted` reserved but unused. M3 uses it, and adds three statuses.

```
pending ──accept──> accepted ──payment──> paid ──room──> active ──> completed
   │                    │                   │
   ├─ declined          ├─ payment_expired  └─ refunded
   ├─ timed_out         └─ cancelled
   └─ cancelled
```

**`paid` is a distinct state from `active`, on purpose.** It means *"we have
their money and owe them a room."* If room minting fails after a successful
charge, the session sits visibly in `paid` rather than silently swallowing a
payment, and `refunded` is the only honest exit from it. Collapsing `paid` into
`active` would make a taken-but-undelivered payment invisible.

Terminal statuses: `completed`, `declined`, `timed_out`, `cancelled`,
`payment_expired`, `refunded`.

**The transition table, stated explicitly**, because `ALLOWED` in
`src/lib/session.ts` and the `enforce_session_update` trigger must both match
it exactly. Note the two **removals** — leaving them in would let a teacher
reach a room without payment:

| From | To | Who may make it |
|---|---|---|
| `pending` | `accepted` | teacher |
| `pending` | `declined` | teacher |
| `pending` | `timed_out` | either participant, only after `accept_deadline` |
| `pending` | `cancelled` | student |
| `accepted` | `paid` | **service role only** |
| `accepted` | `payment_expired` | either participant, only after `payment_deadline` |
| `accepted` | `cancelled` | student |
| `paid` | `active` | **service role only** |
| `paid` | `refunded` | **service role only** |
| `active` | `completed` | either participant |

**Removed from M2's table:** `pending → active` and `accepted → active`. Accept
no longer produces a room, so the only route to `active` is through `paid`.
Both removals must land in `ALLOWED` *and* in the trigger; leaving either in
place reopens exactly the hole §3.3 exists to close.

### 3.2 Two deadlines, one mechanism

M2 enforces its accept window with a read-time rule rather than a timer,
because the stack is serverless with nothing running in the background. M3
reuses that mechanism rather than inventing a second one:

| Deadline | Set when | Expiry derives to |
|---|---|---|
| `accept_deadline` (existing, 30s) | request created | `timed_out` |
| `payment_deadline` (new) | teacher accepts | `payment_expired` |

`effectiveStatus()` gains one branch: an `accepted` row past its
`payment_deadline` reads as `payment_expired`, exactly as a `pending` row past
its `accept_deadline` reads as `timed_out`. Settle-on-read writes the
derivation back, as M2's Critical 1 fix established.

**`PAYMENT_WINDOW_SECONDS = 120`.** Deliberately more generous than the 30s
accept window because checkout involves leaving the app — a UPI flow means an
app switch, authentication and a PIN. This is the number in the whole design
most likely to need tuning against real data, and it is in direct tension with
teacher patience. It lives as a named constant in `src/lib/session.ts` for
exactly that reason.

`hasLiveSession()` extends so a teacher with an `accepted` or `paid` session
counts as busy and is not offered another request.

### 3.3 The security property

**`paid` and `active` must be unreachable by any user token.**

M2's review found the `sessions` RLS was column-blind, letting either
participant rewrite any column via PostgREST. Migration `0003` closed that with
triggers. M3 extends the same trigger: transitions into `paid` and `active`
require `auth.uid() is null` — the service role — which in practice means only
a signature-verified webhook can make them.

A student cannot mark themselves paid. A teacher cannot mint themselves a room.
This is enforced in the database, not in a code path, because a code path can
be bypassed by anyone holding the anon key and their own JWT — which is
everyone.

### 3.3.1 What the student is charged

The expected amount is derived from the session row, never from the client:

```
amountPaise = round(hourly_rate * duration_minutes / 60) * 100
```

`hourly_rate` is the snapshot taken at request time (parent spec §4), so a
teacher changing their rate mid-flight cannot alter a session already in
progress — and migration `0003`'s trigger already makes that column immutable.
For the fixed 60-minute session this is simply the hourly rate in paise:
₹500/hr → `50000`.

This computation lives in `src/lib/session.ts` as a pure, tested function, and
is the single source used by both checkout creation and the webhook's amount
verification (§3.5). They must not compute it independently, or they can
disagree.

### 3.4 The payment port

`src/lib/payments/port.ts` defines the whole provider surface M3 needs:

```
createCheckout({ sessionId, amountPaise, successUrl, cancelUrl })
  → { checkoutUrl, paymentRef }

verifyWebhook(rawBody, signature)
  → { paymentRef, sessionId, amountPaise, kind }   // throws if unsigned/invalid

refund(paymentRef, amountPaise)
  → { refundRef }
```

One adapter implements it. Adapters take an injected `fetchImpl`, matching the
existing `src/lib/daily.ts` convention, so they are unit-testable.

Future additions slot in without touching callers: `authorize`/`capture` for
the card-only optimisation of decision 4, `savePaymentMethod` if repeat usage
materialises (decision 3).

### 3.5 The webhook is the security boundary

Because `paid` is service-role-only and the webhook is the only thing holding
the service role, **the signature check is the entire wall between a stranger
and free tutoring.** Three requirements, each of which is a known footgun:

- **Raw bytes.** Signature verification requires `await req.text()`, never
  `req.json()` — Next parses and re-serialises, and the signature stops
  matching.
- **Amount verification.** The webhook confirms the amount charged equals the
  amount expected. Without it a tampered checkout pays ₹1 for a ₹500 session.
- **Idempotency.** Webhooks arrive more than once, guaranteed. The
  `.eq("status", "accepted")` guard makes a second delivery a no-op, and the
  handler still returns 200 — a non-200 makes the provider retry indefinitely.

Room minting inside the webhook is safe to retry because `createSessionRoom` is
already idempotent (a duplicate room name returns the existing room), a
property added during M2's review.

### 3.6 The browser's return is not evidence

The student returns from checkout to `/waiting/{id}`, which watches the row
over realtime and moves them when it reads `active`. The return itself proves
nothing about payment.

**Two independent paths reach the same idempotent transition:** the webhook
(primary) and a server-side verify triggered by the return URL (fallback). A
provider webhook outage must not strand a payment.

---

## 4. Data model

Added to `public.sessions`:

| Column | Type | Notes |
|---|---|---|
| `payment_deadline` | `timestamptz` | Set on accept, immutable after. |
| `payment_ref` | `text` | Provider's identifier for the charge. |
| `payment_provider` | `text` | Which adapter produced it. |
| `amount_paid_paise` | `integer` | What was **actually charged**, smallest unit. Never recomputed from the rate. |
| `refund_ref` | `text` | Provider's identifier for a refund, when one was issued. |

**Refund is recorded as an attribute, not only as a status**, because the two
carry different information and both matter:

- **`refunded` (status)** means *a session was paid for and could not be
  delivered* — the room failed to mint. The session's whole story is the refund.
- **`refund_ref` (column)** records that money went back, on a row whose status
  already describes what happened. The late-payment case needs this: a success
  webhook arriving after `payment_expired` gets auto-refunded, and the row
  **stays `payment_expired`** — that is genuinely what happened to the session —
  while `refund_ref` and `amount_paid_paise` record that money moved and came
  back. Flipping it to `refunded` would erase the fact that the student never
  paid in time.

Invariant 2 (§6) is therefore checkable as: every row with a non-null
`amount_paid_paise` either reached `active`, or carries a `refund_ref`.

**Two divergences from the parent spec, both verified against the live schema:**

- Parent spec §7 names a `paid` status, but migration `0002`'s CHECK is
  `('pending','accepted','active','completed','declined','timed_out','cancelled')`
  — there is no `paid`. M3's migration adds it, plus `payment_expired` and
  `refunded`.
- Parent spec §7 names `stripe_payment_id`. That column does not exist, and is
  replaced here by the provider-agnostic `payment_ref` / `payment_provider`
  pair, per decision 2.

The migration and the `enforce_session_update` trigger **must move in
lockstep** — the trigger is the enforcement point for the transition table, and
every new transition needs an explicit rule about who may make it. A migration
that adds a status without a matching trigger rule silently widens what a user
token can write.

---

## 5. Screens

Every screen below is rebuilt by the redesign. Build them minimally, in the
current visual language (decision 5).

### 5.1 The student's waiting screen absorbs payment — no new route

`/waiting/[sessionId]` becomes state-driven over the row it already subscribes
to:

| Row status | What the student sees |
|---|---|
| `pending` | "Asking {teacher}…" — 30s countdown, Cancel *(unchanged)* |
| `accepted` | "{teacher} accepted — pay ₹{amount} to start" — payment countdown, Pay button |
| `paid` | "Payment received, opening your room…" |
| `active` | realtime pushes them to `/call/{id}` *(already built)* |

Both `successUrl` and `cancelUrl` return to `/waiting/{id}`. A cancelled
checkout leaves the session `accepted`, so the student can retry inside the
window rather than hitting a dead end.

### 5.2 The teacher's prompt gains a waiting state

`IncomingRequest` currently goes Accept → straight into the call. Now Accept
turns the prompt into "Waiting for {student} to pay — {n}s", reusing the same
countdown. The existing UPDATE subscription carries the teacher to `/call/{id}`
when the row reaches `active`. On expiry the prompt clears and the teacher is
available again.

### 5.3 Existing code that changes

- **`acceptSession` stops minting rooms and stops redirecting.** It sets
  `accepted` + `payment_deadline` and returns. Room minting moves into the
  webhook path.
- **`/call/[sessionId]`'s guard is already correct** — it requires `active`
  plus a `daily_room_url`, which is exactly right under the new flow. No change.
- **`session-history.tsx` earnings switch to `amount_paid_paise`.** Today it
  computes `rate × duration / 60`. Once real money moves, a teacher's "earned"
  figure must be money actually collected, and refunded sessions must drop out.

---

## 6. Money-correctness invariants

Written as checkable properties, not prose. A reconciliation script asserts
them.

1. No session is `active` without a confirmed payment.
2. No payment is held without either an `active` session or a refund — i.e.
   every row with a non-null `amount_paid_paise` either reached `active` or
   carries a `refund_ref`.
3. **`paid` is never a terminal state** — every `paid` row becomes `active` or
   `refunded`.
4. Earnings = sum of `amount_paid_paise` over sessions that reached `completed`
   and were not refunded.

Invariant 3 is directly assertable and catches most violations of the others.

---

## 7. Error handling

| What goes wrong | Rule |
|---|---|
| Student pays, webhook never arrives | Webhook is primary; the return from checkout also triggers a server-side verify against the provider. Two paths, one idempotent transition. |
| Payment succeeds, room minting fails | Retry once (minting is idempotent), then **refund and set `refunded`**. Tell the student they were not charged for a lesson they did not get. |
| Success webhook arrives after the window expired | **Auto-refund**, recording `refund_ref`; the row stays `payment_expired` (§4). Never keep the money; never resurrect a session whose teacher has moved on. |
| Duplicate webhook | No-op via the status guard. Still return 200. |
| Student pays twice | Reuse the existing `payment_ref` rather than minting a second checkout. A second success against an already-`paid` session auto-refunds. |
| Amount mismatch | Refund; do not activate. |
| Refund itself fails | Log loudly with the `payment_ref`. **No automatic recovery exists** — see §9. |

Both swallowed-catch mistakes from M2 apply here: every catch logs its real
cause server-side before returning a user-facing sentence.

---

## 8. Testing

Shaped by what M2 actually taught: **mocks lied twice.** `daily.test.ts`
asserted the wrong payload shape and passed a full code review; a realtime
channel acked `SUBSCRIBED` and delivered nothing. The strategy separates what a
mock can prove from what it cannot.

**Pure, unit-tested, living in `src/lib/session.ts` beside M2's helpers** —
extracting this logic is what caught M2's Critical 1:
- `effectiveStatus` with `payment_deadline`.
- `hasLiveSession` extended to count `accepted` and `paid` as busy.
- `expiredAcceptedIds` — the settle-on-read twin of `expiredActiveIds`.
- **Amount computation in paise.** ₹500/hr × 60min = 50000 paise. Rounding gets
  its own tests; this is money.

**What a mock must not be trusted for.** Adapter tests document the payload
shape; they are *not* evidence the provider accepts it. Evidence is a live call
in the provider's test mode. Signature verification is checked against a
genuinely signed payload from the provider's tooling, never a hand-rolled
fixture.

**Live probes, extending M2's** (the scripts exist and the pattern worked):
- `probe-session-rls.mjs` **gains the M3 security assertion**: can a student
  PATCH themselves to `paid`? Can a teacher? Both must be refused by the
  trigger. This is the single most important test in the milestone.
- `probe-happy-path.mjs` is **extended, not replaced** — it is the regression
  guard proving the trigger still permits every legitimate write, and the
  trigger is changing.
- `probe-payment-flow.mjs` (new): drive a session `pending → accepted →
  checkout → test payment → webhook → active`, asserting the row at each step.
- The reconciliation script doubles as a test.

**The manual gate stays.** Two browsers, provider test cards, and the failure
paths — cancelled checkout, expired window, late payment — then reconciliation.
M2 proved this step is not optional, and this time it is money.

Baseline to beat: 57 tests green, `tsc --noEmit` clean, eslint clean.

---

## 9. Known gaps, accepted deliberately

- **No admin surface.** Admin does not exist and is deferred until after the
  redesign (`profiles.role` permits only `student` and `teacher`). A failed
  refund therefore has no in-product recovery path: it is logs plus the
  reconciliation script until admin ships. Stated here rather than discovered
  later.
- **The teacher no-show is not solved.** Teacher accepts, student pays, room
  opens, teacher never joins; the row auto-completes at 60 minutes and counts
  toward earnings for a lesson that did not happen. This is the refund policy
  the parent spec §12 already flags as a launch blocker — *"Stripe's refund API
  is easy; the policy is the work."* **M3 makes the data support that decision
  and does not invent a policy in code.**
- **Payouts stay manual.** Stripe Connect remains deferred (parent spec §13, a
  2–4 week project). The teacher dashboard's "Payouts are made manually while
  payments are being set up" note stays true.

---

## 10. Explicitly out of scope for M3

Receipts · invoices · student payment history · refunds initiated by a user ·
partial refunds · discounts, coupons or promotions · Stripe Connect and
marketplace payouts · stored payment methods · prepaid balance · the request
tier (M4) · the scheduled tier.

---

## 11. Deviation from the locked stack

`CLAUDE.md` locks the stack and requires consulting the parent spec before
changing it. Decision 2 changes "Stripe Checkout" to "a payment port with one
adapter, provider chosen at implementation time." Recorded here as the
consultation.

Nothing about this precludes Stripe — it may well be the adapter. What it
avoids is designing the flow around one provider's redirect model before
confirming that provider can take domestic INR and UPI for this business, in a
market where UPI dominates.

**Prerequisite before implementation:** no payment package is installed and no
payment keys exist in `.env.local` or in Vercel (verified 2026-08-26 — only
`DAILY_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`). A provider account, API keys and a webhook
signing secret are needed before any of this runs.

---

## 12. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Teacher patience during the 120s window | The product's pitch is "instant"; a ghosted teacher is a churned teacher | Short window, visible countdown, immediate release on expiry. Tune `PAYMENT_WINDOW_SECONDS` from real data. |
| Provider webhook unreliability | A stranded payment is the worst possible bug | Dual path (§3.6); reconciliation script |
| Trigger and migration drifting apart | A status added without a trigger rule silently widens what a user token can write | They ship in the same migration; `probe-session-rls.mjs` asserts it |
| Mock-based tests certifying a wrong API shape | Happened in M2 and reached a browser | §8 — mocks document, live calls prove |
| Refund failure with no admin surface | Money stuck, no in-product recovery | Accepted gap (§9); loud logs + reconciliation |

---

## 13. Spike → production hardening (M3 debts to close)

- **The development stub and `/dev/checkout` must not reach production.** The
  stub holds the only capability that can mark a session paid, and the dev
  checkout page can drive it. Four independent refusals stand in the way
  (`stubPort` itself, `getPaymentPort`, the page, the action), and the page
  additionally bakes to a static 404 at build time. **Close in Task 12/13:**
  delete both once a real adapter exists, and confirm `/dev/checkout` returns
  404 in production. Until then, `PAYMENT_PROVIDER` must never be `stub` — or
  unset — in any deployed environment.
