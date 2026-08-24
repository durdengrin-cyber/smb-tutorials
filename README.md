# SMB Tutorials

A serverless marketplace connecting **students** with **teachers** for **instant, on-demand 1:1 tutoring** over **peer-to-peer video** — built for the Indian K-12 market (CBSE / State Board / ICSE). *One Student, One Teacher.*

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

## Product model — three tiers

1. **Instant pick (primary)** — pick subject → see teachers online *now* → choose one → they accept → pay → live video call.
2. **Request (fallback)** — want a specific offline teacher? Send a request; they accept later.
3. **Scheduled (add-on, later)** — book a specific teacher for a future time.

## Docs

- Design spec: [`docs/superpowers/specs/2026-08-24-smb-tutorials-design.md`](docs/superpowers/specs/2026-08-24-smb-tutorials-design.md)
- M0 implementation plan: [`docs/superpowers/plans/2026-08-24-m0-skeleton-video-spike.md`](docs/superpowers/plans/2026-08-24-m0-skeleton-video-spike.md)
- Current state / where we are: [`project_state.md`](project_state.md)
