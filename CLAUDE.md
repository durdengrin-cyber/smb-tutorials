# SMB Tutorials — Claude Code Rules

## Session Start
- **First:** read `_memory/MEMORY.md` and `project_state.md`, plus the spec `project_state.md`
  points to (`docs/superpowers/specs/`). Batch them into one tool call. State the current phase +
  next step in one line before doing anything else.
- **A SessionStart hook has already run `scripts/session-start.sh`** — it pulls the current branch
  and reports where development actually lives. **Read its output before planning anything.** If it
  says main is behind another branch, the work you are about to plan may already exist there.
- Confirm branch with `git branch --show-current` before any push.

### Two machines work on this project — assume nothing is where you expect
Learned expensively on 2026-09-09. `main` was in sync with `origin/main`, so everything looked
current. It was not: 87 commits of shipped work sat on `feat/visual-identity-tokens`, including
migration `0020`, which had **already been applied to production**. Two full plans were written and
one was executed against a base that was three weeks stale, rebuilding work that already existed.

`git pull` does not catch this — the branch you are on can be perfectly in sync while the work is
somewhere else entirely. Before planning any feature, and especially before writing a migration:

- `git fetch --all` then check every remote branch against `main`, not just your own.
- Run `scripts/sync-check.sh` if you did not see the hook's output. It answers both questions:
  which branch development is really on, and whether the migration ledger agrees with the repo.
- **A migration applied in production but missing from your branch means you are on the wrong
  base.** Do not write SQL against objects you cannot see the definition of — `0021` was nearly
  built from `0010`'s copy of `available_teachers`, which would have deleted the suspension
  filter added by `0020` and put suspended teachers back in front of children.

## Shared memory — `_memory/` is version-controlled, and that is the point
- **`_memory/` at the repo root is the single source of truth for what Claude remembers here.**
  All memory writes go there — never to a machine-local `~/.claude/` path.
- **On a new machine, run `bash scripts/setup-memory.sh` once.** It symlinks
  `~/.claude/projects/<key>/memory/` to the repo's `_memory/`, so Claude Code's ordinary auto-load
  and auto-write transparently hit files that git tracks. Existing machine-local memories are
  copied in and the old directory is backed up, never deleted.
- **Commit and push `_memory/` at the end of a session, and before any `/compact`.** That push is
  the only thing that gets a fact to the other machine.
- On a merge conflict inside `_memory/`, keep the more recent fact.

The mechanism is borrowed from `HL-Trader-Private`, which has run it across two machines; its
`CLAUDE.md` "Shared Memory Protocol" is the original.

## Project
- Serverless student↔teacher 1:1 tutoring over peer-to-peer video.
- Full design + decisions: `docs/superpowers/specs/2026-08-24-smb-tutorials-design.md` (source of truth).

### The name — do not "improve" it
**SMB stands for Syedna Mohammed Burhanuddin.** The project is named in his honour; he is
remembered for his emphasis on education. **The name is not up for renaming, ever, and it is not
an acronym to be optimised.** Read cold it looks like the enterprise abbreviation for "small and
medium business" — it is not, and an agent that suggests renaming on that basis has made a real
mistake (one already made in this project on 2026-09-05).

Everything *around* the name — the visual identity, the word that follows "SMB", the colours,
the positioning — is open. The name itself is settled.

**Still to settle:** the project currently spells itself five ways — `SMB Tutorial`,
`SMB Tutorials`, `smb-tutorials`, `smbtutorial`, `smbtutorials`. Both of the first two appear on
`/privacy` and `/terms`, which are published legal documents and should name one entity
consistently. Pick one form and apply it everywhere.

## Stack (locked — see spec before changing)
- Next.js (App Router) on Vercel · Supabase (Postgres + Auth + realtime) · Daily.co (video) · **Razorpay** (Payment Links) · Resend · Tailwind + shadcn/ui.
- **Payments are Razorpay, not Stripe.** Chosen 2026-08-27 after research and recorded in
  `docs/superpowers/specs/2026-08-26-m3-payments-design.md` — domestic INR and UPI were the
  deciding factor, not price. This line said Stripe Checkout until 2026-09-15, three weeks
  after the decision and long after the adapter shipped; there is no Stripe dependency in
  `package.json` and never has been. The one `stripe-signature` header read in the webhook
  is a deliberate deadfall so a future provider swap cannot silently read an absent header.
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
- `supabase migration list` is the fastest answer to "what is actually live?" — every row should
  show LOCAL == REMOTE. Anything in the LOCAL column with an empty REMOTE will be applied by the
  next `db push`.
- Applying DDL is blocked inside Claude Code by the permission classifier, deliberately. A human
  runs `db push`; the agent prepares, verifies, and reads.
- **Gotcha, fixed 2026-09-05 — do not reintroduce:** the CLI refused to parse the local dotenv
  file because one value (the Sentry DSN) had been pasted with a literal newline inside it,
  splitting it across two lines. Next's parser tolerated it; the CLI's did not, and the error
  named only the file, not the line. If the CLI ever reports a parse failure again, find the
  offending line with
  `grep -nvE '^[A-Z_][A-Z0-9_]*=|^#|^$' <file> | cut -d: -f1` — it prints line numbers only, no
  values.

