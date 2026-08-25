# SMB Tutorials — Project State

## ▶ Resume here (next session)
1. `cd ~/smb-tutorials` (this is a standalone repo, separate from HL-Trader — do not confuse the two).
2. Read this file + the spec (`docs/superpowers/specs/2026-08-24-smb-tutorials-design.md`) + `CLAUDE.md`.
3. Confirm `git branch --show-current` = `main`; `git pull origin main`.
4. **M1 code is complete — Tasks 1–11 of the plan are done and committed** (`docs/superpowers/plans/2026-08-25-m1-auth-taxonomy-onboarding.md`). Only Task 12 (deploy) is open.
5. **Next action — Task 12, needs a human:**
   - **Browser click-through** (the one thing not automatable here): student signup → sign out → sign in; tutor signup via the real form; `/find` → `/teachers`; `/call` while signed in.
   - **Push + verify production.** `git fetch origin main` → rebase → `git push origin main`. Then on the prod URL: signup/signin work, `/teachers` lists the tutor, anonymous `POST /api/rooms` → 401.
   - Before Google works in prod, add `https://<prod-domain>/auth/callback` to Supabase → Authentication → URL Configuration → Redirect URLs.
6. **Still pending, manual:**
   - **Google provider not enabled** in Supabase (verified: only `email` in `/auth/v1/settings`). The Google button shows an inline error until the Google Cloud OAuth client is created and pasted in. Email auth is unaffected. *(Email confirmation is correctly OFF — `mailer_autoconfirm: true`.)*
   - Supabase env vars **are** in Vercel; `DAILY_API_KEY` may still be Production-only — extend to Preview or preview deploys 500 on `/call`.
7. Commits are local and **unpushed** — push to `main` deploys production.
8. **Test data in the live DB:** one teacher `tutor-check@smbtutorials.in` ("Dr. Rao", CBSE 11th/12th Physics+Chemistry, ₹500/hr), created to verify browse. **Delete before launch.**
9. **Known M1 limitations** (carry into M2 planning): Google OAuth always creates a `student` (no role picker post-OAuth) · email confirmation is off, so signups aren't email-verified — revisit with Resend in M4 · "Book Now", "Request a Teacher" and "Request a Custom Subject" render disabled pending M2/M4 · `/api/rooms` is auth-gated but still client-triggered with a client-supplied room name (spec §15 full close is M2).

## Now
**M0 complete & verified** — Next.js on Vercel (push-to-deploy), `/api/rooms` (Daily rooms, self-expiring), `/call` spike: two-browser video + screen-share confirmed live.

**M1 code complete — Tasks 1–11 of 12 done**; 19 tests green, `tsc --noEmit` clean, production build clean, all 8 routes 200 with every internal link resolving and zero runtime errors. Task 12 (browser click-through + deploy) is the remainder.
- Taxonomy (`src/lib/taxonomy.ts`) + form validation (`src/lib/validation.ts`), TDD.
- Schema applied to the live Supabase project (`supabase/migrations/0001_*.sql`) and **verified against it**: CHECK constraints reject invalid taxonomy, FK enforced, anon read allowed / write refused (401), and `handle_new_user` maps signup metadata to a profile row (tested by creating and deleting a throwaway user).
- Supabase clients + `src/proxy.ts` session refresh; auth actions (`src/app/auth/actions.ts`), OAuth callback, `SiteHeader`.
- `/signin` + `/signup` render and are wired to Supabase auth.
- `/tutor-signup` — one form creating account + teacher profile + `teacher_subjects` (structured picker). Data path verified live end-to-end, including RLS refusing a cross-user subject write (42501).
- `/find` (taxonomy selection, no date/time) → `/teachers` (live query, taxonomy-validated filters, honest empty state). Verified against real data: match, no-match, wrong-grade, and junk-param cases.

- `/` demo home rebuilt with an auth-aware header (Sign In ↔ "Hi, {name}" + Sign Out); `/terms` transcribed.
- `/api/rooms` now rejects anonymous callers (401, verified) — spec §15 annotated with what M2 still owes.

Remaining: Task 12 — browser click-through + push/verify production.

**Terms-page caveat:** the demo's policy text is transcribed as-is and **contradicts the spec in places** — it describes a messaging system (chat is deferred), package/bundle purchases, ratings, and a scheduled-session model. Spec §12 already lists no-show/refund policy as open before launch; rewrite this page then rather than treating it as settled policy.

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
