# SMB Tutorials — Project State

## ▶ Resume here (next session)
1. `cd ~/smb-tutorials` (standalone repo, separate from HL-Trader — do not confuse the two).
2. Read this file + `CLAUDE.md` + the M3 spec (`docs/superpowers/specs/2026-08-26-m3-payments-design.md`).
3. **You are mid-milestone on branch `m3-payments`, 43 commits ahead of `main`, and it IS pushed** — `origin/m3-payments` @ `5d1348e`, upstream now tracked. (Earlier copies of this file said "nothing pushed"; that was already stale — the remote held the branch at `98b36ab` before this session's push fast-forwarded it.) `main` is untouched at `5f1cc24`, so **production is not affected** — pushing this branch only produces a Vercel *preview* deployment. Confirm with `git branch --show-current`. The tree is clean; 93 tests, `tsc --noEmit`, eslint and `npm run build` are all green.
4. **The full SDD ledger is at `.superpowers/sdd/2026-08-26-m3-payments/progress.md`** — every commit, all 26 rulings, every parked finding. It is gitignored, lives only on this machine, and is the authoritative record. **Read it before doing anything.** Tasks with a `Task <N>: complete` line are done; do not re-dispatch them.
5. **M3 is 11 of 13 tasks complete** (Tasks 1-11). Payments work end to end against a development stub. **Task 11's owed fix round is done** — all three review findings closed and re-verified live on 2026-08-27; see "Task 11, closed" below. What remains, in order:
   - **Task 12 — the Razorpay adapter. BLOCKED on the user** supplying test-mode keys: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `PAYMENT_WEBHOOK_SECRET`, plus `PAYMENT_PROVIDER=razorpay`. The plan's Task 12 carries the concrete call shapes.
   - **Task 13 — verify and deploy.** Needs the user's two-browser run with Razorpay test cards, then rebase onto `origin/main` and push. **Step 3b is new and is not optional:** the presence fix and the payment-window Cancel added on 2026-08-27 are client-side realtime, so nothing automated proves either — the plan spells out exactly what to click.
6. **Resume with `superpowers:subagent-driven-development`**, plan `docs/superpowers/plans/2026-08-26-m3-payments.md`.

## What M3 built, and what proves it

The loop now runs: teacher accepts → a 120-second payment window opens → student pays → a signature-verified webhook mints the room and starts the session → leaving completes it and the earnings figure reflects money actually collected.

**Migrations `0002`–`0005` are all applied to the live Supabase project.** `0005` is the security boundary: `paid`, `active` and `refunded` require `auth.uid() is null`, so only the service role — held solely by the webhook — can write them.

**Three committed probes prove it against the real database** (`scripts/`), all re-runnable with **no arguments and no standing credential** — each mints a throwaway teacher and student via the admin API, uses their real JWTs, and deletes both in a `finally` (`scripts/probe-accounts.mjs`):
- `probe-session-rls.mjs` — the ten-attack battery run **twice, once as each participant**. All twenty refused.
- `probe-happy-path.mjs` — sixteen legitimate writes across four rows plus four malformed inserts. Takes ~70s by design: it waits for a real Postgres deadline to elapse rather than mocking a clock.
- `reconcile-payments.mjs` — asserts the money invariants, exits non-zero on violation so it can gate a deploy.

Each probe also asserts that `sessions` **and** `profiles` returned to their pre-run row counts, so a leaked row or a leaked account fails the run.

**The test teacher's password needs no rotation — decided by the user, 2026-08-27. Do not raise it again.** `tutor-check@smbtutorials.in` is a pseudo account that gets deleted before launch, so rotating a credential on an account with a scheduled death is busywork. Two things had to be true first and both are: no probe reads it any more (`PROBE_TEACHER_PASSWORD` is gone as of 2026-08-27, so nothing breaks when the account goes), and it is in no committed file. Deleting the account is already tracked under "Open before real launch" below — **that** is the action, not a rotation.

### Task 11, closed (2026-08-27)

Its review had come back *changes requested* and the first fix round died on a quota limit having changed nothing. All three findings are now closed, and every claim below was re-verified by running the scripts against the live database, not by inspection:

1. **`accepted → cancelled` by the student is now proved.** It was the one legitimate M3 write the suite could not make: the trigger gates it on `uid is distinct from old.student_id` with no service-role escape, so only a real student JWT can perform it. `probe-happy-path.mjs` now drives a fourth row — student inserts with their own token → teacher accepts → checkout is stamped → **student cancels with their own token** — and it is PERMITTED.
2. **The malformed-insert probes can no longer leak a row.** They exist to catch a regression where one *stops* failing, and in that case the created row used to survive in the live table carrying forged data. The id is now captured into the cleanup list *before* the verdict is printed. **Proved by deliberately making one of them a legal insert:** the run went red as it should *and* the table returned to its original 5 rows.
3. **The attack battery now runs as the student as well as the teacher**, per spec §8, on two independently seeded rows so neither inherits the other's state. Twenty attacks, all refused.

**Beyond the three findings, deliberately:** the probes no longer depend on `PROBE_TEACHER_PASSWORD` or on any fixed account. `scripts/probe-accounts.mjs` mints a throwaway teacher and student per run (admin API, runtime-generated password never logged), and deletes both in a `finally`; a failed deletion fails the run. This is what let the fix round be verified at all in a session that had no teacher password, and it retires the standing credential the ledger flagged for rotation. A fourth malformed insert — a request arriving with payment data already on it — now covers 0005's new insert-trigger ban, which had no probe.

**Green after the round:** 83 tests · `tsc --noEmit` 0 · eslint clean · `npm run build` clean · all three probes exit 0.

### Two gaps closed after that (2026-08-27, user chose "fix both")

Both were recorded gaps, not new work, and both are **app-layer only — no migration, no DB change**, so the probes above are unaffected and were not re-run.

1. **The busy-teacher regression, fixed at the root.** Presence now follows the *commitment*, not the navigation: `IncomingRequest` reports whether the teacher is committed, the new `DashboardLive` holds that fact for the two siblings that need it, and `AvailabilityToggle` untracks — **without unsubscribing**, so the channel and the remembered intent survive and the teacher reappears on their own when the window resolves. The toggle reads three states now: Offline · In a session (amber) · Available now. Two more defects in the same code went with it — the catch-up query's `limit(1)` on `created_at desc` let a second student's newer request mask the teacher's own in-flight row (now `pickOpenRequest`, 10 unit tests), and the card collapsed `paid` into `accepted` so the countdown could clear a card whose student had already paid.
2. **`accepted → cancelled` made reachable.** `cancelSession` takes `pending` and `accepted`; Cancel sits beside Pay. It now returns `{ cancelled }` and the screen only navigates on a true — otherwise a student whose payment cleared in the same instant would be walked off the screen their room was about to open on. The other half of that race was already safe: the webhook refunds a payment landing on a row that is no longer `accepted`.

**93 tests · tsc 0 · eslint clean · build clean.** Neither fix is proven in a browser — both are client-side realtime, which is exactly what Task 13 Step 3b now exists to cover.

## Known gaps carried out of M3

- ~~**A teacher in the payment window is still visible as available.**~~ **FIXED 2026-08-27** at the root, as the spec required: presence follows the commitment, not the navigation. The toggle untracks (without unsubscribing) from `accepted` through `paid`, and reads three states — Offline · In a session · Available now. Two further defects in the same code went with it: the dashboard catch-up query no longer lets a newer pending row mask the teacher's own in-flight session (`pickOpenRequest`, unit-tested), and a `paid` card is no longer cleared by the payment-window countdown. **Not yet proven in a browser** — presence is client-side realtime, so Task 13 Step 3b carries the run. M3 spec §9.
- **Four ways a row can strand at `paid`**, each requiring our database or the provider to fail *after* money moved. All alarmed, none silent; a durable fix needs a transactional outbox M3 does not have. `reconcile-payments.mjs` is the backstop. M3 spec §9.
- ~~**`accepted → cancelled` is specified and permitted but unreachable.**~~ **FIXED 2026-08-27** (user chose to widen the action over narrowing the spec): `cancelSession` accepts `pending` and `accepted`, and the waiting screen shows Cancel beside Pay. The status filter decides the race in Postgres, and `cancelSession` now returns `{ cancelled }` so the screen never navigates a student away from a session that just got paid for. **Not yet proven in a browser** — Task 13 Step 3b runs the pay/cancel race deliberately. M3 spec §9.
- **A crossed `payment_ref` alarms rather than auto-refunding** — money sits with the provider until a human acts. Should be impossible (the column is unique and write-once), so its occurrence is itself the signal. M3 spec §9.
- **The development stub and `/dev/checkout` must not reach production.** Four independent refusals plus a build-time 404. Delete both once Razorpay is live. M3 spec §13.
- `getOrCreateRoom` in `daily.ts` still has no caller and still mints *public* rooms — the M2 trap, still open.

## Post-M3: redesign + the three dashboards (scoped 2026-08-26, deferred behind M3)

**Sequencing decision (user, 2026-08-26): ship M3 Stripe Checkout on the current UI FIRST, then do all of the below.** The trade-off was put to the user explicitly — the redesign will then have to absorb the Stripe surfaces too, and admin/payouts stays manual while real money is moving — and they chose this order anyway. Do not re-litigate it; do plan M3 knowing its UI is temporary.

**How this started:** a signed-in teacher had no way to reach `/dashboard`. Verified: `auth/actions.ts` redirects everyone to `/` after sign-in, and `/` renders only "Hi, {name}" + Sign out with no role branch.

**The real diagnosis is structural.** There is no authenticated shell anywhere. `SiteHeader` is a logo plus a per-page ad-hoc `action` prop; nothing in the app knows who is signed in or what role they are. M1 and M2 each built their own pages and the connective tissue was never built.

**Full inventory of what is missing (user, 2026-08-26 — "3 sets of different dashboards"):**

| Surface | Reality today |
|---|---|
| Teacher dashboard | EXISTS (M2): availability toggle, incoming request, subjects, history + earnings. Unreachable without typing the URL. |
| Student dashboard | **DOES NOT EXIST.** A student has `/find` -> `/teachers` -> call, then nowhere. No history, no profile, no home. |
| Admin | **DOES NOT EXIST AND CANNOT YET.** `profiles.role` is `check (role in ('student','teacher'))` — there is no admin role. Zero mention of admin in code or specs. Needs a migration, its own RLS policies, and policy decisions. |
| Shell / design system | No component layer, no nav, no role routing. |
| Polish | "Small things not given attention" — real, but only assessable once the above settles. |

**Why admin is load-bearing, not cosmetic.** Three existing launch blockers quietly require it: payouts are manual (the teacher dashboard literally renders "Payouts are made manually while payments are being set up"), the no-show/refund policy needs someone able to act on it, and the trust & safety escalation path for minors needs somewhere to escalate *to*.

**Agreed decomposition — four separate spec -> plan -> implement cycles, in this order:**
1. **IA + design system** — the shell, role-aware nav, post-login routing by role, the component layer that was never built, the visual language, and deleting the marketing copy that advertises deferred features. Everything else is built *in* this, so it must go first; doing it later means building three dashboards in the old language and redoing them.
2. **Student dashboard** — smallest new surface; closes the student's dead end after a call.
3. **Admin** — largest; gated on policy answers only the user can give; unblocks the launch items above.
4. **Polish pass** — last, against a finished system rather than a moving one.

**Scope already chosen by the user: FULL VISUAL REDESIGN** — rework the visual language across every screen (layout, typography, spacing, components), not just navigation. Chosen over "connective tissue only" and over "shell + fix the lying pages", having been told it touches pages verified working the same day.

**Findings that must survive into that work:**
- **Stack drift:** `CLAUDE.md` locks the stack as "Tailwind + shadcn/ui" but **shadcn/ui was never installed** — no `components.json`, no `src/components/ui`, only two shared components (`site-header`, `google-button`). Every button/card/input is inline Tailwind duplicated per page, inherited from the CRA demo. The redesign is *building* the component layer, not repainting one.
- **The home page lies about the product.** `/` advertises "Your Schedule — Book sessions that fit your time", the scheduled tier that is deferred. Same defect class as `/terms` (chat, packages, ratings).
- **Primary device is a product decision, not a styling one.** "Online" means a teacher has `/dashboard` open in a *visible* tab; on a phone, backgrounding the browser throttles the websocket and the teacher silently drops offline. If phones are primary for teachers, design spec §3's presence model needs rethinking. Current build is desktop-first, which is unusual for Indian K-12. **This question was asked and withdrawn for clarification — re-ask it first when this work starts.**

**Still-open questions for piece 1:** primary device per role (above) · is the SMB teal/cyan brand and "One Student, One Teacher" fixed or open · does "every screen" include the marketing surface (`/`, `/terms`, `/signup`, `/tutor-signup`) or only the product surface · is there a visual reference the user likes, or should directions be proposed.

**Process note:** classified architectural. When resumed, the brainstorming skill's architectural path applies — questions, approaches, sectioned design, written spec, then `writing-plans`. Do NOT invoke `ui-ux-pro-max` or any implementation skill during the brainstorm; the only terminal state is `writing-plans`.

## Now
**🌐 Production is live: https://smb-tutorials.vercel.app** — M2 is deployed and verified there (deployment `b7i9b32au`, 2026-08-26). Every route curl'd against the real URL, not just "Vercel says Ready": marketing pages 200, `/dashboard` `/waiting/{id}` `/call/{id}` all 307 behind the auth gate, `/call` and `/api/rooms` both 404 confirming the M0 spike is gone from the deployed build.

**M0 complete** — Daily plumbing proven. *(The spike itself was deleted in M2 Task 11; see spec §15.)*

**M1 complete (all 12 tasks)** — auth, profiles, taxonomy, tutor onboarding, `/find` → `/teachers` browse. Deployed and verified in production.

**M2 complete and deployed (all 12 tasks, merged to `main`)** — 57 tests green, `tsc --noEmit` exit 0, eslint clean, production build clean.
- **The loop:** `/teachers` lists only teachers who are online *right now* (eligible ∩ presence) → **Start now →** → `/waiting/{id}` with a 30s countdown → teacher's dashboard shows an Accept/Decline prompt → Accept mints a **private** Daily room server-side and drops both into `/call/{id}` for a fixed 60 minutes → leaving (or the countdown) completes the session and it appears in the teacher's history with earnings.
- **Migrations applied to the live project:** `0002_sessions.sql` (table, RLS, realtime publication), `0003_session_integrity.sql`, `0004_session_student_name.sql`. All three verified against the live DB, both that they block what they should and that they permit every write the app makes.
- **Spec §15 is closed.** Rooms are minted only inside `acceptSession`, are private, carry an `exp` tied to the session length, and each party joins with its own meeting token. `/call` (spike) and `/api/rooms` are deleted.
- **A whole-branch code review was run and every Critical and Important finding fixed** (2 Critical, 8 Important). The two Criticals were: a teacher whose browser closed mid-call was locked out of the product permanently, and the `sessions` RLS was column-blind so either participant could rewrite `hourly_rate`, jump `pending → completed`, or forge an `active` row that could never expire. Both are closed by the read-time settling in `acceptSession` plus the `0003`/`0004` triggers, and both were probed against the live DB before and after.
- **The two-browser run passed.** The first attempt found three bugs no automated check had caught: `postgres_changes` were silently dropped because the realtime socket joins as `anon` unless the JWT is pushed onto it *before* subscribing (`subscribe()` acks SUBSCRIBED either way); Daily's `privacy` is a top-level room field, not a room property, so no room was ever minted — and the unit test asserted the wrong shape against a mock, so it agreed with the bug; and a student sent back after a failed attempt lost their search criteria. All three fixed and re-verified against the real services.
- **Shipped.** `main` @ `790db95`. 12/12 tasks, 57 tests, migrations 0002-0004 live.
- **Known gap found immediately after shipping:** no navigation to `/dashboard` for a signed-in teacher. See "Redesign brainstorm — open" above.

**⚠ The one thing to know about presence:** a teacher is online only while their dashboard tab is open. Accepting navigates them to `/call`, which drops presence on purpose (a teacher in a session must not look startable); returning to `/dashboard` restores it from a localStorage intent flag. An empty `/teachers` list is almost always "nobody has a tab open", not a bug.

**Terms-page caveat:** the demo's policy text is transcribed as-is and **contradicts the spec** — it describes a messaging system (chat is deferred), package/bundle purchases, ratings, and a scheduled-session model. Spec §12 lists no-show/refund policy as open before launch; rewrite this page then rather than treating it as settled policy.

**Supabase project ref:** `upggvzzzoxqgourjywtd` (SQL editor: `https://supabase.com/dashboard/project/upggvzzzoxqgourjywtd/sql/new`). The public `/auth/v1/signup` endpoint **rejects `@example.com`** addresses — use a real-looking domain when testing; the admin API does not validate.

## Source of truth
- Spec: `docs/superpowers/specs/2026-08-24-smb-tutorials-design.md` — all stack + scope decisions.
- M2 design: `docs/superpowers/specs/2026-08-25-m2-presence-instant-pick-design.md`.
- **M3 design: `docs/superpowers/specs/2026-08-26-m3-payments-design.md`** — approved 2026-08-26. §11 records the deviation from the locked "Stripe Checkout" to a processor-agnostic port, and the subsequent choice of **Razorpay** with the reasoning. §9 lists every accepted gap; §13 the spike debts.
- **M3 plan: `docs/superpowers/plans/2026-08-26-m3-payments.md`** — 13 tasks. Its code blocks have been synced to the reviewed implementations, so a re-run reproduces what shipped rather than the original drafts.

## Decided
- Stack: Next.js (App Router) on Vercel · Supabase (Postgres + Auth + realtime) · Daily.co (video) · Stripe Checkout · Resend · Tailwind + shadcn/ui.
- Serverless, GitHub → Vercel push-to-deploy. No server to run.
- Auth = Supabase Auth (not Clerk) — swap is cheap if revisited.
- Presence (teacher online-now) via Supabase Realtime — instant model needs presence, not a matching engine.
- Product = 3 tiers: **instant pick** (primary) · **request offline teacher** (fallback) · **scheduled** (add-on later).
- Domain: Indian K-12 — CBSE/State Board/ICSE, grades 6–12, streams Science/Commerce/Arts.

## Build order
M0 ✅ → M1 ✅ → M2 ✅ → **M3 payments — 11 of 13 tasks done and reviewed, Razorpay chosen, blocked on test keys** → redesign: IA/design system, student dashboard, admin, polish (4 cycles) → M4 request fallback.

*Ordering note: the redesign sits after M3 by explicit decision, so M3 ships on a UI that is known to be temporary.*

## Deferred (not MVP)
Scheduled tier (Cal.com later) · Stripe Connect · search/ranking · chat.

## Open before real launch
No-show/refund policy · trust & safety (minors) escalation path · delete test teacher · rewrite `/terms`.

**Needs an admin surface before launch (see the post-M3 section):** manual payouts · no-show/refund policy · trust & safety (minors) escalation.

**Carried forward from the M2 review (logged, not blocking):** `getOrCreateRoom` in `daily.ts` survives with no caller and still creates *public* rooms — delete it or make it private-by-default before anything calls it (spec §15) · only one incoming request is displayed at a time, a second overwrites the first · `sessions.subject` has no CHECK constraint (the insert trigger blocks the forged-insert route to it) · `didNotRespond` on `/teachers` is unvalidated text (React escapes it, so content-injection not XSS).

## Environment / facts (for a cold session)
- **Repo:** `~/smb-tutorials`, git remote `origin` = GitHub `durdengrin-cyber/smb-tutorials` (private), branch `main`. Per-repo credential isolation set (`credential.useHttpPath true`) so its scoped token never touches HL-Trader's.
- **Vercel:** project `smb-tutorials` under team `durdengrin-6266s-projects`, auto-deploys `main`. Production URL **https://smb-tutorials.vercel.app**. All four env vars (`DAILY_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) set for Production + Preview + Development.
- **⚠ Vercel gotcha that cost a session:** the project had **no Framework Preset** (set to "Other"), so `npm run build` succeeded and the deployment showed **Ready** while Vercel applied no Next.js routing — every path, including `/_next/static/*`, returned a platform `x-vercel-error: NOT_FOUND`. Deployment Protection (Vercel Authentication) masked it behind an SSO redirect from M0 until 2026-08-25. Fixed by committing `vercel.json` with `{"framework": "nextjs"}` so the setting is version-controlled. **"Deployment Ready" ≠ "site works" — always curl the real URL.**
- **Local secrets:** `.env.local` (gitignored) holds the Daily + Supabase keys. Daily domain = `smbtutorials` (rooms at `smbtutorials.daily.co/...`). Daily billing/payment method added.
- **Demo (UI/UX blueprint, read-only):** `~/Downloads/SMB-Tutorial-main` — a CRA single-file `src/App.js` (~2,387 lines), no backend. We rebuild it in Next.js; do NOT extend it.
- **Stack live:** Next.js 16 + React 19, Tailwind v4, Vitest (57 tests), `@supabase/supabase-js` + `@supabase/ssr`. Scripts: `npm run dev|build|test`.
- **App routes:** `/` home · `/signin` · `/signup` · `/tutor-signup` · `/find` · `/teachers` · `/dashboard` (teacher) · `/waiting/[sessionId]` · `/call/[sessionId]` · `/terms` · `/auth/callback`. *(`/call` and `/api/rooms` were the M0 spike and are deleted.)*
- **Next.js 16 gotchas:** `middleware.ts` is deprecated → `src/proxy.ts` exporting `proxy()`. `searchParams` is a Promise. A `"use server"` file may only export async functions. Supabase's `.select()` string must be a single literal or type inference collapses to `GenericStringError`. Read `node_modules/next/dist/docs/` before writing app code.
- **`next-env.d.ts` churn:** Next rewrites it to `.next/dev/types/...` after `next dev` and `.next/types/...` after `next build`, so it shows as modified after running dev. Discard it (`git checkout next-env.d.ts`); it is not a real edit.
