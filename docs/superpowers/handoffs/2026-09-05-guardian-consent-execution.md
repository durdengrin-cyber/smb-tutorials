# Handoff — end of 2026-09-05

**Read this first, then `project_state.md`.** Written because this project has lost state to
git-ignored scratch before.

**MERGED AND DEPLOYED 2026-09-05.** 26 commits on `main` @ `89da21e`, pushed, branch deleted.
Migrations `0018`/`0019` applied. Verified live route-by-route, not from the Vercel dashboard.

---

## 1. What is true now

| | |
|---|---|
| State | **merged to `main` @ `89da21e`, pushed, deployed** — branch deleted |
| Shipped | 26 commits on 2026-09-05 |
| Tests | **300 passing / 3 skipped** (was 260 at session start) |
| Gates | `tsc --noEmit` 0 · `eslint .` 0 problems · `npm run build` 0 |
| Probes | **8, all exit 0 against production** — `probe-consent.mjs` is new |
| Migrations | `0018`, `0019` **APPLIED via `supabase db push`** and verified by query — §3 |
| Production DB | **schema updated.** The deployed *app* is unchanged — nothing is pushed |

**The split matters:** the database now has the new schema, but production still runs the old
code. That is safe in this direction — `0018` only adds nullable columns and `0019` only adds a
table and functions, so the running app neither sees nor needs them. It would NOT be safe in
reverse.

## 2. What this branch does

The M3 child-safety blocker, closed in code. Four decisions were taken in conversation
(§6) and the first of three plans was executed.

- **The guardian holds the account.** Signup collects the adult's name/email/phone plus the
  learner's first name and grade. `sessions.student_name` (`0004`) now snapshots the *child's*
  name, which is what that column was always meant to hold.
- **Consent is an append-only log.** `consent_events` (`0019`), written only through a
  `security definer` RPC that stamps `now()` and `auth.uid()` in SQL. `profiles.consent_*`
  remains a latest-value convenience; the log is the evidence.
- **One gate, every entry path.** `requireUser()` blocks any authenticated page until consent is
  current, and `requireConsentedUser()` does the same for every server action and route handler.
- **`/privacy` exists**, and `/terms` publishes the refund policy and the Tutor Agreement.

## 3. ✅ MIGRATIONS ARE APPLIED (resolved 2026-09-05)

`0018` and `0019` went in via `supabase db push`, not by hand. Verified by query against
production, not assumed:

| Check | Result |
|---|---|
| 3 new `profiles` columns | ✅ |
| `consent_events` exists | ✅ |
| `authenticated` can EXECUTE `record_consent` | ✅ true |
| `anon` can EXECUTE it | ✅ false |
| `authenticated` / `anon` can SELECT the log | ✅ false, false — the `0017` control, proven live |
| `0006` still unapplied | ✅ `CHECK (role = ANY (ARRAY['student','teacher']))` |

**All 8 probes exit 0**, including `probe-consent.mjs`, whose assertion 4 confirms an
authenticated user reading their own consent row is *refused* (HTTP 403), not merely RLS-empty —
the distinction that hid the `0012` bug in production once before.

**The migration workflow changed in the same session** — see §3b. The section below is kept only
because it documents how to verify state from scratch.

## 3b. The CLI replaces hand-pasting

`supabase db push` is now the way. What had to happen first, and why each mattered:

- **The ledger was empty.** All 19 migrations had been applied by hand, so
  `supabase_migrations.schema_migrations` had no record and `db push` would have re-run
  everything from `0001`. Repaired: `0001`–`0005` and `0007`–`0017` marked applied.
- **`begin;`/`commit;` had to go** from all 14 files that carried them. `db push` wraps each
  migration in its own transaction, so an explicit `commit;` would end it early and run the rest
  unprotected — the opposite of the safety it was originally added for.
- **`0006` had to move out of `supabase/migrations/`.** Hand-pasting kept it unapplied by simply
  never pasting it; `db push` applies anything the ledger does not list. It now lives in
  `supabase/migrations-deferred/` with a README. **Marking it applied in the ledger would have
  been a lie** that hid a real schema difference.
- **The CLI could not parse the local dotenv file — diagnosed and FIXED.** One value (the Sentry
  DSN) had been pasted with a literal newline inside it, so it spanned two physical lines. Next's
  parser tolerated that for months; the CLI's did not, and its error named only the file, never
  the line. Joining the two lines fixed it, and `supabase migration list` now runs from the repo
  root with no scratch-copy dance.

