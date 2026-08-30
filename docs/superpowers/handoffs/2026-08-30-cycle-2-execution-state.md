# Cycle 2 — Durable Availability — EXECUTION IN PROGRESS

**Last updated 2026-08-30, after Task 5 closed.**

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

**Next: Task 6** (migration `0010`, `available_teachers`). Its brief is generated and its
defects are already ruled — see "Task 6 pre-flight" below; the dispatch MUST carry those four
corrections or the implementer will ship code that does not parse.

Then: 4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17.

**Task order is NOT plan order.** Tasks 2 and 7 were pulled forward while `.env.local` was
missing. Completed: **1, 2, 7, 3, 5**.

---

## ⚠ The database is ahead of `main`

**Three migrations are applied to the live Supabase project (`upggvzzzoxqgourjywtd`) on an
unmerged branch:** `0007_teacher_availability`, `0008_teacher_devices`, and
`0009_teacher_devices_hardening`. All additive, nothing in production reads them, so there is
no behaviour change — but abandoning this branch leaves three orphan objects to drop by hand.

**Migration `0006_roles_admin.sql` remains deliberately UNAPPLIED.** Verified live on
2026-08-30, not assumed: a `PATCH role='admin'` on a throwaway account using the **service-role**
key was REFUSED with a 400, and the account was then deleted. Do not apply it.

**Migration numbering note:** `0009` is the hardening pass on `0008`, NOT the roster RPC. The
roster RPC is `0010` (renumbered — see ruling T5-3).

---

## Environment

- `npm install` done. `.env.local` exists (user pulled it with `vercel env pull`, all 8 keys).
  It is the user's file: never write it, never print its values.
- **Vercel CLI linked**: `durdengrin-6266s-projects/smb-tutorials`.
- **Baseline on this machine:** 174 tests passed / 3 skipped · eslint exit 0 (one known warning)
  · build clean · the three original probes exit 0 · `probe-availability` exits 0 at 11 assertions.
- **`tsc` needs a build first.** `npx tsc --noEmit` fails on a fresh clone with
  `Cannot find name 'PageProps' / 'LayoutProps'` — Next 16 GENERATED globals under `.next/types`.
  Not a defect. Every implementer reporting "tsc clean" before a build reported an incomplete check.

---

## Completed tasks

| Task | Commits | State |
|---|---|---|
| 1 — restore baseline | (no code) | complete |
| 2 — lease math | `bf64248` | complete, review clean, 1 deferred minor |
| 7 — notification port + web-push adapter | `da1ec9b`, `ab4c7b0` | complete after 1 fix round |
| 3 — migration `0007` + probe | `bbabfa9` | complete, review clean, 1 minor (closed by Task 6) |
| 5 — migrations `0008`+`0009` + probe | `6ea9d50`, `d3358a6` | complete after 1 fix round |

### Task 5 found the cycle's real security defects

The task review returned two **Important** findings, both **plan-mandated** — the defective SQL
was verbatim in the plan, so neither was implementer error. Both were fixed in `0009`:

