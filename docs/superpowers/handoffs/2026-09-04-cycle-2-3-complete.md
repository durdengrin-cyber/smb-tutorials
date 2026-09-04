# Handoff — end of 2026-09-04

**Read this first, then `project_state.md`.** Written at the close of a very long session,
deliberately, because this project has lost state to git-ignored scratch before.

**Everything is committed, pushed, merged and deployed. `main` == `origin/main`. Tree clean.
Nothing is in flight.**

---

## 1. What is true now

| | |
|---|---|
| Branch | `main`, clean, pushed |
| Tests | **260 passing / 3 skipped** (31 files) |
| Gates | `tsc --noEmit` 0 · `eslint .` 0 · `npm run build` 0 |
| Probes | **7, all exit 0** |
| Migrations | `0001`–`0005`, `0007`–`0017` **applied live**. `0006` deliberately **NOT** applied |
| Production | https://smb-tutorials.vercel.app — running the merged code |

Probes: `probe-session-rls`, `probe-happy-path`, `reconcile-payments`, `probe-availability`,
`probe-role-guard`, `probe-session-reports`, `probe-auth-providers`. All re-runnable with no
arguments; each mints throwaway accounts and deletes them in a `finally`.

## 2. Cycle 2 — durable availability: COMPLETE AND PROVEN

Shipped, and — the part that was owed for three cycles — **proven on real hardware**:

- **iPhone walk PASSED** (03:28). Push delivered in **3 seconds** to a locked screen; tap opened
  `/dashboard` with the request live; accept minted the room.
- **Android walk PASSED** (16:28). **5 seconds. No meaningful Doze delay.**
- **The multi-device fan-out is proven.** One request → `fcm.googleapis.com` AND
  `web.push.apple.com` in a single dispatch, both `sent`, zero failures. Until that run the
  dispatcher had never sent to more than one device.

**Still unproven by execution: step 11, the decline case** — that a teacher who DENIES notification
permission reads "Can't reach you" and disappears from student lists. ~5 minutes with a second
account. It is the only part of cycle 2 with no execution evidence.

The walk found three defects, two fixed: the dashboard flashed "Can't reach you" (unconfirmed
cause; the silent-failing device-count read that could produce it is now checked and logged), and
`renewLease` could never tell an open dashboard its lease was gone (**fixed at the root** — the
tick now reconciles rather than only renewing). **F2 is still owed: the iOS Home Screen icon is
the placeholder from `6694ca7`. A real icon is owed before launch.**

## 3. Cycle 3 — student session record: SHIPPED

`/sessions` — a student's record of sessions where money moved, plus a report-a-problem path.
Built via subagent-driven development, 8 tasks, reviewed per task plus a whole-branch review.

- **Sign-in and post-call both now land students on `/sessions`** (was `/find` and `/teachers`).
  Confirmed by the user before it was built.
- Listing rule is `amount_paid_paise IS NOT NULL OR refund_ref IS NOT NULL` — a fact about money,
  never a status allowlist, because statuses changed in `0002` and again in `0005`.
- **Verified with real data**: the user filed a real report (`conduct` / "Test Phase 1" /
  Mr. Azad / Physics) and it landed correctly with the RLS participation check holding.

**The final review caught a Critical no per-task review could see:** `.limit(25)` ran in the
database and the money filter ran in JavaScript, so unpaid rows (the dominant type — every
instant-pick writes a `pending` row) ate the budget. A parent who had paid for six lessons could
have been shown "No sessions yet". Fixed by pushing the predicate into the query.

## 4. Security work landed today

Four real holes closed, each proved by a probe against the live database:

1. **`profiles.role` was self-writable** (`0013`). Demonstrated first: a student PATCHed
   themselves to `role=teacher, hourly_rate=99999` and got HTTP 200 with only the anon key.
   Now: `BEFORE UPDATE` trigger + `become_teacher()` re-checking `canBecomeTeacher` **in SQL**.
   `handle_new_user` also stops trusting signup metadata — **this is what makes `0006` safe to
   apply**, though there is still no reason to until admin is built.
2. **Signup consent was decorative** (`0014`). The checkbox had no `name`, so it never left the
   browser. Now server-validated and recorded (`consent_accepted_at`, `consent_version`).
3. **Push failures were invisible** (`0015`). `notification_events` logs every dispatch per
   device; `scripts/why-no-ring.mjs <email>` reads it back. Plus Sentry, with source maps.
4. **`session_reports` had one read control and destroyed its own evidence** (`0017`).
   `revoke select … from anon, authenticated` now stands beside RLS, and reports snapshot
   `teacher_name`/`subject`/`session_at` and survive deletion of the teacher they are about.

## 5. Configuration state

- **VAPID**: installed in `.env.local` and Vercel (Production, Development, and Preview for all
  branches). Subject is `https://smb-tutorials.vercel.app`.