Two credentials notes from the same work: `supabase/.temp/` was untracked but **not** git-ignored
(one `git add -A` from being committed) and is now ignored — audited first, it holds no password.
And applying DDL from inside Claude Code is blocked by the permission classifier, correctly; a
human runs `db push`.

## 3c. (historical) How to verify migration state from scratch

**Were migrations `0018` and `0019` applied?** The user was mid-paste when this handoff was
written. Check, do not assume:

```sql
select count(*) from information_schema.columns
 where table_name='profiles'
   and column_name in ('learner_first_name','learner_grade','guardian_phone_verified_at');
-- 3 = 0018 applied

select count(*) from information_schema.tables where table_name='consent_events';
-- 1 = 0019 applied

select has_table_privilege('authenticated','public.consent_events','select');
-- MUST be false. true = the 0012 revoke bug shipped again
```

Paste-ready files (transaction wrappers stripped, which `0013` proved is mandatory) are at
`.superpowers/sdd/2026-09-04-guardian-consent-and-privacy/paste/`. **That directory is
git-ignored — regenerate with `sed -e '/^begin;$/d' -e '/^commit;$/d'` if it is gone.**

Then `node scripts/probe-consent.mjs` must exit 0. Until the migrations are applied it fails with
"could not find the function public.record_consent" — that is the expected pre-application
failure, not a bug.

**`0018` must be applied before `0019`.** `0019`'s `handle_new_user` writes to columns `0018`
creates, and a half-applied pair breaks every new signup.

## 4. The two things that were nearly shipped broken

Both were caught by review, not by tests. Worth knowing because both are recurring shapes.

1. **The plan's `enforce_session_insert` body implemented one rule; the live function has seven.**
   Four migrations have redefined that function (`0003`, `0004`, `0005`, `0011`); `0011` is
   authoritative. `create or replace` would have silently dropped six rules, including `0011`'s
   ban on a new session carrying payment columns — which exists because a student's own POST
   could otherwise arrive with a forged `amount_paid_paise`. Caught in the pre-flight scan
   (`dcece8a`). **Rule: before any `create or replace function`, diff against the live body.**

2. **The consent gate covered page renders only; every server action bypassed it.** Next resolves
   server actions from an app-wide manifest and executes them *before* rendering, and action IDs
   are readable from public `/_next/static` chunks. An unconsented Google account could POST to
   the one exempted path with a `Next-Action` header and request a session, ring a teacher's
   phone, open checkout, or file a report. Fixed in `f745c74` with `requireConsentedUser()` across
   all 17 exported actions plus `/api/devices`. **Rule: a page-level guard is not an app-level
   guard in the App Router.**

A third, found by the final whole-branch review: `handle_new_user` took `consent_events.accepted_at`
from client-supplied metadata. The anon key is public and Supabase's signup endpoint is directly
callable, so a crafted timestamp landed in the supposedly-unforgeable evidence log. Fixed in
`ad0b2bd` by letting the column default stamp it.

## 5. Owed — the user's call, not code

1. ~~**Confirm the refund policy wording.**~~ **Read and acknowledged by the user 2026-09-05.**
   Live at `/terms`, implemented verbatim from the draft (ruling R4). The user is refining the
   commercial terms separately and will say if the page needs changing. **Not a blocker** — it is
   a text edit and a redeploy, and no code depends on it.
2. **Two lateness thresholds now coexist** and this is a product decision, not a defect: Tutor
   Conduct says >5 min late means the tutor extends the session; the new Refund Policy says
   >10 min late means a full refund if the student cancels. Complementary remedies for different
   severities — but a parent reading one section may miss the other.
3. **Then merge.** The whole-branch review's verdict is *ready to merge*.

## 6. Decisions taken this session (spec §§10–12, 17)

Recorded in `docs/superpowers/specs/2026-09-04-child-safety-and-consent-design.md`:

- **Vetting:** government ID checked against the account name, a signed Tutor Agreement, and the
  existing demo video. **The ID is checked, never stored** — storing them recreates for teachers
  the honeypot the spec rejects for students. A third-party background check is *deferred, not
  rejected*; the vetting state is shaped so adding one is a new value, not a new mechanism.
- **Recording:** every session recorded, **30-day expiry**, preserved only while a report about it
  is open. The expiry is what distinguishes this from the signup-video proposal the spec rejects,
  so it is part of the decision, not an implementation detail.
- **Escalation:** a `conduct` report auto-suspends the teacher in the same transaction that files
  it — via trigger, not application code — with operator review within 24 hours and the outcome
  recorded so a reinstatement is evidence too.
