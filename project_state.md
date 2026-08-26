# SMB Tutorials — Project State

## ▶ Resume here (next session)
1. `cd ~/smb-tutorials` (this is a standalone repo, separate from HL-Trader — do not confuse the two).
2. Read this file + the spec (`docs/superpowers/specs/2026-08-24-smb-tutorials-design.md`) + `CLAUDE.md`.
3. **M2 is code-complete on branch `m2-presence-instant-pick` and NOT yet merged.** Confirm with `git branch --show-current`.
4. **Next action: the two-browser end-to-end run (plan Task 12 Step 2), then push.** Everything else in M2 is done and verified. The loop has never been walked in a real browser — automated checks, route status codes and direct-to-Postgres probes all pass, but that is not the same thing.
   - Test accounts, both in the live DB: teacher `tutor-check@smbtutorials.in` / see the password in the SDD ledger (gitignored, not stored here) — "Dr. Rao", CBSE 11th/12th Physics+Chemistry, ₹500/hr. Student = your own account, "Tyler".
   - **Presence = an open tab.** A teacher is "online" only while `/dashboard` is open with **Available now** toggled on, in a visible (not backgrounded) window. With no teacher tab open, `/teachers` correctly shows "No teachers online" — that is the design, not a bug.
   - You need two browser *profiles* (e.g. normal + incognito), because Supabase auth cookies are per-profile.
5. Then plan Task 12 Steps 5–6: `git fetch origin main && git rebase origin/main`, push, and re-run the loop against production.
6. **Still pending, manual (none block M2):**
   - **Google provider not enabled** in Supabase (verified: only `email` in `/auth/v1/settings`). The Google button shows an inline error until a Google Cloud OAuth client is created and pasted in. Email auth is unaffected. Also add `https://smb-tutorials.vercel.app/auth/callback` to Supabase → Authentication → URL Configuration → Redirect URLs.
   - *(Email confirmation is deliberately OFF — `mailer_autoconfirm: true`. Revisit with Resend in M4.)*
7. **Test data in the live DB:** teacher "Dr. Rao" (`tutor-check@smbtutorials.in`) and student "Tyler". **Delete Dr. Rao before launch.** `sessions` is empty — every probe cleaned up after itself.

## Now
**🌐 Production is live: https://smb-tutorials.vercel.app** — that is still M1. M2 is not deployed.

**M0 complete** — Daily plumbing proven. *(The spike itself was deleted in M2 Task 11; see spec §15.)*

**M1 complete (all 12 tasks)** — auth, profiles, taxonomy, tutor onboarding, `/find` → `/teachers` browse. Deployed and verified in production.

**M2 code-complete, unmerged (all 12 tasks, branch `m2-presence-instant-pick`)** — 57 tests green, `tsc --noEmit` exit 0, eslint clean, production build clean.
- **The loop:** `/teachers` lists only teachers who are online *right now* (eligible ∩ presence) → **Start now →** → `/waiting/{id}` with a 30s countdown → teacher's dashboard shows an Accept/Decline prompt → Accept mints a **private** Daily room server-side and drops both into `/call/{id}` for a fixed 60 minutes → leaving (or the countdown) completes the session and it appears in the teacher's history with earnings.
- **Migrations applied to the live project:** `0002_sessions.sql` (table, RLS, realtime publication), `0003_session_integrity.sql`, `0004_session_student_name.sql`. All three verified against the live DB, both that they block what they should and that they permit every write the app makes.
- **Spec §15 is closed.** Rooms are minted only inside `acceptSession`, are private, carry an `exp` tied to the session length, and each party joins with its own meeting token. `/call` (spike) and `/api/rooms` are deleted.
- **A whole-branch code review was run and every Critical and Important finding fixed** (2 Critical, 8 Important). The two Criticals were: a teacher whose browser closed mid-call was locked out of the product permanently, and the `sessions` RLS was column-blind so either participant could rewrite `hourly_rate`, jump `pending → completed`, or forge an `active` row that could never expire. Both are closed by the read-time settling in `acceptSession` plus the `0003`/`0004` triggers, and both were probed against the live DB before and after.
- **Not yet done:** the two-browser run, and the push.

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
M0 skeleton + video spike ✅ → M1 auth + profiles + taxonomy + tutor onboarding ✅ → **M2 presence + instant pick + accept/timeout + Daily room — code-complete, awaiting the two-browser run + push** → M3 Stripe Checkout → M4 request fallback.

## Deferred (not MVP)
Scheduled tier (Cal.com later) · Stripe Connect · search/ranking · chat.

## Open before real launch
No-show/refund policy · trust & safety (minors) escalation path · delete test teacher · rewrite `/terms`.

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
