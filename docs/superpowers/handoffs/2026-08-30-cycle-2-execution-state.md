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

**See the SESSION 4 ADDENDUM at the very bottom of this file — it supersedes this block.**

**15 of 17 tasks complete.** All code is written. Two owed steps, then the user's two.

---

## ⚠ The database is ahead of `main`

**FIVE migrations are applied to the live Supabase project (`upggvzzzoxqgourjywtd`) on an
unmerged branch:** `0007_teacher_availability`, `0008_teacher_devices`,
`0009_teacher_devices_hardening`, `0010_available_teachers`, `0011_accept_window_bound`.
The first four are additive and nothing in production reads them.

**`0011` is DIFFERENT and matters: it REPLACED `enforce_session_insert()`, a trigger function
production uses on EVERY session insert.** It was regression-checked live immediately after
applying — `probe-session-rls`, `probe-happy-path` and `reconcile-payments` all exit 0, sessions
19→19 — so `0005`'s controls survive. Do not treat it as inert.

🛑 **MERGE BLOCKER:** `src/lib/session.ts` now sets `ACCEPT_WINDOW_SECONDS = 60`. The pre-`0011`
database bound was `accept_deadline > now() + 60s`, leaving ZERO clock-skew margin at a 60s
window. `0011` raises that bound to 120s. **`0011` is already applied, so this is satisfied
today** — but if the database is ever rebuilt from migrations, `0011` MUST be applied before this
app code is deployed, or every session request fails to insert.

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

---

# SESSION 2 ADDENDUM (2026-08-30 → 08-31)

Everything below was decided or discovered after the original document was written. Where it
disagrees with anything above, this addendum wins.

## Tasks completed this session

| Task | Commits | Notes |
|---|---|---|
| 3 — migration `0007` | `bbabfa9` | review clean |
| 5 — migrations `0008` + `0009` | `6ea9d50`, `d3358a6` | **two real security defects found and fixed** |
| 6 — migration `0010` | `b601899`, `4ac4f34` | one fix round; plan's seed logic was impossible |
| 4 + 14 — batch | `0e83937`, `1a77f92`, `6013aef` | includes migration `0011`, the clock-skew fix |
| 9 — PWA | `6694ca7` | manifest, sw.js, 3 icons; assets verified served |
| 10 — push client | `9051069` | state machine 6/6; suite 185 passed / 3 skipped |

Gates at pause: **185 passed / 3 skipped**, bare `npx eslint` **zero warnings**, build clean,
tsc clean, `probe-availability` 22 assertions ALL CLEAR, all three original probes exit 0.

## THE PLAN IS THE PROBLEM — read this before executing anything else

**Six defects surfaced task-by-task, and every one originated in the plan, not in an
implementer.** T7's temporal-dead-zone bug, T5's `let res` collision, T5's two SQL security
holes, T6's `let rows` collision, T6's invalid `grade: "10"`, T6's impossible `seed()`.

Root cause: the plan's code was reviewed for spec coverage and type consistency but **never
executed and never checked against the schema**. The most serious instance — T6's `seed()`
inserting sessions with `status: 'accepted'` — directly contradicts the integrity model M3
established in `0003`/`0005`.

**A plan-wide defect sweep was therefore run over the remaining tasks** (see below). Do not
resume serial discovery; the sweep replaced it.

**Lesson for the next plan: add a step that RUNS the plan's own test code.**

## Plan-wide sweep results (tasks 4, 8–17)

**SERIOUS — found and fixed:** T14 raised `ACCEPT_WINDOW_SECONDS` 30→60 while the DB bound was
60s, leaving zero clock-skew margin. Every session-request insert would have failed whenever
Vercel's clock ran ahead of Supabase's — intermittent, environment-dependent, invisible to unit
tests. Fixed by migration `0011` (bound → 120s), applied and regression-checked.

**MINOR — still open, fix when the task runs:**
- **T16** modifies `vitest.config.ts`; the real file is **`vitest.config.mts`**. As written the
  implementer creates a second, conflicting config.
- **T17**'s checklist says "`0007`–`0009` applied" — now must read **`0007`–`0011`**.
- **T8**'s Files header omits `src/lib/supabase/admin.ts` though its body creates it (cosmetic).

