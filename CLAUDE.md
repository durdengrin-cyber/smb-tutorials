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
- Product = 3 tiers: instant pick (primary) → request offline teacher (fallback) → scheduled (add-on later). Core loop: pick subject → online-now list → pick → teacher accepts → pay → video call.
- Deferred, do not build without a decision: scheduled tier, Stripe Connect, search/ranking, chat.
- Pre-launch policy items still open: no-show/refund policy, trust & safety (minors) escalation path.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
