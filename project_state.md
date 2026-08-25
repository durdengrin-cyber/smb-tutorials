# SMB Tutorials — Project State

## ▶ Resume here (next session)
1. `cd ~/smb-tutorials` (this is a standalone repo, separate from HL-Trader — do not confuse the two).
2. Read this file + the spec (`docs/superpowers/specs/2026-08-24-smb-tutorials-design.md`) + `CLAUDE.md`.
3. Confirm `git branch --show-current` = `main`; `git pull origin main`.
4. **Read the M1 plan:** `docs/superpowers/plans/2026-08-25-m1-auth-taxonomy-onboarding.md`. It is written and reviewed — execute it, do not rewrite it. **Tasks 1–9 are done and committed.**
5. **Next action:** Task 10 (rebuild demo home page, auth-aware header) → Task 11 (terms page + `/api/rooms` auth gate) → Task 12 (verify + deploy).
6. **Still pending, manual:**
   - **Google provider not enabled** in Supabase (verified: only `email` in `/auth/v1/settings`). The Google button errors until the Google Cloud OAuth client is created and pasted in. Email auth is unaffected. *(Email confirmation is now correctly OFF — `mailer_autoconfirm: true`.)*
   - Supabase env vars **are** in Vercel now; `DAILY_API_KEY` may still be Production-only — extend to Preview.
7. Commits are local and **unpushed** — push when ready; push to `main` deploys production.
8. **Test data in the live DB:** one teacher `tutor-check@smbtutorials.in` ("Dr. Rao", CBSE 11th/12th Physics+Chemistry, ₹500/hr), created to verify browse. **Delete before launch.**

## Now
**M0 complete & verified** — Next.js on Vercel (push-to-deploy), `/api/rooms` (Daily rooms, self-expiring), `/call` spike: two-browser video + screen-share confirmed live.

**M1 in progress — Tasks 1–9 of 12 done**, 19 tests green, build clean.
- Taxonomy (`src/lib/taxonomy.ts`) + form validation (`src/lib/validation.ts`), TDD.
- Schema applied to the live Supabase project (`supabase/migrations/0001_*.sql`) and **verified against it**: CHECK constraints reject invalid taxonomy, FK enforced, anon read allowed / write refused (401), and `handle_new_user` maps signup metadata to a profile row (tested by creating and deleting a throwaway user).
- Supabase clients + `src/proxy.ts` session refresh; auth actions (`src/app/auth/actions.ts`), OAuth callback, `SiteHeader`.
- `/signin` + `/signup` render and are wired to Supabase auth.
- `/tutor-signup` — one form creating account + teacher profile + `teacher_subjects` (structured picker). Data path verified live end-to-end, including RLS refusing a cross-user subject write (42501).
- `/find` (taxonomy selection, no date/time) → `/teachers` (live query, taxonomy-validated filters, honest empty state). Verified against real data: match, no-match, wrong-grade, and junk-param cases.

Remaining: Task 10 home · 11 terms + `/api/rooms` auth gate · 12 verify/deploy.

**Supabase project ref:** `upggvzzzoxqgourjywtd` (SQL editor: `https://supabase.com/dashboard/project/upggvzzzoxqgourjywtd/sql/new`). Note: the public `/auth/v1/signup` endpoint **rejects `@example.com`** addresses — use a real-looking domain when testing signup; the admin API does not validate.

**Decisions locked while planning M1:** home page rebuilt in M1 · tutor signup is **one** form creating account + profile + subjects · Google OAuth included · tutor "Subjects You Teach" free text becomes a structured curriculum × grade × subject picker (free text can't drive the browse filter) · find screen drops date/time (instant-first) · teacher cards show no fake rating/availability.

**Open liability:** `/api/rooms` is public/unauthenticated & live on Vercel (spec §15) — close in M1/M2 via server-side, auth-gated room creation. In-call + teacher-dashboard screens: just-in-time design before M2.

## Source of truth
- Spec: `docs/superpowers/specs/2026-08-24-smb-tutorials-design.md` — all stack + scope decisions live here.

## Decided
- Stack: Next.js (App Router) on Vercel · Supabase (Postgres + Auth + realtime) · Daily.co (video) · Stripe Checkout · Resend · Tailwind + shadcn/ui.
- Serverless, GitHub → Vercel push-to-deploy. No server to run.
- Auth = Supabase Auth (not Clerk) — swap is cheap if revisited.
- Presence (teacher online-now) via Supabase Realtime — instant model needs presence, not a matching engine.
- Product = 3 tiers: **instant pick** (primary) · **request offline teacher** (fallback) · **scheduled** (add-on later).
- Domain: Indian K-12 — CBSE/State Board/ICSE, grades 6–12, streams Science/Commerce/Arts.

## Build order
M0 skeleton + video spike → M1 auth + profiles + taxonomy + tutor onboarding → M2 presence + instant pick + accept/timeout + Daily room → M3 Stripe Checkout → M4 request fallback.

## Deferred (not MVP)
Scheduled tier (Cal.com later) · Stripe Connect · search/ranking · chat.

## Open before real launch
No-show/refund policy · trust & safety (minors) escalation path.

## Environment / facts (for a cold session)
- **Repo:** `~/smb-tutorials`, git remote `origin` = GitHub `durdengrin-cyber/smb-tutorials` (private), branch `main`. Per-repo credential isolation set (`credential.useHttpPath true`) so its scoped token never touches HL-Trader's.
- **Vercel:** connected, auto-deploys `main`. `DAILY_API_KEY` set in Vercel env (Production).
- **Local secrets:** `.env.local` (gitignored) holds `DAILY_API_KEY`. Daily domain = `smbtutorials` (rooms at `smbtutorials.daily.co/...`). Daily billing/payment method added.
- **Demo (UI/UX blueprint, read-only):** `~/Downloads/SMB-Tutorial-main` — a CRA single-file `src/App.js` (~2,387 lines), no backend. We rebuild it in Next.js; do NOT extend it.
- **Stack live:** Next.js 16 + React 19, Tailwind v4, Vitest (5 tests). Scripts: `npm run dev|build|test`.
- **App routes so far:** `/` (placeholder — replaced by the demo home in M1 Task 10), `/call` (M0 video spike — throwaway), `/api/rooms` (Daily room create/get — spike, unauthenticated; auth gate lands in M1 Task 11, full close M2; see spec §15).
- **Next.js 16 gotcha:** `middleware.ts` is deprecated → the file is `src/proxy.ts` exporting `proxy()`. Read `node_modules/next/dist/docs/` before writing app code.