- **Pilot gate:** the pilot **charges real money**, legal review in parallel. Running it free was
  rejected on discovering `session.ts:37` — *"The only route to `active` is through `paid`"* — so
  a free pilot means no session ever reaching `active`, no call ever starting, and an empty
  `/sessions` for every student.

**Still open and needing a lawyer:** what counts as verifiable parental consent under DPDP;
whether 30 days is defensible for recordings of children; and the external escalation threshold
(when a report goes to police, and who decides). §§4–9 and §13 do not wait on these.

## 7. Debts recorded, not silently carried (CLAUDE.md §"Fix quality")

- **Database-level consent enforcement.** The guard is application-layer only. A DB predicate
  (RLS/CHECK on `sessions` requiring a current `consent_version`) was deferred to plan 2 because
  it needs a migration and two were already unapplied. **This is the most important debt here.**
- **`signUpTutor` overwrites `record_consent`'s DB-stamped `profiles.consent_accepted_at`** with a
  JS timestamp immediately after the RPC ran. Both are server-generated and `consent_events` is
  untouched, so it is redundancy rather than a hole — but it violates the one-write-path
  principle. Fix next time that file is opened.
- **`validation.ts:104,126` checks consent by presence, not value**, inconsistent with
  `acceptConsent`'s stricter `!== "yes"`.
- **The 90-day `notification_events` retention has no sweep.** `/privacy` now says so honestly
  rather than stating it as fact — but the sweep is still owed.
- **The "financial records" retention promise in spec §8 is aspirational.** No soft-delete or
  carve-out exists, so an account deletion removes those rows immediately. `/privacy` describes
  the real behaviour.
- Verified *not* debts, though they look like it: `/api/devices` POST has no role check because
  `0009`'s `register_device` raises in SQL; `completeSession` has no participant filter because
  `0002`'s RLS policy already scopes it.

## 8. What to pick up next

1. **Plan 2 — vetting + escalation** (spec §§10, 12). Not written yet. Migrations `0020` (vetting
   state, `available_teachers` returns only `cleared`) and `0021` (the auto-suspend trigger,
   `report_reviews`). **Also carries the report rate limit**, which stopped being optional the
   moment a report started auto-suspending a teacher: the endpoint is now a way to remove a
   teacher at will, bounded only by RLS participation. One auto-suspension per reporter per
   teacher.
2. **Plan 3 — recording** (spec §11). Not written yet. Five things move together: the Daily room
   property, the payment notice, `terms/page.tsx`'s no-recording clause, a `CONSENT_VERSION` bump
   with everyone re-consenting, and `/privacy`'s "sessions are not recorded" line.
3. **The marketing-surface redesign — unfinished cycle-1 scope, not cycle-4 polish.** Measured
   this session: `/sessions` and `/dashboard` carry 2 hardcoded colour references each; `/` has
   31, `/terms` 33, the signup form 9. The design system shipped and was applied to the product
   surface only. Cycle 1's stated scope was "every screen", and the question of whether that
   included the marketing pages was never answered. Roughly four pages of applying a language
   that already exists. **The user deferred this deliberately when offered mid-session.**
4. **Step 11 of the cycle-2 walk** — the decline case. Still the only part of cycle 2 with no
   execution evidence. ~5 minutes.
5. **A real `apple-touch-icon`** and app icons — still the placeholders from `6694ca7`.

## 9. Gotchas added this session

The eight from the previous handoff still hold. Four more:

- **`create or replace function` silently drops what you omit.** Diff against the live body first
  (`select prosrc from pg_proc where proname = '…'`). §4 item 1.
- **A page-level auth guard does not cover server actions.** They execute before rendering, from
  an app-wide manifest, with IDs readable from public chunks. §4 item 2.
- **`currentPath()` returns pathname *plus query string*.** Any path-exemption check must compare
  pathname only, or the exemption silently breaks the moment someone links `/consent?next=…`.
- **`taxonomy.ts` already owns the grade domain.** It exports `GRADES` / `Grade` / `isGrade` and
  is a true leaf. Do not create a second list — one was written and removed on this branch.

## 10. Where the execution record lives

`.superpowers/sdd/2026-09-04-guardian-consent-and-privacy/progress.md` — the SDD ledger: the
pre-flight conflict table, all ten rulings with what each costs if wrong, every deferred minor,
and per-task commit ranges. **It is git-ignored and will not survive `git clean -fdx`.** Everything
load-bearing from it is reproduced above; the ledger has the detail.