1. **`register_device` was not atomic**, and spec §4.3 requires that it is ("reassigns the
   endpoint to the calling user **atomically**"). Delete / exists-check / insert-on-conflict were
   three unsynchronized statements, and the conflict path never set `teacher_id`. A victim
   re-registering their own device concurrently with an attacker holding the stolen triple ends
   with the row owned by the attacker carrying the victim's live keys — **and the victim's call
   returns success**. Exactly the silent failure the function's comments promise to prevent.
   Fixed with `pg_advisory_xact_lock(hashtext(p_endpoint))` covering the read-modify-write.
2. **No schema-level teacher guard on `teacher_devices`.** The role check lived only inside the
   RPC; any authenticated student could POST a self-owned row straight to the table and bypass
   it. **Proven live, not inferred** — the new probe assertion came back PERMITTED against the
   real database before `0009` was applied. Fixed with a `before insert or update` trigger
   mirroring `0007`'s.

---

## Rulings made during execution

Each with what it costs if wrong.

1. **Feature branch, not a git worktree.** A worktree needs its own `node_modules` *and* its own
   `.env.local` — a second copy of the service-role key on disk. *Cost: main's working tree is
   occupied until this lands.*
2. **Proceeded while `.env.local` was missing**, running only tasks needing no credentials (2, 7).
   *Cost: none.*
3. **VAPID keys are generated by the USER in their own terminal** — not by a subagent (a generated
   private key would land in a subagent transcript) and not by the controller via the `!` prefix
   (whose output lands in the conversation). This supersedes the earlier controller-generates
   ruling. The controller needs none of the three values. *Cost: none.*
4. **Task 9 invents no service-worker registration component** — registration already happens
   inside Task 10's helpers, called by Task 11's component on every teacher dashboard load.
   *Cost: none.*
5. **Task 7's six failures were mock plumbing, not an adapter defect.** *Cost: a weakened test
   would let a wrong 404/410 verdict ship — hence the explicit ban on changing assertions.*
6. **Migrations are applied by hand.** No Supabase CLI, no DB connection string, PostgREST cannot
   run DDL. Split: subagent writes migration + probe and proves the probe FAILS first, user pastes
   into the SQL editor, controller re-runs to green, then review. *Cost: none.*
7. **Migration tasks get a mid-tier model** despite complete briefs — they define the cycle's
   security boundary. *Cost: slightly higher spend on three tasks.*
8. **Task 3's unused-`serviceRepr` warning stands** rather than being removed and re-added.
   Task 6 consumes it. *Cost: one stale import if Task 6 changes shape.*
9. **Paused before Task 3's review** rather than mid-fix-loop. *Cost: one review dispatch.*
10. **(T5-1) Fixed the `register_device` race.** Not a judgment call against the plan — a spec
    violation. *Cost of not fixing: the cycle's stated security guarantee is false under
    concurrency.*
11. **(T5-2) Fixed the missing teacher guard.** A spec *gap*, not a violation: §4.3 specifies the
    trigger for `teacher_availability` and omits it for `teacher_devices`. Ruled an oversight
    because the reasoning applies verbatim, the sibling table in this same cycle has the guard,
    and cycle 1's blocking finding was this exact shape. *Cost of not fixing: an unenforced
    invariant a later cycle would trust.*
12. **(T5-3) The fix ships as a NEW migration `0009`; `0008` is not edited** — it is already
    applied live, and editing it would make the file lie about what ran. Task 6's migration
    renumbers to `0010` so filename order still equals apply order. *Cost: one renumbered file.*
13. **(T5-4) No concurrency assertion in the probe.** A race can only be probed by firing parallel
    calls and hoping to catch the interleaving — flaky in both directions, and a flaky assertion
    in a security probe trains the reader to ignore red. *Cost: the race is not regression-tested.*

---

## Task 6 pre-flight — FOUR corrections the dispatch must carry

Three plan-code defects had already surfaced this cycle (T7's TDZ bug, T5's `let res`), so the
controller pre-checked Task 6's brief against the schema and the file it merges into. **Three
more found, plus the renumber:**

- **(a) `let rows` collides** with `const rows` at `scripts/probe-availability.mjs:175`, committed
  by Task 5 in the same scope — a `SyntaxError`; the file would not parse. Task 6 renames ITS
  variable to `rosterRows` (4 uses). Task 5's reviewed line is not touched.
- **(b) `grade: "10"` is invalid data**, used in THREE places (the `teacher_subjects` insert, the
  `taxonomy` object, the `seed()` sessions insert). Both `teacher_subjects.grade` and
  `sessions.grade` carry `check (grade in ('6th'...'12th'))`. The insert would silently 400 (the
  brief never checks that response), the roster would return nothing, and the assertion would go
  **red pointing at the SQL — which would be innocent**. The four parity seeds would additionally
  crash on `row.id` of undefined. Correct value is `"10th"`, as used at
  `probe-session-rls.mjs:57` and `probe-happy-path.mjs:98,218`.
- **(c) The migration renumbers to `0010_available_teachers.sql`** (ruling 12).
- **(d) Verified OK, needs no change:** `x.status = 'paid'` is valid — `0002`'s status check omits
  it but `0005_payments.sql:24-26` drops and re-adds the constraint to include it. Also confirmed
  present: `teacher_availability.declared`/`.declared_until`, `sessions.started_at`/
  `.duration_minutes`/`.accept_deadline`/`.payment_deadline`, and the `teacher_subjects` columns.

**Task 6's `seed()` uses `serviceRepr(env)`**, which consumes the import deferred from Task 3 and
closes that minor.

### Plan-quality finding for the final review

**Every code-carrying task inspected so far contained code that would not run as written** —
T7's TDZ bug, T5's `let res`, T6's `let rows` and `grade: "10"`. Same root cause each time: the
plan's code was reviewed for spec coverage and type consistency but **never executed**. It is
costing little only because it is being caught before dispatch. The next plan needs a step that
runs its own test code.

---

## Deferred minors — hand these to the final whole-branch review

- **Task 2:** `shouldRenew` renews at *exactly* half the lease where spec §4.1 says "less than
  half remains"; no test pins the exact halfway or 900s instants. One millisecond of eagerness.
- **Task 5:** the probe's `finally` runs four unguarded sequential awaits — a throw in the first
  skips the rest and leaks throwaway state. Pre-existing from Task 3, one link longer now.
- **Task 5:** the guard trigger also gates future dispatcher UPDATEs (`last_ok_at`,
  `failure_count`, `last_failed_at`) on `profiles.role = 'teacher'` still holding at write time.
  If a teacher's role is ever changed, a legitimate delivery-status update is blocked. Inherited
  from `0007`'s pattern. **Carry this pointer into Task 8's dispatch** — Task 8 is the dispatcher.
- **Task 5:** the `register_device` race is fixed but not regression-tested (ruling 13).

---

## Still needed from the user, later

- **VAPID keys** — the user runs `npx web-push generate-vapid-keys` in their own terminal and
  pastes `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` into `.env.local`
  **and** Vercel (Production, Preview, Development). Needed by Task 8.
- **Migration `0010`** pasted into the SQL editor when Task 6 reports.
- **The locked-phone walk (Task 17)** — an iPhone installing to the Home Screen, re-signing in,
  granting permission, receiving a notification on a locked screen. No agent can do it.
- **The dispatcher credential decision** (spec §12) — still open, still non-blocking; one line of
  config in `src/lib/supabase/admin.ts` when Task 8 lands.
