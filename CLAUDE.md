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

## Database migrations — use the CLI, never paste
- **`supabase db push`** applies migrations. The project is linked and
  `supabase_migrations.schema_migrations` is the source of truth for what is live. Hand-pasting
  into the SQL editor is retired — it is what let `0013` silently roll back and left the ledger
  blank for 19 migrations.
- **Migration files carry NO `begin;`/`commit;`.** `db push` wraps each file in its own
  transaction; an explicit `commit;` inside would end it early and run the rest unprotected.
- **`supabase/migrations-deferred/`** holds migrations that are deliberately NOT applied.
  `db push` applies everything in `supabase/migrations/` that the ledger does not list, so a
  deferred file left there goes live by accident. Move it there; never mark it applied in the
  ledger, which would hide a real schema difference. See that directory's README.
- `supabase db query --linked "<sql>"` runs read-only checks against production.
- **Known snag:** the CLI cannot parse the local dotenv file, so run it from a scratch copy:
  `cd "$(mktemp -d)" && cp -R <repo>/supabase . && supabase db push`.

## Build & Deploy
- GitHub → Vercel auto-deploy: push to `main` = production, PRs = preview.
- Sync before every push: `git fetch origin main` then rebase onto it — never push on a stale base.
- Secrets live in Vercel env vars and `.env.local` (gitignored) — never commit keys.

## Fix quality — airtight, never makeshift
- Every fix must strengthen core infrastructure, not paper over a symptom. State, unprompted, whether a change is a root-cause fix or a spike/temporary shortcut.
- Distinguish **spike code** (deliberately throwaway — proves plumbing, gets replaced) from **core infrastructure** (reused in service). Harden core; don't gold-plate throwaways.
- Any shortcut that would cause a functional, security, or cost problem *in service* is not left silent: it is recorded in the spec's "Spike → production hardening" section and closed properly in its milestone — never band-aided.

## Scope discipline
- Product = 3 tiers: instant pick (primary) → request offline teacher (fallback) → scheduled (add-on later). Core loop: pick subject → online-now list → pick → teacher accepts → pay → video call.
- Deferred, do not build without a decision: scheduled tier, Stripe Connect, search/ranking, chat.
- Pre-launch policy items still open: no-show/refund policy, trust & safety (minors) escalation path.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
