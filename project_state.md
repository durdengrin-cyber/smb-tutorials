# SMB Tutorials — Project State

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