**VERIFIED OK, do not re-check:** every import against actual exports; T10's `register_device`
args vs the deployed signature; T13's `AvailableRow` vs `0010`'s return shape; `session.ts:5` and
`auth/actions.ts:43-47` line references; T12's target string at `availability-toggle.tsx:196`;
every "Modify" target exists except the vitest one; the `page.tsx → DashboardLive →
AvailabilityToggle` prop chain matches what T11/T12 assume.

**A caveat on my own sweep:** I declared T9's icon pipeline sound after testing `sips` with a bare
`<rect>`. It does not resolve `%`-unit coordinates on `<text>` or honour `dominant-baseline`, and
the brief's script produced cropped icons. The implementer caught it. **A passing spot-check is
not a passing pipeline.**

## Rulings this session (each with what it costs if wrong)

- **(T5-1) Fixed `register_device`'s TOCTOU race.** A spec violation, not a judgment call — §4.3
  says "atomically". *Cost of not fixing: the cycle's security guarantee false under concurrency.*
- **(T5-2) Added the teacher-only guard on `teacher_devices`.** A spec *gap*; ruled an oversight
  because the sibling table in the same cycle has it and cycle 1's blocking finding was this exact
  shape. **Proven live: the probe returned PERMITTED before the fix.** *Cost of not fixing: an
  unenforced invariant a later cycle would trust.*
- **(T5-3) Fixes ship as NEW migrations; applied files are never edited.** *Cost: renumbering.*
- **(T5-4) No concurrency assertion in the probe** — a flaky assertion in a security probe trains
  the reader to ignore red. *Cost: the race is not regression-tested.*
- **(T6-e/f) Parity cases seed through the legal lifecycle, and the two `accepted` cases collapse
  onto ONE row** — accept, assert hidden, wait for the deadline to lapse, assert the same row is
  listed. Pays the ~65s wait once and proves the exclusion RELEASES. *Cost: probe runtime.*
- **(T14-a) Waiting-screen copy ships as `h2` + `p`** rather than the brief's single sentence; the
  `h2` already existed. *Cost: a one-word tweak.*
- **(T14-b) A stale `30s` comment outside T14's file list was corrected.** *Cost: none.*
- **(SWEEP-1) The accept-window fix is migration `0011`.** *Cost: one file.*
- **(SWEEP-2) Task 16 is RESEQUENCED to last, NOT dropped.** The controller recommended dropping
  it; the user did not answer. Cutting scope is the user's call. *Cost: none — decision deferred.*
- **(SWEEP-4) `0011` is based on `0005`:76-139, NOT `0003`.** `0005` redefines both trigger
  functions. *Cost if wrong: silently reverting `0005`'s payment-columns ban — a security control.*
- **(SWEEP-5) Order resequenced to 9→10→11→12→8→13→15→16→17.** Task 8 is blocked on VAPID keys;
  9–12 are not. *Cost: none — checked against the interface table.*
- **(SWEEP-6/7) Reviews and tasks batched** where it buys correctness, not just cost: 9+10 share
  one reviewer so the worker↔client contract gets checked; 11+12 share one agent, which
  **dissolves** the preflight's only cross-task risk rather than mitigating it.

## Deferred minors — for the final whole-branch review

- **T2:** `shouldRenew` renews at *exactly* half the lease where §4.1 says "less than half".
- **T3/T5:** the probe's `finally` runs unguarded sequential awaits; a throw in the first skips
  the rest.
- **T5:** the guard trigger also gates future dispatcher UPDATEs on `role = 'teacher'` holding at
  write time. **Carry this into Task 8's dispatch — Task 8 is the dispatcher.**
- **T5:** the `register_device` race is fixed but not regression-tested.
- **T6:** the `paid` and `active` exclusion branches are verified only by static parity-reading.
- **T6:** the `teacher_subjects` seed POST does not check `res.ok`.
- **T4/T14:** happy-path write assertions are thin — `declareAvailable`'s test never asserts the
  `declared_until` value; `renewLease`'s renew case asserts only `toHaveBeenCalled()`.
- **T4:** no test forces `renewLease`'s `declared: false` guard.

## Still needed from the user

1. **VAPID keys** — `npx web-push generate-vapid-keys` in their own terminal (NOT via `!`, whose
   output lands in the transcript), then `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT` into `.env.local` **and** Vercel (Production, Preview, Development).
   **Task 8 is blocked on this and nothing else.**
2. **Task 16** — drop it or keep it. Deliberately left open.
3. **The locked-phone walk (Task 17)** — no agent can do it.
4. **The dispatcher credential** (spec §12) — still open, still non-blocking; `admin.ts` falls
   back to the service role via `NOTIFICATION_DB_KEY ?? SUPABASE_SERVICE_ROLE_KEY`.

