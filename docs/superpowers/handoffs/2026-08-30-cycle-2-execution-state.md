# Cycle 2 — Durable Availability — EXECUTION IN PROGRESS

**Paused 2026-08-30 at the user's request, after Task 3's live verification and before its
task review.**

The SDD ledger lives at `.superpowers/sdd/2026-08-30-durable-availability/progress.md`, which
is **git-ignored** — cycle 1 lost its execution ledger exactly that way and had to reconstruct
it. This file is the committed copy. If the two disagree, prefer this one plus `git log`.

- **Spec:** `docs/superpowers/specs/2026-08-29-durable-availability-design.md`
- **Plan:** `docs/superpowers/plans/2026-08-30-durable-availability.md` (17 tasks)
- **Branch:** `cycle-2/durable-availability`, branched from `main` @ `af1285b`
- **Execution model:** `superpowers:subagent-driven-development` — one implementer per task,
  each independently reviewed. Brainstorm/spec/review stay in the main conversation.

---

## ▶ RESUME HERE

1. **Dispatch the Task 3 task review.** It is the only outstanding step on a task whose code
   and database state are already done. Base for the review package is `0c1a117`, head
   `bbabfa9`.
2. Then Task 5 (migration `0008`, `teacher_devices` + `register_device`), then Task 6
   (migration `0009`, `available_teachers`).
3. Remaining after that: 8, 9, 10, 11, 12, 13, 14, 15, 16, 17.

**Task order is NOT plan order.** Tasks 2 and 7 were pulled forward while `.env.local` was
missing. Completed so far: **1, 2, 7, 3**.

---

## ⚠ The database is ahead of `main`

**Migration `0007_teacher_availability.sql` is APPLIED to the live Supabase project**
(`upggvzzzoxqgourjywtd`) while the branch that contains it is unmerged. It is additive only —
a new table, its index, RLS, three policies, one new function and a trigger — and nothing in
production reads it, so there is no behaviour change. But if this branch were ever abandoned,
that table would be an orphan and would need dropping by hand.

**Migration `0006_roles_admin.sql` remains deliberately UNAPPLIED.** Verified live on
2026-08-30, not merely assumed: a `PATCH role='admin'` on a throwaway account using the
**service-role** key was REFUSED with a 400, and the account was then deleted. Do not apply it.

---

## Environment (restored 2026-08-30)

- `npm install` done. **`.env.local` now exists** — the user pulled it with
  `vercel env pull .env.local --yes` after `vercel link`. All 8 keys present. It is the user's
  file: never write it, never print its values.
- **Vercel CLI is linked**: `durdengrin-6266s-projects/smb-tutorials`, `.vercel/` created
  (gitignored).
- **Baseline measured on THIS machine:** 174 tests passed / 3 skipped · eslint clean ·
  `npm run build` clean · all three original probes exit 0
  (`probe-session-rls`, `probe-happy-path`, `reconcile-payments`).
- **`tsc` needs a build first.** On a fresh clone `npx tsc --noEmit` fails with
  `Cannot find name 'PageProps' / 'LayoutProps'` in 5 app files — these are Next 16 GENERATED
  globals under `.next/types` and do not exist until `npm run build` has run. Not a defect.
  Every implementer that reported "tsc clean" before a build was reporting an incomplete check.

---

## Completed tasks

| Task | Commits | State |
|---|---|---|
| 1 — restore baseline | (no code) | complete; numbers above |
| 2 — lease math | `bf64248` | complete, review clean, 1 deferred minor |
| 7 — notification port + web-push adapter | `da1ec9b`, `ab4c7b0` | complete after 1 fix round, re-review clean |
| 3 — migration `0007` + probe | `bbabfa9` | implemented, applied, probe green — **task review outstanding** |

Also `0c1a117`: kept the redundant `.env*.local` ignore line that `vercel env pull` added.

### Task 7 needed a fix round, and the plan was at fault