## Build & Deploy
- GitHub → Vercel auto-deploy: push to `main` = production, PRs = preview.
- Sync before every push: `git fetch origin main` then rebase onto it — never push on a stale base.
- Secrets live in Vercel env vars and `.env.local` (gitignored) — never commit keys.

## Fix quality — airtight, never makeshift
- Every fix must strengthen core infrastructure, not paper over a symptom. State, unprompted, whether a change is a root-cause fix or a spike/temporary shortcut.
- Distinguish **spike code** (deliberately throwaway — proves plumbing, gets replaced) from **core infrastructure** (reused in service). Harden core; don't gold-plate throwaways.
- Any shortcut that would cause a functional, security, or cost problem *in service* is not left silent: it is recorded in the spec's "Spike → production hardening" section and closed properly in its milestone — never band-aided.

## Findings: verify before you build, review before you commit

Added 2026-09-06 after a false flag. A sweep read
`process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"` in the checkout return path,
reasoned correctly that an unset variable would strand every paying student on a localhost page,
called it the most serious finding of the day, and started writing the fix. The variable was set
in all three environments. `vercel env ls` — which prints names without values — would have
settled it in thirty seconds, and the owner had already tested payments end-to-end.

**1. Classify every finding before acting on it.**

- **Code-visible** — a wrong branch, a missing guard, a dead link, a rule a comment claims and no
  test enforces. Reading the code IS the evidence. Fix it.
- **Conditional** — "if X, then bad thing", where X is runtime state: an env var, a live grant,
  production data, a provider's behaviour. **Reading the code is not evidence.** The finding is a
  hypothesis until X is checked.

**2. A conditional finding names its falsifying check, and that check runs first.** Cheap checks
exist for nearly all of them and are strictly faster than building the wrong fix: `vercel env ls`
for configuration, `supabase db query --linked` for live schema and grants, `curl` for what a
deployment actually serves, `supabase migration list` for what is applied. If no cheap check
exists, ask the owner — they have run the product and often know in one sentence.

**3. Severity is what you verified, never what is possible.** "This would break X if Y" is not
"this breaks X". Escalating an unverified inference spends the owner's trust on nothing and buries
the real findings next to it.

**4. Unreviewed work is the exception, not the norm.** Work executed from a plan gets a fresh
reviewer per task. Ad-hoc sweep fixes committed straight to the branch get none — same author,
same blind spots, no second pair of eyes, and they land in the same history. Batch them and put
them through the same review bar before the branch merges.

## Agent budget — same output, less burn

Measured 2026-09-06: ~2.3M tokens across 21 agents in one day. The work was real and none of it
was repeated, but roughly a third went on review-and-rework cycles, and some of that was avoidable.
The rules below cut the waste without removing the gate that caught seven bad claims that day.

**1. Review by risk, not by habit.** Not every change earns an external reviewer.

| Tier | What | Gate |
|---|---|---|
| **A** | Migrations and DDL, auth/RLS, anything touching money, published legal copy (`/terms`, `/privacy`) | External review, most capable model. Always |
| **B** | A new user-facing surface | External review, mid model |
| **C** | Tests, comments, docs, pure refactors where pre-existing tests are the proof | **No external review.** Self-check against the constraints, and say what you checked |

Tier A is where every real defect of 2026-09-06 was found. Tier C reviews that day found comment
wording and cost ~85k each.

**2. One verification budget, not one per agent.** An implementer runs `npx vitest run` and
`npx tsc --noEmit` — fast, and between them they catch nearly everything. **The controller runs
`npx eslint .` and `npm run build` once, at the end of a batch.** Running the build inside five
agents pays for it five times to learn the same thing.

**3. Fix rounds RESUME the implementer; they never start fresh.** A resumed agent still holds the
files, the reasoning and its own choices. A fresh one re-reads all of it to make a three-line
change — on 2026-09-06 that turned a 217k build into a 135k fix for four small findings.

**4. Only Critical and Important enter a fix round.** Minors go to a list and are swept in one
batch at the end, or carried. A minor that costs more to fix than it costs to keep is not worth a
round trip.

**5. Batch same-shape work into one dispatch.** Four UI tasks in a single dispatch cost 158k on
2026-09-06; the same four as separate task-review-fix cycles would have been roughly 400k. Split
only where a reviewer could reject one piece while approving its neighbour.

**6. The implementer self-reviews before reporting.** Against the constraints it was given, in its
own context, for free — every finding it catches there is a fix round nobody pays for.

**7. Give a reviewer a scope, not a repo.** Name the files and the specific questions. An
unbounded "review this" spends most of its budget reading.

## Scope discipline
- Product = 3 tiers: instant pick (primary) → request offline teacher (fallback) → scheduled (add-on later). Core loop: pick subject → online-now list → pick → teacher accepts → pay → video call.
- Deferred, do not build without a decision: scheduled tier, marketplace payouts, search/ranking,
  chat. Payouts are manual today. The specs still call that deferred item "Stripe Connect"
  because it was written before the provider decision and no Razorpay equivalent has been
  chosen — so the mechanism is genuinely undecided, not merely unnamed.
- Pre-launch policy items still open: no-show/refund policy, trust & safety (minors) escalation path.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