---

# SESSION 3 ADDENDUM (2026-08-31 → 09-01) — the cycle's payoff landed

**12 of 17 tasks complete.** Where this disagrees with anything above, this wins.

## ✅ THE APOLOGY IS DELETED

`"Keep this tab open — closing it takes you offline."` no longer exists in `src/`.
`grep -rn "Keep this tab open" src/` returns nothing. The toggle's state is now a durable
declaration read server-side, not a `localStorage` flag that died with the tab. **This is the
first user-visible change of the cycle** — everything before it was plumbing.

## Tasks completed this session

| Task | Commits | Notes |
|---|---|---|
| 9 — PWA | `6694ca7` | manifest, `sw.js`, 3 icons; assets served 200; icons visually verified |
| 10 — push client | `9051069` | state machine 6/6; `applicationServerKey` typed properly, no `any` |
| 11 — setup surface | `45249f6` | four states, copy verbatim |
| 12 — durable toggle | `f12ec65`, `d0d1705` | apology deleted; one fix round |

**Gates at pause: 195 passed / 3 skipped (23 files) · `npx eslint` ZERO warnings · build clean ·
tsc clean · tree clean.** All verified by the controller directly, not taken from reports.

## Two things the implementers found that were better than what was asked

1. **A real pre-existing test-infra defect, fixed at the root.** Testing Library's auto-cleanup
   only self-registers when a global `afterEach` exists at import time. This project does not set
   `test.globals`, so it **never registered** — every existing component test that rendered more
   than once was leaking DOM into the next test. Now wired once in `vitest.setup.ts`, inert for
   node-environment tests. Latent in the repo the whole time.
2. **The `localStorage` intent flag was DELETED, not demoted.** The brief permitted keeping it as
   an "offline-first hint"; the implementer removed it entirely because `page.tsx` now reads the
   declaration server-side on every load, leaving no first-paint gap for a hint to fill. That
   removes the second source of truth rather than weakening it.

## Verification worth trusting

The Task 12 review found the `channelOk || hasDevice` logic **correct but untested** — every test
used `hasDevice: false`, so flipping `||` to `&&` would have passed all four. That is the exact
axis this cycle delivers: a teacher with a locked phone and a registered device must stay
bookable.

Fixed with one test, and **non-vacuity was proven twice** — by the implementer, then independently
by the controller: mutating line 248 to `&&` produced 3 failures; restoring gave 195 green with an
empty `git diff`. The test genuinely guards the push-only tier.

## ▶ RESUME HERE (supersedes the earlier resume block)

**Next: batch Tasks 13 + 15 in ONE dispatch.** Neither is blocked. Corrections below are mandatory.

Then: **Task 8** (blocked on VAPID keys) → **16** (user's decision, deferred) → **17** (user's).

### Task 13 — pre-checked, CLEAN

`OnlineTeacher` in `src/lib/presence.ts` is exactly `{ teacher_id, full_name, hourly_rate }`,
matching its test fixture field-for-field. `AvailableRow { teacher_id, has_device }` matches
`0010`'s `returns table`. Its test is a pure `.ts` unit test of `deriveRoster` — **node
environment, NO jsdom pragma needed.** No corrections required.

### Task 15 — THREE mandatory corrections

- **(a) `@testing-library/user-event` is NOT INSTALLED** and T15's test calls `userEvent.click()`.
  The plan sanctioned exactly two new deps this cycle (`web-push`, `@playwright/test`); this is
  not one. **Use `fireEvent.click` from `@testing-library/react`** (already installed).
- **(b) T15's Files list is INCOMPLETE.** The real sign-out caller is
  **`src/components/app-shell.tsx:42`**, which today renders `<form action={signOut}>` — a
  server-action form with no client JS. T15 must also modify that file. **DESIGN TRADE that must
  be stated, not stumbled into:** the current form signs a teacher out with JS disabled; a client
  button with an onClick handler does not. The trade is justified — T15's whole job (read the
  local subscription, `DELETE /api/devices`, `unsubscribe()`) is client work a no-JS form post
  cannot do — but it is a decision, not an accident. Every cleanup step must stay wrapped so a
  failure still signs the teacher out.
- **(c) T15's test is a FRAGMENT** — declares an unused `unsubscribe`, references an undeclared
  `fetchMock`, and needs `// @vitest-environment jsdom` on line 1. Build the scaffolding.

