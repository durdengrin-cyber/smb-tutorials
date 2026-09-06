# Handoff — conduct suspension, 2026-09-06 (afternoon)

State at the pause of the 2026-09-06 session. Read this before touching anything.

---

## 1. Where the work is

**Branch `feat/visual-identity-tokens` — 31 commits added today, tree clean, PUSHED, NOT merged.**
It now carries two unrelated bodies of work: the visual identity cycle from 2026-09-05/06 (see
`2026-09-06-visual-identity-complete.md`) and everything below. They are stacked deliberately —
`main` is strictly behind, and branching off it would have conflicted in five of the nine files
this work touches.

**Verified by running them, with no subagent editing the tree:**

| Check | Result |
|---|---|
| `npx vitest run` | **428 passed / 3 skipped** |
| `npx tsc --noEmit` | 0 |
| `npx eslint .` | 0 errors (2 pre-existing warnings in `flow-demo.test.tsx`) |
| `npm run build` | 0 |
| `node scripts/probe-suspension.mjs` | **ALL CLEAR** against the live database |

## 2. 🛑 Migration 0020 IS APPLIED TO PRODUCTION

`supabase db push` was run by the owner. `supabase migration list` shows all 19 rows
LOCAL == REMOTE. **This is the only part of today's work that is already live** — the branch
carrying the UI is not merged, so the schema is ahead of the product. That is safe: the trigger
only fires on a `conduct` report, and suspension only hides a teacher from
`available_teachers()`, which production already respects.

`0020` adds `teacher_suspensions`, `sessions.cancellation_reason`, `reinstate_teacher()`,
`my_suspension()`, the `on_conduct_report_suspend` trigger, and `create or replace` of **three
live functions**: `available_teachers`, `enforce_session_update`, `enforce_session_insert`.

## 3. What was built, and why

**The headline:** `/terms` has promised since cycle 3 that a conduct report suspends a teacher
pending review. **Nothing implemented it.** A teacher reported at 2am stayed bookable by any
child. Child-safety spec §12 marked it DECIDED and it was never built — a gap between a decision
and its delivery, not a scoping choice.