The plan's own test code declared `const sendNotification = vi.fn()` **below** a hoisted
`vi.mock` factory that closes over it — a temporal-dead-zone bug shipped in the brief. The
implementer corrected it with `vi.hoisted()`; six tests then still failed as unhandled
rejections, fixed by `mockImplementationOnce(async () => { throw … })`. The adapter itself was
never wrong and was not touched. The re-review confirmed the tests would still fail if the
404/410 mapping were inverted — the check that mattered, since this project has already shipped
a bug where a mock agreed with the defect it was meant to catch.

**Lesson for the next plan:** the plan review checked spec coverage, placeholders and type
consistency. It never checked whether the plan's test code would *run*.

### Deferred minors (hand these to the final whole-branch review)

- **Task 2:** `shouldRenew` renews at *exactly* half the lease (`remainingMs > half` returns
  false, so equality falls through to renew) where spec §4.1 says "less than half remains"; no
  test pins the exact halfway or 900s instants. One millisecond of extra eagerness.
- **Task 3:** `serviceRepr` is imported but unused in `scripts/probe-availability.mjs` — an
  eslint warning, exit still 0. Task 6 uses it to seed sessions in the same file.

---

## Rulings made during execution

Each with what it costs if wrong.

1. **Feature branch, not a git worktree.** A worktree needs its own `node_modules` *and* its own
   `.env.local` — a second copy of the service-role key on disk, pasted twice. Cycle 1's
   precedent is a branch merged to main. *Cost: main's working tree is occupied until this lands.*
2. **Proceeded while `.env.local` was missing**, running only tasks that need no credentials
   (2, 7) rather than idling. *Cost: none — neither touches the environment.*
3. **VAPID keys are generated by the controller, never a subagent** — a generated private key
   would otherwise land in a subagent transcript. Task 7's implementer was told to skip that
   step; the keys are still ungenerated. *Cost: none.*
4. **Task 9 invents no service-worker registration component.** Its text says the worker is
   "registered from a client component on teacher surfaces only" but lists none; registration
   already happens inside Task 10's helpers, which Task 11's component calls on every teacher
   dashboard load. *Cost: none — that component renders on every teacher dashboard load.*
5. **Task 7's six failures were mock plumbing, not an adapter defect** — the adapter already
   awaited inside `try/catch` and the success path passed. Fix confined to the harness, with an
   explicit ban on weakening assertions. *Cost: a weakened test would let a wrong 404/410
   verdict ship — hence the ban, and the re-review verified it.*
6. **Migrations are applied by hand.** No Supabase CLI, no DB connection string, and PostgREST
   cannot run DDL. Tasks 3/5/6 split: subagent writes migration + probe and proves the probe
   FAILS first, user pastes into the SQL editor, controller re-runs the probe to green, then
   review. *Cost: none — this is the path 0002–0005 took.*
7. **Migration tasks get a mid-tier model** despite complete briefs, because they define the
   cycle's security boundary. *Cost: slightly higher spend on three tasks.*
8. **Task 3's unused-`serviceRepr` warning stands** rather than being removed and re-added two
   tasks later. *Cost: one stale import if Task 6 changes shape.*
9. **Paused before Task 3's review** rather than mid-fix-loop. *Cost: one review dispatch on
   resume.*

---

## Still needed from the user, later

- **VAPID keys** (Task 7 step 6, deferred): `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — into `.env.local` **and** Vercel for Production,
  Preview and Development.
- **Migrations `0008` and `0009`** pasted into the SQL editor when Tasks 5 and 6 report.
- **The locked-phone walk (Task 17)** — an iPhone installing to the Home Screen, re-signing in,
  granting permission, and receiving a notification on a locked screen. No agent can do it.
- **The dispatcher credential decision** (spec §12) is still open and still non-blocking; it is
  one line of config in `src/lib/supabase/admin.ts` when Task 8 lands.
