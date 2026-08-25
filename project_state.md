# SMB Tutorials — Project State

## ▶ Resume here (next session)
1. `cd ~/smb-tutorials` (this is a standalone repo, separate from HL-Trader — do not confuse the two).
2. Read this file + the spec (`docs/superpowers/specs/2026-08-24-smb-tutorials-design.md`) + `CLAUDE.md`.
3. Confirm `git branch --show-current` = `main`; `git pull origin main`.
4. **Next action:** write the **M1 implementation plan** (superpowers writing-plans) from the spec, using the demo screens as UI reference. M0 is done — do not rebuild it.
5. Before M1 code, one manual prereq: create a **Supabase project**, put its URL + anon key + service-role key in `.env.local`, and add them to Vercel env. (The plan will spell this out.)

## Now
**M0 complete & verified** — Next.js on Vercel (push-to-deploy), `/api/rooms` (Daily rooms, self-expiring), `/call` spike: two-browser video + screen-share confirmed live. 5 tests green. Next: **M1** — Supabase auth + student/teacher roles + K-12 taxonomy seed + tutor onboarding (demo's `tutor-signup`) + teacher browse. Rebuild demo's signin/signup/tutor-signup screens faithfully.

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
- **App routes so far:** `/` (placeholder), `/call` (M0 video spike — throwaway), `/api/rooms` (Daily room create/get — spike, unauthenticated; see spec §15).