### Task 16 — still the user's call

Deferred to last, **not dropped**. The controller recommended dropping it (Task 17's manual walk
is what actually proves the feature); the user never answered. Do not decide this for them.

### Task 17 — two corrections

Its checklist says "`0007`–`0009` applied" — now must read **`0007`–`0011`**. Also worth adding:
check whether iOS renders the home-screen icon without an `apple-touch-icon` link (deferred minor
from the Task 9 review).

## Deferred minors for the final whole-branch review

- **T2:** `shouldRenew` renews at *exactly* half the lease where §4.1 says "less than half".
- **T3/T5:** the probe's `finally` runs unguarded sequential awaits.
- **T5:** the guard trigger gates dispatcher UPDATEs on `role = 'teacher'` holding at write time —
  **carry into Task 8's dispatch.**
- **T5:** the `register_device` race is fixed but not regression-tested.
- **T6:** `paid`/`active` exclusion branches verified only by static parity-reading.
- **T6:** `teacher_subjects` seed POST does not check `res.ok`.
- **T4/T14:** happy-path write assertions thin — `declareAvailable` never asserts the
  `declared_until` value; `renewLease`'s renew case asserts only `toHaveBeenCalled()`.
- **T9/T10:** `state.test.ts` does not pin the iOS-vs-denied branch ORDER (every `denied` case
  pairs with `standalone: true`); `sw.js:39` matches the target tab by substring; no
  `apple-touch-icon`; `readSetupFacts`'s unsupported-browser branch is indistinguishable from
  "not yet asked".
- **T12:** `void channel.untrack().then(...)` has no `.catch()`.

## The plan-quality finding — EIGHT defects, all in the plan

T7 TDZ · T5 `let res` · T5 two SQL security holes · T6 `let rows` · T6 invalid `grade: "10"` ·
T6 impossible `seed()` · T11/T12 missing jsdom pragma · T15 uninstalled `user-event`.

**None shipped.** The last five were caught before an agent ever saw them, by pre-checking briefs
against the real schema and files. Root cause every time: the plan's code was reviewed for spec
coverage and type consistency but **never executed and never checked against the schema**.

**The next plan needs a step that RUNS its own test code.**

One caveat on the controller's own sweep: I declared Task 9's icon pipeline sound after testing
`sips` with a bare `<rect>`. It does not resolve `%`-unit coordinates on `<text>` or honour
`dominant-baseline`, and the real script produced cropped icons. **A passing spot-check is not a
passing pipeline.**

## Still needed from the user

1. **VAPID keys** — `npx web-push generate-vapid-keys` in their own terminal (NOT via `!`, whose
   output lands in the transcript). Then `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT` into `.env.local` **and** Vercel (Production, Preview, Development).
   **Task 8 is blocked on this and nothing else.**
2. **Task 16** — keep or drop.
3. **Task 17** — the locked-phone walk. No agent can do it.
4. **The dispatcher credential** (spec §12) — still open, non-blocking.

---

# SESSION 4 ADDENDUM (2026-09-01) — all code complete, 15 of 17

**This supersedes every earlier resume block.** Stopped on a session rate limit, not on a problem.

## State

**215 tests passing / 3 skipped (27 files) · `npx eslint` ZERO warnings · build clean · tsc clean
· tree clean.** All verified by the controller directly, not taken from agent reports.

| Task | Commits | State |
|---|---|---|
| 8 — dispatcher + fan-out | `20144b2` | complete, review clean |
| 13 — student roster | `f29d540` | complete, **review approved with no changes** |
| 15 — sign-out unregisters device | `61452b1`, `54c262d` | complete, 1 fix round — **re-review OWED** |

Five migrations applied live: `0007`–`0011`.

## ▶ DO THESE TWO, IN ORDER

**1. The scoped re-review of `61452b1..54c262d` was never dispatched** — the rate limit hit
first. Generate the package with
`scripts/review-package <plan> 61452b1 54c262d` and run it before anything else.
It should verify: the `unstable_rethrow` guard cannot swallow a redirect; the new
`client.test.ts` actually pins the DELETE payload shape and the never-rejects property; and that
no pre-existing assertion was weakened.

**2. Then the FINAL whole-branch review.** `scripts/review-package <plan> $(git merge-base main
HEAD) HEAD`, dispatched on the most capable model. **Point it at the deferred-minors list below** —
that roll-up exists so it can triage what must be fixed before merge.

