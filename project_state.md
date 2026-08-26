# SMB Tutorials — Project State

## ▶ Resume here (next session)
1. `cd ~/smb-tutorials` (standalone repo, separate from HL-Trader — do not confuse the two).
2. Read this file + the spec (`docs/superpowers/specs/2026-08-24-smb-tutorials-design.md`) + `CLAUDE.md`.
3. **M2 is DONE, merged to `main`, deployed and verified in production (2026-08-26).** The instant-pick loop works end to end. Nothing is half-finished in the code.
4. **Next action: M3 — Stripe Checkout.** Brainstorm it from the M3 section of the design spec, then writing-plans, then implement. Nothing about M3 has been started.
   - **The redesign work is DEFERRED behind M3 by an explicit user decision (2026-08-26).** See "Post-M3: redesign + the three dashboards" below. Do not start it, and do not treat its open questions as blocking M3.
5. **Still pending, manual (none block work):**
   - **Google provider not enabled** in Supabase (verified: only `email` in `/auth/v1/settings`). The Google button shows an inline error until a Google Cloud OAuth client is created and pasted in. Also add `https://smb-tutorials.vercel.app/auth/callback` to Supabase → Authentication → URL Configuration → Redirect URLs.
   - *(Email confirmation is deliberately OFF — `mailer_autoconfirm: true`. Revisit with Resend in M4.)*
6. **Test data in the live DB (shared by local + production):** teacher "Dr. Rao" (`tutor-check@smbtutorials.in`, password in the gitignored SDD ledger at `.superpowers/sdd/2026-08-25-m2-presence-instant-pick/progress.md`) and student "Tyler". Plus 5 test `sessions` rows from the verification run. **Delete all of it before launch.**

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

## Decided
- Stack: Next.js (App Router) on Vercel · Supabase (Postgres + Auth + realtime) · Daily.co (video) · Stripe Checkout · Resend · Tailwind + shadcn/ui.
- Serverless, GitHub → Vercel push-to-deploy. No server to run.
- Auth = Supabase Auth (not Clerk) — swap is cheap if revisited.
- Presence (teacher online-now) via Supabase Realtime — instant model needs presence, not a matching engine.
- Product = 3 tiers: **instant pick** (primary) · **request offline teacher** (fallback) · **scheduled** (add-on later).
- Domain: Indian K-12 — CBSE/State Board/ICSE, grades 6–12, streams Science/Commerce/Arts.

## Build order
M0 skeleton + video spike ✅ → M1 auth + profiles + taxonomy + tutor onboarding ✅ → M2 presence + instant pick + accept/timeout + Daily room ✅ → **M3 Stripe Checkout ← next** → redesign: IA/design system, student dashboard, admin, polish (4 cycles) → M4 request fallback.

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
