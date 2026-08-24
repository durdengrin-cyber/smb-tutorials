# SMB Tutorials — Claude Code Rules

## Session Start
- **First:** read `project_state.md` and the spec it points to (`docs/superpowers/specs/`). State the current phase + next step in one line before doing anything else.
- Confirm branch with `git branch --show-current` before any push.

## Project
- Serverless student↔teacher 1:1 tutoring over peer-to-peer video.
- Full design + decisions: `docs/superpowers/specs/2026-08-24-smb-tutorials-design.md` (source of truth).

## Stack (locked — see spec before changing)
- Next.js (App Router) on Vercel · Supabase (Postgres + Auth + realtime) · Daily.co (video) · Stripe Checkout · Resend · Tailwind + shadcn/ui.
- Serverless only — no always-on server/VPS to run.

## Build & Deploy
- GitHub → Vercel auto-deploy: push to `main` = production, PRs = preview.
- Sync before every push: `git fetch origin main` then rebase onto it — never push on a stale base.
- Secrets live in Vercel env vars and `.env.local` (gitignored) — never commit keys.

## Scope discipline
- MVP loop only: find teacher → book → pay → join video call.
- Deferred, do not build without a decision: Stripe Connect, real scheduling (Cal.com later), search/matching, chat.
- Pre-launch policy items still open: no-show/refund policy, trust & safety (minors) escalation path.