- **Spec** `2026-09-06-conduct-suspension-design.md`, **plan** `2026-09-06-conduct-suspension.md`.
- A report now opens a suspension atomically, the teacher leaves discovery immediately, their
  not-yet-started sessions are cancelled and their paid ones refunded, an `active` lesson finishes
  (owner's decision, §12 of the spec records what it costs), and only the operator can lift it —
  recorded, via `reinstate_teacher()` from the CLI, since admin does not exist.
- `/terms` now describes what the product actually does. **Owner has not read the new wording.**

**Also today, unplanned:** the 17-site no-op hover sweep; `(gate)` error boundaries; a
`server-only` guard on the four modules reading secrets; a nav route guard; and `siteBaseUrl()`.

## 4. The things that are not visible in a diff

1. **My plan would have left `reinstate_teacher` callable by anyone holding the public anon key.**
   It revoked from `public` and `authenticated` but not `anon`, and `0012` documents exactly why
   that fails: Supabase's `ALTER DEFAULT PRIVILEGES` grants EXECUTE to `anon` **by name**, and
   revoking from PUBLIC does not remove a named grant. On a `security definer` function the grant
   IS the control. An implementer caught it, fixed it, and flagged the deviation.

2. **Two of my `sed` extraction ranges were one line short.** `140,260` where the function ended
   at 273, and `32,91` where `$$;` was at 92. Either would have shipped a migration with an
   unterminated dollar-quote. Both caught by others. **Any future plan naming a `sed` range for a
   `create or replace` must state the terminator line and how it was checked.**

3. **`cancellation_reason` was guarded on UPDATE and not INSERT.** A student could have created a
   session already stamped `teacher_suspended`, cancelled it themselves, and been told their
   teacher was suspended. Folded into `0020` before it applied, so the hole never existed in
   production.

4. **A cancel that lost its status race reported success.** PostgREST answers a zero-row match
   with `error: null`, identical to a write. Without `.select()`, `settleSuspension` returned
   "I acted" having changed nothing, and the waiting page would redirect for a write that never
   happened. `refund.ts` defends the same way; the cancel path did not.

5. **A student who was never charged was told their money was refunded.** The
   `teacher_unavailable` outcome attached the session *price* unconditionally, and that outcome is
   only ever reached on unpaid sessions. Caught by the final review rendering the page.

6. **Five unsupported claims were made on this branch today, all by me, all caught by review.**
   A production outage that had not happened; a guard comment claiming "Next guarantees" something
   it does not; an error boundary claiming coverage it lacks; an idempotency comment false on the
   one branch the same file acknowledges; and a commit message describing a refund figure that
   does not travel. `CLAUDE.md` gained a section about this. **The written rule was necessary and
   not sufficient — two of the five were made after writing it. The review gate is what caught
   them.**

## 5. Open, and what each blocks

| Item | Blocks |
|---|---|
| **The `/terms` wording.** Rewritten today, unread by the owner. It is a published legal document | Merging with confidence |
| **The handset pass.** Carried from the previous handoff, still the gate on the visual identity work | The merge decision for all 65 commits |
| **The domain** | The share card, password reset, the support address, the email sender |
| **`refundSession` calls the payment provider BEFORE its `refund_ref is null` guard, with no idempotency key.** Recorded in the spec as a known gap. **Its exposure grew today** — it is now reachable from a page render, not only webhook redelivery | Nothing yet. Should be next after the profile work |

## 5b. Teacher profile editing — BUILT, 2026-09-06 evening

The owner's original ask, and it is done. `/profile` lets a teacher change their hourly rate,
subjects, qualification, experience, specialisation, teaching level, hours per week, demo video,
name, phone — and **`bio`**, which `/privacy` has promised and nothing collected until now.

No migration: `0001` already granted `update own profile` and insert/delete on
`teacher_subjects`, so RLS is the authorisation and the service role appears nowhere in the
feature. Reviewed and confirmed: every write keys on the caller's own id, and subjects are built
from validated taxonomy values so no input can inject a `teacher_id`.

Worth knowing:

- **Subjects are replaced before the profile is updated**, deliberately. A partial failure then
  leaves correct-subjects-and-old-rate, which a teacher can see and fix, rather than
  new-rate-and-stale-subjects, which is silently wrong in search. Each half returns a different
  message saying which saved.
- **The rate race is handled.** `enforce_session_insert` raises
  `hourly_rate must match the teacher profile` if a teacher's rate changes between a student's
  request being priced and the insert landing. The implementer confirmed that error's live shape
  with a throwaway probe before matching on it, rather than reading the migration and assuming.
  The window is milliseconds — the app re-reads the rate immediately before inserting.
- **Two more unsupported claims were made and caught here** (a comment saying the trigger
  snapshots the rate — it validates and raises; and one overstating the race window). That makes
  **seven on this branch today, across two different authors, all caught by review and none by
  their author.** The written rule has now failed to prevent this seven times. The gate is what
  works.

## 6. Next, and it is already designed

Teacher profile editing is **done** — see §5b. Plan:
`docs/superpowers/plans/2026-09-06-teacher-profile-editing.md`.

**Closed later on 2026-09-06**, after this list was first written: `settleVerifiedEvent` now has 18
tests where it had none, each proven able to fail by mutation; `refundSession`'s
REFUNDED-BUT-NOT-RECORDED branch is covered; and the double-refund gap is closed with an
idempotency key (`receipt`), whose acceptance by Razorpay the owner confirmed with a live probe —
`400 "The id provided does not exist"` at `input_validation_failed`, not a router 404.

**Remaining, and every one needs an owner decision before it can be built:**

| Item | The decision it waits on |
|---|---|
| No refund path for the refunds `/terms` promises ("Technical failure preventing the session: Full refund") | Who declares a session a technical failure — the student, self-serve, or the operator? |
| **Teachers are never paid.** The dashboard says "earned · pending payout" and nothing pays out | The payout model. Stripe Connect is listed as deferred in CLAUDE.md |
| No password reset | The domain, then an email sender |
| No email is ever sent — Resend is in the stack, unused | The domain |
| The admin surface (piece 3) | Whether the pilot runs on CLI-only operator actions, which is honest only at pilot size |

**One technical item does not need a decision, and is the natural next build:** nothing observes
Razorpay's duplicate-receipt wording live, because producing a genuine duplicate needs a real
captured payment through a browser. That is the same manual gate the webhook signature has always
needed, and doing both in one sitting would close both.

## 7. Carried forward, not blocking

- The `"use client"` detection in `server-secrets.test.ts` does not skip a leading `/* */` block
  comment. Verified inert — no file in the repo has one.
- `on conflict do nothing` in the suspension trigger is unobserved; the unique index it backs is
  proven live.
- `available_teachers` retains anon EXECUTE. Pre-existing since `0010`, knowingly recorded in
  `0012`, restated verbatim by `0020` so it is neither worse nor fixed.
- One new test in `waiting/page.test.ts` covers a field combination
  (`teacher_suspended` + `refund_ref`) that no current code path produces — defensive, not live.
