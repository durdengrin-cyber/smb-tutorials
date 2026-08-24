# SMB Tutorials — Project State

## Now
Design spec written + committed, awaiting final user sign-off. Next step: run the **writing-plans** skill to produce an implementation plan for **milestone M0** (deploy skeleton + two-browser Daily.co video spike).

## Source of truth
- Spec: `docs/superpowers/specs/2026-08-24-smb-tutorials-design.md` — all stack + scope decisions live here.

## Decided
- Stack: Next.js (App Router) on Vercel · Supabase (Postgres + Auth + realtime) · Daily.co (video) · Stripe Checkout · Resend · Tailwind + shadcn/ui.
- Serverless, GitHub → Vercel push-to-deploy. No server to run.
- Auth = Supabase Auth (not Clerk) — swap is cheap if revisited.
- MVP loop: find teacher → book → pay → join video call.

## Build order
M0 skeleton + video spike → M1 auth + profiles → M2 booking + room → M3 Stripe Checkout.

## Deferred (not MVP)
Stripe Connect · real scheduling (Cal.com later) · search/matching · chat.

## Open before real launch
No-show/refund policy · trust & safety (minors) escalation path.