- **Sentry**: live. DSN in all environments; `SENTRY_AUTH_TOKEN`/`ORG`/`PROJECT` in Production,
  so **source maps upload** and production traces resolve to real line numbers. Org `smb-yr`,
  project `javascript-nextjs`.
- **Google OAuth**: live and verified end to end. Consent screen **published** (not Testing, so
  no 100-user cap). Supabase **Site URL** is `https://smb-tutorials.vercel.app` — it was still
  `localhost` and silently swallowed every sign-in until it was fixed.
- **`NOTIFICATION_DB_KEY`**: unset **by ratified decision** (spec §12.1) — the dispatcher runs on
  the service role until cycle 3's database-enforcement work. `createDispatchClient()` warns once
  per cold start so the fallback is never silent again.

## 6. 🛑 Gotchas that cost real time today — do not rediscover these

- **Pasting a migration into the Supabase SQL editor: strip `begin;`/`commit;`.** `0013` silently
  rolled back with them; all three verification counts came back `0` and nothing said why.
- **`revoke ... from public` does NOT remove a named role's grant.** Supabase grants EXECUTE to
  `anon` and `authenticated` **by name**. `0012` shipped that bug to production. Always revoke
  from `anon` and `authenticated` explicitly, then re-grant.
- **A `"use server"` file may only export async functions.** A `const` there empties the module
  and every import fails — and **`tsc` does not catch it, only `npm run build` does.** Bit this
  session twice (`CONSENT_VERSION`, then nearly `REPORT_REASONS`).
- **`NEXT_PUBLIC_*` is inlined at BUILD time.** Saving it in Vercel does nothing until a
  redeploy. Verify by grepping the deployed chunks for the value, not by trusting the dashboard.
- **`vercel env add <name> preview --value <v> --yes` loops** — it demands a git branch, suggests
  the exact command you just ran, then rejects it. Use the REST API
  (`POST /v10/projects/:id/env`, `target:["preview"]`, no `gitBranch`) or pass the branch.
- **`.env.local` values are QUOTED** (Vercel CLI wrote it). `readEnv` in `probe-accounts.mjs`
  strips them; a hand-rolled parser will not. `probe-auth-providers.mjs` had its own copy and
  **crashed for weeks** while `project_state.md` recorded it as working.
- **`probe-availability` false-positives** if a real device registers mid-run — it asserts
  `teacher_devices` returns to its starting count. Check whether the extra row is a real phone
  before treating it as a leak.
- **`.env.local` is now guarded.** `.claude/settings.json` denies `Read()` on dotenv paths and a
  `PreToolUse` hook (`.claude/hooks/env-guard.sh`) blocks any Bash command naming one. Scripts
  that read it at runtime still work — the hook inspects the command string. To see variable
  NAMES, run something that masks values; to see a VALUE, ask the user.

## 7. ▶ What to do next

**Blocking a trial — the user's alone:**

1. **The child-safety policy.** Open since M3, the last pilot blocker code cannot solve. What it
   must answer: who may teach (vetting?), is a parent involved and how, what evidence exists, and
   who acts when a child reports something. Recording is DECIDED but deferred to launch — when it
   ships, three things move together or the product contradicts itself: the Daily room property,
   the payment notice ("may be recorded" → "will be"), and `terms/page.tsx:186`, which currently
   **forbids** recording outright.

**Small, ready to pick up:**

2. **Step 11 of the walk** — the decline case. ~5 minutes, closes cycle 2 entirely.
3. **The dead logo** (recorded in `project_state.md`). The signed-in header logo links to `/home`,
   a RESOLVER not a page, so a student clicking it round-trips back to `/sessions`. Needs a
   decision first: should a signed-in user reach `/` at all, given that page advertises the
   scheduled tier you have not built? A "Home" nav entry may beat changing the logo, since the
   logo is correct for teachers.
4. **The terms page** — still describes chat, packages and ratings that do not exist, and it is
   now the privacy policy Google shows users.
5. **A real `apple-touch-icon`** and real app icons (currently placeholders).

**Larger, from the redesign decomposition** (piece 1 shipped, piece 2 = `/sessions` shipped):

6. **Admin** — piece 3. Now UNBLOCKED by `0013`. Gated on the policy answers above. It is what
   `session_reports` needs: reports are readable only by the service role today, which is
   acceptable only while the operator is one person reading their own alerts.
7. **Polish pass** — piece 4, last.

**Deferred, recorded in spec §8 of `2026-09-04-student-session-record-design.md`:** Resend for
real report emails (Sentry is a deliberate compromise — a safety report is not an error), no
rate limit on reporting, no retention sweep on `notification_events`.

## 8. The standing instruction

*"This is a legit business being developed for scale. So choose accordingly."* — saved as project
memory `build-for-scale`. It has shaped every architectural call in cycles 2 and 3.

One honest counterweight, offered and accepted earlier today: the engineering is calibrated for
10,000 teachers and there are currently two, both test accounts. The teachers for the trial are
lined up and real; the product has still never met a real student.
