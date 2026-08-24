# SMB Tutorials

A serverless marketplace connecting **students** with **teachers** for 1:1 tutoring over **peer-to-peer video**.

## Status

🎨 **Design phase.** No app code yet — we're designing the site's pages and UX before building. Architecture and stack are decided; see the spec.

## Planned stack

- **Next.js** (App Router) on **Vercel** — GitHub push-to-deploy
- **Supabase** — Postgres + Auth + realtime
- **Daily.co** — peer-to-peer video (signaling + TURN handled)
- **Stripe Checkout** — payments (Connect later)
- **Resend** — transactional email
- **Tailwind CSS + shadcn/ui** — UI

Serverless only — no always-on server to run.

## MVP loop

Find a teacher → book a time → pay → join the video call.

## Docs

- Design spec: [`docs/superpowers/specs/2026-08-24-smb-tutorials-design.md`](docs/superpowers/specs/2026-08-24-smb-tutorials-design.md)
- M0 implementation plan: [`docs/superpowers/plans/2026-08-24-m0-skeleton-video-spike.md`](docs/superpowers/plans/2026-08-24-m0-skeleton-video-spike.md)
- Current state / where we are: [`project_state.md`](project_state.md)