## What the fix round resolved, and one thing it didn't

Task 15's review found two Important items. Both are fixed:

- **`signOut()`'s own failure path could trap the user.** The button never reset `busy` and did
  not guard `await signOut()`. **The obvious fix was a trap:** `signOut()` ends in `redirect()`,
  which works by *throwing* a `NEXT_REDIRECT` signal — a plain `try/catch` would have swallowed it
  and broken sign-out outright, strictly worse than the stuck button. The implementer did not
  guess: it found that Next's `server-action-reducer.js` calls `reject(redirectError)` on the
  redirect branch, and used **`unstable_rethrow`** to re-throw navigation signals while handing
  the button back only on a genuine failure.
- **`removeThisDevice` had no direct test.** The implementer flagged this itself and the reviewer
  adjudicated the concern **justified** — the tested layer only exercised orchestration around a
  mock, while the untested layer held three sequential browser-API calls, each independently
  caught. Now covered by `src/lib/push/client.test.ts` (8 tests): the DELETE payload shape, that
  `unsubscribe()` still runs when the DELETE fails, and that the function never rejects across all
  three failure combinations.

**Not done — cosmetic, deferred:** when `connFailed` is true *and* an outcome banner is present,
two visually identical amber banners stack in `online-list.tsx`. Merge or differentiate.

## A process lesson worth keeping

The fix agent terminated on the rate limit with a final streamed line saying it was *"now"* about
to start Finding 2. **That was stale.** Checking the filesystem showed both findings already
complete and every file written — only the commit was missing. **A terminated agent's last words
describe intent, not state.** Check disk, then decide.

## Deferred minors — hand ALL of these to the final review

- **T2:** `shouldRenew` renews at *exactly* half the lease where §4.1 says "less than half".
- **T3/T5:** the probe's `finally` runs unguarded sequential awaits.
- **T5:** the `teacher_devices_guard` trigger gates the dispatcher's own `last_failed_at` UPDATE on
  `role = 'teacher'` still holding at write time. Harmless today; noted, not designed around.
- **T5:** the `register_device` race is fixed but not regression-tested (a flaky concurrency
  assertion in a security probe was judged worse than none).
- **T6:** `paid`/`active` exclusion branches verified only by static parity-reading.
- **T6:** `teacher_subjects` seed POST does not check `res.ok`.
- **T4/T14:** happy-path write assertions thin — `declareAvailable` never asserts the
  `declared_until` value; `renewLease`'s renew case asserts only `toHaveBeenCalled()`.
- **T9/T10:** `state.test.ts` does not pin the iOS-vs-denied branch ORDER; `sw.js:39` matches the
  target tab by substring; no `apple-touch-icon`; `readSetupFacts`'s unsupported-browser branch is
  indistinguishable from "not yet asked".
- **T12:** `void channel.untrack().then(...)` has no `.catch()`.
- **T8:** `admin.ts:105` `NEXT_PUBLIC_SUPABASE_URL ?? ""` fails quietly where the sibling missing-key
  case throws loudly; `dispatch.ts:133-136` collapses "no devices" and "query errored" into the
  same return; test 2 never asserts the failed id reaches `.update()`; no test covers the
  `after()`/`redirect()` ordering.
- **T13/T15:** the stacked-banner cosmetic above.

## Still needed from the user

1. **VAPID keys are GENERATED but NOT INSTALLED.** `.env.local` still has none of the three
   (verified by name, never by value). Add `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   and `VAPID_SUBJECT` (a `mailto:` or `https:` URL — chosen, not generated) to `.env.local` **and**
   Vercel. **Nothing in the code is blocked on this** — an earlier session wrongly called Task 8
   blocked; its tests mock the transport. The keys are needed for real DELIVERY: Task 16 and
   Task 17.
2. **Task 16 (Playwright)** — keep or drop. Deliberately left undecided; cutting scope is the
   user's call. The controller's read: Task 17 is what actually proves the feature.
3. **Task 17 — the locked-phone walk.** No agent can do it. Its checklist needs two corrections:
   it says "`0007`–`0009` applied" and must read **`0007`–`0011`**; and add a check for whether iOS
   renders the home-screen icon without an `apple-touch-icon` link.

## 🛑 Before merging

`0011` MUST be applied before this app code reaches production — it is, today. If the database is
ever rebuilt from migrations, apply it before deploying, or every session-request insert fails on
zero clock-skew margin.
