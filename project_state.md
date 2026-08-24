# SMB Tutorials — Project State

## Now
Spec revised (rev. 2) to the **three-tier instant-availability model** + Indian K-12 domain, using the CRA demo (`~/Downloads/SMB-Tutorial-main`) as UI/UX blueprint (rebuild in Next.js — demo has no backend). M0 plan already written and still valid. Next: design screens with the visual companion, then execute M0.

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
