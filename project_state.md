# SMB Tutorials — Project State

## ▶ Resume here (next session)
1. `cd ~/smb-tutorials` (this is a standalone repo, separate from HL-Trader — do not confuse the two).
2. Read this file + the spec (`docs/superpowers/specs/2026-08-24-smb-tutorials-design.md`) + `CLAUDE.md`.
3. Confirm `git branch --show-current` = `main`; `git pull origin main`.
4. **M1 is complete, deployed and verified in production.** Plan: `docs/superpowers/plans/2026-08-25-m1-auth-taxonomy-onboarding.md` (all 12 tasks done).
5. **Next action: write the M2 implementation plan** (superpowers writing-plans) from the M2 design spec `docs/superpowers/specs/2026-08-25-m2-presence-instant-pick-design.md`. The design is already brainstormed and user-approved — do not re-litigate it.
6. **Still pending, manual (none block M2 work):**
   - **Google provider not enabled** in Supabase (verified: only `email` in `/auth/v1/settings`). The Google button shows an inline error until a Google Cloud OAuth client is created and pasted in. Email auth is unaffected. Also add `https://smb-tutorials.vercel.app/auth/callback` to Supabase → Authentication → URL Configuration → Redirect URLs.
   - *(Email confirmation is deliberately OFF — `mailer_autoconfirm: true`. Revisit with Resend in M4.)*
7. **Test data in the live DB:** one teacher `tutor-check@smbtutorials.in` ("Dr. Rao", CBSE 11th/12th Physics+Chemistry, ₹500/hr), created to verify browse. **Delete before launch.**
8. **Known M1 limitations** (carry into M2): Google OAuth always creates a `student` (no post-OAuth role picker) · signups aren't email-verified · "Book Now", "Request a Teacher" and "Request a Custom Subject" render disabled pending M2/M4 · `/api/rooms` is auth-gated but still client-triggered with a client-supplied room name (spec §15 full close is M2).

## Now
**🌐 Production is live: https://smb-tutorials.vercel.app** — verified against the deployed site: all 7 pages 200, `/teachers` returns live Supabase data, anonymous `POST /api/rooms` → 401.

**M0 complete** — `/api/rooms` (Daily rooms, self-expiring) and the `/call` spike (two-browser video + screen share). *Correction: M0's "verified live" meant locally. Production was serving 404s from M0 until 2026-08-25 — see the Vercel gotcha below.*

**M1 complete (all 12 tasks)** — 19 tests green, `tsc --noEmit` clean, production build clean.
- Taxonomy (`src/lib/taxonomy.ts`) + form validation (`src/lib/validation.ts`), TDD.
- Schema applied to the live Supabase project (`supabase/migrations/0001_*.sql`) and **verified against it**: CHECK constraints reject invalid taxonomy, FK enforced, anon read allowed / write refused, and `handle_new_user` maps signup metadata to a profile row.
- Supabase clients + `src/proxy.ts` session refresh; auth actions, OAuth callback, `SiteHeader`.
- `/signin` + `/signup` wired to Supabase auth (user confirmed signup→signin in a browser).
- `/tutor-signup` — one form creating account + teacher profile + `teacher_subjects` (structured picker). Verified live end-to-end, including RLS refusing a cross-user subject write (42501).
- `/find` → `/teachers` (live query, taxonomy-validated filters, honest empty state).
- `/` demo home rebuilt with auth-aware header; `/terms` transcribed.
- `/api/rooms` rejects anonymous callers (401) — spec §15 annotated with what M2 still owes.

**M2 design approved** (see `docs/superpowers/specs/2026-08-25-m2-presence-instant-pick-design.md`): open tab = online · fixed 60-minute sessions · dashboard = toggle + incoming request + history + pending-payout earnings · in-call = context bar + countdown, auto-end at 60.

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
M0 skeleton + video spike ✅ → M1 auth + profiles + taxonomy + tutor onboarding ✅ → **M2 presence + instant pick + accept/timeout + Daily room ← next** → M3 Stripe Checkout → M4 request fallback.

## Deferred (not MVP)
Scheduled tier (Cal.com later) · Stripe Connect · search/ranking · chat.

## Open before real launch
No-show/refund policy · trust & safety (minors) escalation path · delete test teacher · rewrite `/terms`.

## Environment / facts (for a cold session)
- **Repo:** `~/smb-tutorials`, git remote `origin` = GitHub `durdengrin-cyber/smb-tutorials` (private), branch `main`. Per-repo credential isolation set (`credential.useHttpPath true`) so its scoped token never touches HL-Trader's.
- **Vercel:** project `smb-tutorials` under team `durdengrin-6266s-projects`, auto-deploys `main`. Production URL **https://smb-tutorials.vercel.app**. All four env vars (`DAILY_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) set for Production + Preview + Development.
- **⚠ Vercel gotcha that cost a session:** the project had **no Framework Preset** (set to "Other"), so `npm run build` succeeded and the deployment showed **Ready** while Vercel applied no Next.js routing — every path, including `/_next/static/*`, returned a platform `x-vercel-error: NOT_FOUND`. Deployment Protection (Vercel Authentication) masked it behind an SSO redirect from M0 until 2026-08-25. Fixed by committing `vercel.json` with `{"framework": "nextjs"}` so the setting is version-controlled. **"Deployment Ready" ≠ "site works" — always curl the real URL.**
- **Local secrets:** `.env.local` (gitignored) holds the Daily + Supabase keys. Daily domain = `smbtutorials` (rooms at `smbtutorials.daily.co/...`). Daily billing/payment method added.
- **Demo (UI/UX blueprint, read-only):** `~/Downloads/SMB-Tutorial-main` — a CRA single-file `src/App.js` (~2,387 lines), no backend. We rebuild it in Next.js; do NOT extend it.
- **Stack live:** Next.js 16 + React 19, Tailwind v4, Vitest (19 tests), `@supabase/supabase-js` + `@supabase/ssr`. Scripts: `npm run dev|build|test`.
- **App routes:** `/` home · `/signin` · `/signup` · `/tutor-signup` · `/find` · `/teachers` · `/terms` · `/call` (M0 spike, throwaway) · `/api/rooms` (auth-gated) · `/auth/callback`.
- **Next.js 16 gotchas:** `middleware.ts` is deprecated → `src/proxy.ts` exporting `proxy()`. `searchParams` is a Promise. A `"use server"` file may only export async functions. Supabase's `.select()` string must be a single literal or type inference collapses to `GenericStringError`. Read `node_modules/next/dist/docs/` before writing app code.
- **`next-env.d.ts` churn:** Next rewrites it to `.next/dev/types/...` after `next dev` and `.next/types/...` after `next build`, so it shows as modified after running dev. Discard it (`git checkout next-env.d.ts`); it is not a real edit.
