# Guardian Consent and Privacy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the account holder the child's guardian, record consent as evidence that survives
a version bump, and publish the privacy policy the signup form already claims exists.

**Architecture:** Consent stops being two columns on `profiles` and becomes an append-only
`consent_events` log written in SQL, so no entry path can bypass it. A single gate in
`requireUser()` blocks every authenticated page until a consent row exists — which closes the
Google hole and any future signup path at the same chokepoint, rather than patching each one.

**Tech Stack:** Next.js App Router, Supabase Postgres + Auth, TypeScript, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-04-child-safety-and-consent-design.md`

## Global Constraints

- **This is plan 1 of 3.** Plan 2 is vetting + escalation (spec §§10, 12); plan 3 is recording
  (§11). Do not implement those here. In particular **do not touch `terms/page.tsx:186`** — the
  no-recording clause is correct until plan 3 ships, and the spec requires its five changes to
  move together.
- **Migrations are applied by hand in the Supabase SQL editor. Strip `begin;`/`commit;` before
  pasting.** `0013` silently rolled back with them and every verification count returned `0`
  with no error. Keep them in the file; remove them only in the paste.
- **`revoke ... from public` does NOT remove a named role's grant.** Supabase grants EXECUTE and
  SELECT to `anon` and `authenticated` **by name**. Always revoke from both explicitly. `0012`
  shipped this bug to production.
- **A `"use server"` file may only export async functions.** A `const` export there empties the
  module and every import fails. `tsc` does not catch it — only `npm run build` does.
- **`CONSENT_VERSION` moves to `src/lib/consent.ts` and becomes `"2026-09-05-guardian"`**
  (currently `"2026-09-04"` in `src/lib/validation.ts:77`). **The move is not cosmetic:** leaving
  it in `validation.ts` while `validation.ts` imports `isGrade` from `consent.ts` creates a
  circular import between the two modules. Every existing import site changes to
  `@/lib/consent` — `src/app/auth/actions.ts`, `src/app/(marketing)/tutor-signup/actions.ts`,
  and their tests. Any distinct version string works; the rule is that it changes whenever the
  wording changes materially.
- **Gates before every commit:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .` (0 problems,
  warnings included), `npm run build`. Baseline is 263 passing / 3 skipped.
- **The local dotenv file is guarded.** A `PreToolUse` hook blocks any shell command naming it.
  Scripts that read it at runtime work fine; never `cat` it or name its path in a command.
- Do not push. Commit locally; the human decides when production deploys.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0018_guardian_account.sql` | Learner fields on `profiles`; `enforce_session_insert` snapshots the learner's name |
| `supabase/migrations/0019_consent_events.sql` | Append-only consent log, `record_consent()` RPC, `handle_new_user` writes the signup row |
| `src/lib/validation.ts` | Parsers require the learner fields |
| `src/lib/consent.ts` | **New.** `CONSENT_VERSION`, the grade domain, and the one place that decides "has this account consented?" |
| `src/app/auth/actions.ts` | Student signup passes learner metadata |
| `src/app/(marketing)/signup/signup-form.tsx` | Collects learner name + grade; new consent copy |
| `src/lib/auth.ts` | `requireUser()` gates on consent |
| `src/app/(app)/consent/page.tsx` | **New.** The interstitial for accounts with no consent row |
| `src/app/(app)/consent/actions.ts` | **New.** Records consent via the RPC |
| `src/app/(marketing)/privacy/page.tsx` | **New.** The privacy policy |
| `src/app/(marketing)/terms/page.tsx` | Refund policy; Tutor Agreement section |
| `scripts/probe-consent.mjs` | **New.** Proves the RPC and the revokes against the live database |

---

### Task 1: Migration 0018 — the learner on the account

**Files:**
- Create: `supabase/migrations/0018_guardian_account.sql`
- Test: applied by hand, verified by the counts in Step 3

**Interfaces:**
- Produces: `profiles.learner_first_name text`, `profiles.learner_grade text`,
  `profiles.guardian_phone_verified_at timestamptz`. `sessions.student_name` now receives
  `learner_first_name` when set.

- [ ] **Step 1: Write the migration**

```sql
-- The account holder is the guardian; the learner is recorded on their profile.
-- Spec §4. sessions.grade has been constrained to '6th'..'12th' since 0002, so
-- every student on this platform is a minor by construction and there is no
-- adult-learner case to branch on.
begin;

alter table public.profiles
  add column if not exists learner_first_name text,
  -- Same domain as sessions.grade (0002) and teacher_subjects.grade (0001).
  -- Restated rather than referenced: a check constraint cannot point at
  -- another table's, and this is the third copy of one rule, which is the
  -- price of keeping the database the thing that enforces it.
  add column if not exists learner_grade text
    check (learner_grade is null or learner_grade in
      ('6th','7th','8th','9th','10th','11th','12th')),
  -- Stamped when the guardian's phone is verified: by operator call for the
  -- pilot, by OTP later (spec §5). The column does not care which.
  add column if not exists guardian_phone_verified_at timestamptz;

-- 0004 snapshotted the account holder's full_name into sessions.student_name so
-- a teacher would see something other than "A student" -- the profiles SELECT
-- policy from 0001 returns zero rows when a teacher reads a student's profile.
-- That reasoning is unchanged and so is the mechanism: written by the trigger,
-- never by the caller, so it cannot be forged. It just snapshots the right name
-- now. coalesce keeps every pre-existing account working unchanged.
create or replace function public.enforce_session_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text;
begin
  select coalesce(nullif(learner_first_name, ''), full_name)
    into v_name
    from public.profiles
   where id = new.student_id;

  new.student_name := v_name;
  return new;
end;
$fn$;

commit;
```

> ⚠ `enforce_session_insert` exists already (`0004`, amended since). **Open
> `supabase/migrations/0004_session_student_name.sql` and any later migration that redefines it,
> and carry every other rule it enforces into this body before replacing it.** `create or replace`
> silently drops whatever you omit. If the current body does more than set `student_name`, this
> step is wrong as written and must be widened.

- [ ] **Step 2: Verify the current function body before replacing it**

Run: `grep -rn "enforce_session_insert" supabase/migrations/`
Read every hit. Merge all existing rules into the body above. Do not proceed until the new body
is a superset of the old one.

- [ ] **Step 3: Apply and verify**

Paste into the Supabase SQL editor **with `begin;` and `commit;` removed**, then run:

```sql
select count(*) from information_schema.columns
 where table_name = 'profiles'
   and column_name in ('learner_first_name','learner_grade','guardian_phone_verified_at');
-- expect 3
```

Expected: `3`. If it returns `0`, the transaction rolled back — you left `begin;`/`commit;` in.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0018_guardian_account.sql
git commit -m "feat(db): record the learner on the guardian's profile (0018)"
```

---

### Task 2: Migration 0019 — consent as an append-only log

**Files:**
- Create: `supabase/migrations/0019_consent_events.sql`

**Interfaces:**
- Produces: table `public.consent_events`; function
  `public.record_consent(p_version text, p_path text, p_detail text default null) returns void`.
  `handle_new_user` inserts a `consent_events` row when signup metadata carries consent.

- [ ] **Step 1: Write the migration**

```sql
-- Spec §6. Two columns on profiles cannot answer "what did this family agree
-- to, and when, and how was it obtained" after a version bump -- the previous
-- agreement is overwritten. That is the question that matters if anything ever
-- goes wrong, so the record becomes its own append-only log, following the
-- notification_events precedent (0015).
begin;

create table if not exists public.consent_events (
  id            uuid primary key default gen_random_uuid(),
  -- set null, not cascade: deleting an account must not erase the record that
  -- consent was given, for the same reason notification_events keeps its rows.
  user_id       uuid references public.profiles (id) on delete set null,
  version       text not null,
  path          text not null check (path in (
                  'student_signup','tutor_signup','google_interstitial',
                  'reconsent','operator_verified')),
  accepted_at   timestamptz not null default now(),
  -- 0017's lesson: a report that destroyed its own evidence when the teacher
  -- was deleted was useless. A consent row whose user_id has gone null records
  -- that SOMEBODY agreed. The snapshot is what keeps it answering "who".
  subject_email text not null,
  detail        text
);

create index if not exists consent_events_user_idx
  on public.consent_events (user_id, accepted_at desc);

alter table public.consent_events enable row level security;

-- No policy for anyone. Reads are service-role only, as session_reports is
-- (0017), and there is no insert policy because every write goes through the
-- security definer function below. RLS with no policy denies everything.
--
-- The revoke names anon and authenticated EXPLICITLY. `from public` does not
-- remove a role's own grant, which is the bug 0012 shipped.
revoke all on public.consent_events from anon, authenticated;

-- The one write path. Stamps now() and auth.uid() in SQL, so a client cannot
-- forge either -- the discipline become_teacher (0013) established: the rule is
-- enforced in the database for every caller, not only the path the app takes.
create or replace function public.record_consent(
  p_version text,
  p_path    text,
  p_detail  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select email into v_email from public.profiles where id = v_uid;
  if v_email is null then
    raise exception 'no profile for this account';
  end if;

  insert into public.consent_events (user_id, version, path, subject_email, detail)
  values (v_uid, p_version, p_path, v_email, p_detail);

  -- profiles keeps the latest value as a convenience for reads; the log above
  -- is the record.
  update public.profiles
     set consent_accepted_at = now(),
         consent_version     = p_version
   where id = v_uid;
end;
$fn$;

revoke all on function public.record_consent(text, text, text) from public;
revoke all on function public.record_consent(text, text, text) from anon;
grant execute on function public.record_consent(text, text, text) to authenticated;

-- A brand-new signup has no session yet when the row must be written, so
-- handle_new_user writes it in the same transaction that creates the profile.
-- Unchanged from 0014 except for that insert: metadata is still client
-- controlled, so only these values are ever honoured.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $fn$
declare
  v_consent_at timestamptz := (new.raw_user_meta_data ->> 'consent_accepted_at')::timestamptz;
  v_version    text        := nullif(new.raw_user_meta_data ->> 'consent_version', '');
  v_role       text        := case when new.raw_user_meta_data ->> 'role' = 'teacher'
                                   then 'teacher' else 'student' end;
begin
  insert into public.profiles (
    id, role, full_name, email, phone,
    consent_accepted_at, consent_version,
    learner_first_name, learner_grade
  )
  values (
    new.id,
    v_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    v_consent_at,
    v_version,
    nullif(new.raw_user_meta_data ->> 'learner_first_name', ''),
    nullif(new.raw_user_meta_data ->> 'learner_grade', '')
  );

  if v_consent_at is not null and v_version is not null then
    insert into public.consent_events (user_id, version, path, accepted_at, subject_email)
    values (
      new.id,
      v_version,
      case when v_role = 'teacher' then 'tutor_signup' else 'student_signup' end,
      v_consent_at,
      coalesce(new.email, '')
    );
  end if;

  return new;
end;
$fn$;

commit;
```

- [ ] **Step 2: Apply and verify**

Paste with `begin;`/`commit;` removed. Then:

```sql
select count(*) from information_schema.tables where table_name = 'consent_events';
-- expect 1
select has_function_privilege('authenticated', 'public.record_consent(text,text,text)', 'execute');
-- expect true
select has_table_privilege('authenticated', 'public.consent_events', 'select');
-- expect false  <- this is the 0012 bug; if it is true the revoke did not name the role
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0019_consent_events.sql
git commit -m "feat(db): consent becomes an append-only log with one write path (0019)"
```

---

### Task 3: The learner fields are required at signup

**Files:**
- Create: `src/lib/consent.ts`
- Modify: `src/lib/validation.ts` (`StudentSignUp`, `parseStudentSignUp`; `CONSENT_VERSION` moves out)
- Test: `src/lib/validation.test.ts`

**Interfaces:**
- Produces: `GRADES` (readonly string tuple), `type Grade`, `isGrade(value)` and
  `CONSENT_VERSION` from `src/lib/consent.ts`; `StudentSignUp` gains `learnerFirstName: string`
  and `learnerGrade: Grade`.
- **Import direction is one-way: `validation.ts` → `consent.ts`, never back.** `consent.ts` must
  import nothing from `validation.ts`.

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe("parseStudentSignUp", ...)` block in
`src/lib/validation.test.ts`. Note the existing `fd()` helper at the top of the file.

```typescript
  it("requires the learner's first name", () => {
    const r = parseStudentSignUp(
      fd({
        fullName: "Asha",
        email: "a@b.com",
        password: "secret123",
        confirmPassword: "secret123",
        consent: "yes",
        learnerGrade: "9th",
      })
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/student/i);
  });

  it("rejects a grade outside 6th-12th", () => {
    const r = parseStudentSignUp(
      fd({
        fullName: "Asha",
        email: "a@b.com",
        password: "secret123",
        confirmPassword: "secret123",
        consent: "yes",
        learnerFirstName: "Ravi",
        learnerGrade: "1st",
      })
    );
    expect(r.ok).toBe(false);
  });

  it("returns the learner fields on success", () => {
    const r = parseStudentSignUp(
      fd({
        fullName: "Asha",
        email: "a@b.com",
        password: "secret123",
        confirmPassword: "secret123",
        consent: "yes",
        learnerFirstName: " Ravi ",
        learnerGrade: "9th",
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.learnerFirstName).toBe("Ravi");
      expect(r.value.learnerGrade).toBe("9th");
    }
  });
```

The existing test `"accepts valid input and trims name"` will now fail too, because its FormData
carries no learner fields. **That is correct** — update it by adding
`learnerFirstName: "Ravi", learnerGrade: "9th"` to its `fd({...})`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/validation.test.ts`
Expected: FAIL — `expected true to be false` on the first two, and `undefined` for the learner
fields on the third.

- [ ] **Step 3: Create `src/lib/consent.ts`**

```typescript
// The grade domain, in one place. The database states it three times already
// (sessions 0002, teacher_subjects 0001, profiles 0018) because a check
// constraint cannot reference another table's; this is the TypeScript copy the
// forms and parsers share, so there is exactly one more and not five.
export const GRADES = [
  "6th", "7th", "8th", "9th", "10th", "11th", "12th",
] as const;

export type Grade = (typeof GRADES)[number];

export function isGrade(value: string): value is Grade {
  return (GRADES as readonly string[]).includes(value);
}

// Bump when the consent wording changes materially, so an old agreement is
// never silently read as agreement to new terms. "2026-09-05-guardian" is the
// guardian rewrite: the holder is now the parent or legal guardian, not
// "parent OR 18+".
//
// Lives here rather than in validation.ts because validation.ts imports
// isGrade from this module; putting the constant there too would make the two
// files import each other.
export const CONSENT_VERSION = "2026-09-05-guardian";
```

- [ ] **Step 4: Implement in `src/lib/validation.ts`**

**Delete** the `CONSENT_VERSION` declaration at line 77 — it now lives in `consent.ts` (Step 3).
Re-point the two import sites that use it:

```typescript
// src/app/auth/actions.ts
import { parseSignIn, parseStudentSignUp } from "@/lib/validation";
import { CONSENT_VERSION } from "@/lib/consent";

// src/app/(marketing)/tutor-signup/actions.ts
import { parseTutorSignUp } from "@/lib/validation";
import { CONSENT_VERSION } from "@/lib/consent";
```

and the same in `src/app/(marketing)/tutor-signup/actions.test.ts`, which imports it today.

Extend the interface:

```typescript
export interface StudentSignUp {
  fullName: string;
  email: string;
  password: string;
  learnerFirstName: string;
  learnerGrade: Grade;
}
```

Add `import { isGrade, type Grade } from "./consent";` at the top, and extend the parser. Place
the new checks **after** the password checks and **before** the consent check, so the consent
message stays the last thing a nearly-complete form complains about:

```typescript
  const learnerFirstName = str(fd, "learnerFirstName");
  if (!learnerFirstName) return fail("Enter the student's first name.");

  const learnerGrade = str(fd, "learnerGrade");
  if (!isGrade(learnerGrade)) return fail("Select the student's grade.");
```

and return them:

```typescript
  return {
    ok: true,
    value: { fullName, email, password, learnerFirstName, learnerGrade },
  };
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/lib/validation.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Full gates**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npm run build`
Expected: all green. `tsc` will flag `src/app/auth/actions.ts` if it destructures
`parsed.value` — that is Task 4's job; if it errors here, do Task 4 before committing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/consent.ts src/lib/validation.ts src/lib/validation.test.ts
git commit -m "feat(signup): the learner is a first-class field, and consent versions bump"
```

---

### Task 4: Student signup collects and records the learner

**Files:**
- Modify: `src/app/auth/actions.ts` (`signUpStudent`)
- Modify: `src/app/(marketing)/signup/signup-form.tsx`
- Test: `src/app/auth/actions.test.ts` (exists)

**Interfaces:**
- Consumes: `StudentSignUp.learnerFirstName`, `.learnerGrade`, `CONSENT_VERSION` from Task 3.
- Produces: signup metadata carrying `learner_first_name` / `learner_grade`, which
  `handle_new_user` (Task 2) copies onto the profile and into `consent_events`.

- [ ] **Step 1: Write the failing test**

`src/app/auth/actions.test.ts` already mocks the Supabase client. Follow its existing pattern
(read the file first; mirror how it captures calls — `src/app/(marketing)/tutor-signup/actions.test.ts`
captures `auth.signUp` args into a hoisted `state.signUpCalls`, and the same shape works here).

```typescript
it("passes the learner fields into signup metadata", async () => {
  const fd = new FormData();
  fd.set("fullName", "Asha Rao");
  fd.set("email", "asha@example.com");
  fd.set("password", "password123");
  fd.set("confirmPassword", "password123");
  fd.set("consent", "yes");
  fd.set("learnerFirstName", "Ravi");
  fd.set("learnerGrade", "9th");

  await expect(signUpStudent(null, fd)).rejects.toThrow("NEXT_REDIRECT");

  const meta = state.signUpCalls[0].options?.data ?? {};
  expect(meta.learner_first_name).toBe("Ravi");
  expect(meta.learner_grade).toBe("9th");
  expect(meta.consent_version).toBe(CONSENT_VERSION);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/auth/actions.test.ts`
Expected: FAIL — `expected undefined to be "Ravi"`.

- [ ] **Step 3: Implement**

In `src/app/auth/actions.ts`, extend the destructure and the metadata:

```typescript
  const { email, password, fullName, learnerFirstName, learnerGrade } = parsed.value;

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        role: "student",
        full_name: fullName,
        // Stamped server-side: the client says WHETHER they agreed, the
        // server says WHEN. handle_new_user copies both onto the profile AND
        // writes the consent_events row, in one transaction (0019).
        consent_accepted_at: new Date().toISOString(),
        consent_version: CONSENT_VERSION,
        learner_first_name: learnerFirstName,
        learner_grade: learnerGrade,
      },
    },
  });
```

- [ ] **Step 4: Add the form fields**

In `src/app/(marketing)/signup/signup-form.tsx`, after the Full Name block and before Email, add
a section that makes the two people distinct. Import `GRADES` from `@/lib/consent`. Relabel the
existing Full Name field to `Your Full Name (parent or guardian)`.

```tsx
        <div className="space-y-2">
          <Label htmlFor="signup-learnerFirstName">Student&apos;s First Name</Label>
          <Input
            id="signup-learnerFirstName"
            type="text"
            name="learnerFirstName"
            required
            placeholder="The name their tutor will see"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-learnerGrade">Student&apos;s Grade</Label>
          <select
            id="signup-learnerGrade"
            name="learnerGrade"
            required
            defaultValue=""
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
          >
            <option value="" disabled>
              Select a grade
            </option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
```

- [ ] **Step 5: Replace the consent copy**

The current text offers a choice the product cannot honour — every student is in grades 6–12
(spec §2). Replace the `<span>` contents at `signup-form.tsx:96` (keep the `name="consent"`
input and its comment exactly as they are):

```tsx
          <span className="text-sm text-gray-600">
            I am this student&apos;s parent or legal guardian, and I agree to the{" "}
            <Link href="/terms" className="text-teal-600 hover:text-teal-700 underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-teal-600 hover:text-teal-700 underline">
              Privacy Policy
            </Link>
          </span>
```

Note the second link now points at `/privacy`, which Task 7 creates. Do Task 7 before deploying.

- [ ] **Step 6: Run tests and gates**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/app/auth/actions.ts src/app/auth/actions.test.ts "src/app/(marketing)/signup/signup-form.tsx"
git commit -m "feat(signup): the guardian holds the account and names the student"
```

---

### Task 5: Tutor signup records through the RPC

**Files:**
- Modify: `src/app/(marketing)/tutor-signup/actions.ts`
- Test: `src/app/(marketing)/tutor-signup/actions.test.ts`

**Interfaces:**
- Consumes: `record_consent(p_version, p_path, p_detail)` from Task 2.

Teacher consent currently lands via signup metadata (new account) and a profile update (Google
upgrade). The metadata path now also writes `consent_events` via `handle_new_user`. **The Google
upgrade path still writes nothing to the log** — `handle_new_user` ran for that account long ago,
as a student.

- [ ] **Step 1: Write the failing test**

The existing mock already captures `state.rpcCalls`. Add to
`describe("signUpTutor — consent is recorded, not just required", ...)`:

```typescript
  it("logs a consent event when a Google account upgrades", async () => {
    await expect(signUpTutor(null, validTutorFormData())).rejects.toThrow("NEXT_REDIRECT");

    const call = state.rpcCalls.find((c) => c.fn === "record_consent");
    expect(call).toBeDefined();
    expect(call!.args).toEqual({
      p_version: CONSENT_VERSION,
      p_path: "tutor_signup",
      p_detail: null,
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run "src/app/(marketing)/tutor-signup/actions.test.ts"`
Expected: FAIL — `expected undefined to be defined`.

- [ ] **Step 3: Implement**

In `src/app/(marketing)/tutor-signup/actions.ts`, immediately after the `become_teacher` RPC
succeeds and `teacherId = existingUser.id;` is set, add:

```typescript
    // handle_new_user wrote this account's profile long ago, as a student, and
    // Google sends no consent -- so nothing has logged the agreement this form
    // just collected. The RPC stamps auth.uid() and now() in SQL (0019).
    const { error: consentError } = await supabase.rpc("record_consent", {
      p_version: CONSENT_VERSION,
      p_path: "tutor_signup",
      p_detail: null,
    });
    if (consentError) {
      console.error("[tutorSignUp] consent log failed", consentError);
      return { error: "Could not record your agreement. Try again in a moment." };
    }
```

Fail closed: an unrecorded agreement is the thing this whole plan exists to prevent.

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npm run build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(marketing)/tutor-signup/actions.ts" "src/app/(marketing)/tutor-signup/actions.test.ts"
git commit -m "feat(consent): the Google teacher upgrade logs its agreement too"
```

---

### Task 6: One gate, every entry path

**Files:**
- Modify: `src/lib/consent.ts` (add `needsConsent`)
- Modify: `src/lib/auth.ts` (`Identity`, `getIdentity`, `requireUser`)
- Create: `src/app/(app)/consent/page.tsx`
- Create: `src/app/(app)/consent/actions.ts`
- Test: `src/lib/consent.test.ts`

**Interfaces:**
- Consumes: `record_consent` (Task 2), `GRADES` (Task 3).
- Produces: `Identity` gains `consentVersion: string | null`;
  `needsConsent(profile): boolean` in `src/lib/consent.ts`.

Spec §7 puts this in the OAuth callback. **Implement it in `requireUser()` instead.** The
callback covers only Google; `requireUser()` is the chokepoint every authenticated page already
passes through (`src/lib/auth.ts:54`), so one gate closes Google, email signup, and any path
added later. This is the spec's own argument — "consent must be one query every entry path asks"
— applied one level deeper.

- [ ] **Step 1: Write the failing test**

Create `src/lib/consent.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { needsConsent, CONSENT_VERSION } from "./consent";

describe("needsConsent", () => {
  // Google sign-in mints an account with consent_accepted_at NULL: OAuth
  // carries no consent and handle_new_user has none to copy. One tap, full
  // access, no agreement. This is the hole the gate exists to close.
  it("is true for an account that has never consented", () => {
    expect(needsConsent({ consentVersion: null })).toBe(true);
  });

  it("is false for an account on the current version", () => {
    expect(needsConsent({ consentVersion: CONSENT_VERSION })).toBe(false);
  });

  // A material change to the wording is a NEW agreement. An old version must
  // never be read as consent to it -- which is the whole reason the column
  // holds a version rather than a boolean.
  it("is true for an account on a superseded version", () => {
    expect(needsConsent({ consentVersion: "2026-09-04" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/consent.test.ts`
Expected: FAIL — `needsConsent is not a function`.

- [ ] **Step 3: Implement `needsConsent`**

Append to `src/lib/consent.ts` (no import needed — `CONSENT_VERSION` is in this file):

```typescript
// The one question every entry path asks. A version rather than a boolean,
// because a material change to the wording is a new agreement and an old one
// must not be silently read as consent to it.
export function needsConsent(profile: { consentVersion: string | null }): boolean {
  return profile.consentVersion !== CONSENT_VERSION;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/consent.test.ts`
Expected: PASS.

- [ ] **Step 5: Carry the version through `Identity`**

In `src/lib/auth.ts`: add `consentVersion: string | null;` to `Identity`; add
`consent_version` to the `.select(...)` at line 27; return
`consentVersion: profile.consent_version as string | null` from `getIdentity`.

Then gate in `requireUser`:

```typescript
export async function requireUser(): Promise<Identity> {
  const identity = await getIdentity();
  if (!identity) redirect(signInRedirect(await currentPath()));
  // Every authenticated page passes through here, so this is the only place
  // the question has to be asked. Spec §7 names the OAuth callback; that would
  // close Google alone and leave the next entry path to remember on its own.
  if (needsConsent(identity) && (await currentPath()) !== "/consent") {
    redirect("/consent");
  }
  return identity;
}
```

Import `needsConsent` from `@/lib/consent`.

> ⚠ `/consent` itself calls `requireUser()`, so without the path check this is an infinite
> redirect. Verify by loading `/consent` in Step 8.

- [ ] **Step 5b: Test the gate itself, not just the predicate**

`needsConsent` being correct does not prove `requireUser` uses it. Create `src/lib/auth.test.ts`.
Mock the way `tutor-signup/actions.test.ts` does — `redirect` throws, so the redirect target is
observable:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | Record<string, unknown>,
  pathname: "/sessions",
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-pathname", state.pathname]]),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: state.profile, error: null }) }),
      }),
    }),
  }),
}));

import { requireUser } from "./auth";
import { CONSENT_VERSION } from "./consent";

beforeEach(() => {
  state.user = { id: "u1" };
  state.pathname = "/sessions";
  state.profile = {
    id: "u1", role: "student", full_name: "Asha", consent_version: CONSENT_VERSION,
  };
});

describe("requireUser consent gate", () => {
  // The live hole: Google sign-in mints an account with no consent at all.
  it("sends an account with no consent to /consent", async () => {
    state.profile = { id: "u1", role: "student", full_name: "Asha", consent_version: null };
    await expect(requireUser()).rejects.toMatchObject({ to: "/consent" });
  });

  it("sends an account on a superseded version to /consent", async () => {
    state.profile = { id: "u1", role: "student", full_name: "Asha", consent_version: "2026-09-04" };
    await expect(requireUser()).rejects.toMatchObject({ to: "/consent" });
  });

  it("lets a consented account through", async () => {
    await expect(requireUser()).resolves.toMatchObject({ userId: "u1" });
  });

  // Without this the gate redirects /consent to itself, forever.
  it("does not redirect /consent to itself", async () => {
    state.profile = { id: "u1", role: "student", full_name: "Asha", consent_version: null };
    state.pathname = "/consent";
    await expect(requireUser()).resolves.toMatchObject({ userId: "u1" });
  });
});
```

Run: `npx vitest run src/lib/auth.test.ts`
Expected: PASS all four. If the loop test fails, Step 5's path check is missing or wrong.

**Note:** `getIdentity` is wrapped in React's `cache()`, which memoises per request. If results
leak between tests, call `vi.resetModules()` in `beforeEach` and re-import.

- [ ] **Step 6: Build the interstitial action**

Create `src/app/(app)/consent/actions.ts`:

```typescript
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { CONSENT_VERSION, isGrade } from "@/lib/consent";
import { resolveHome } from "@/lib/routes";
import type { AuthState } from "@/lib/form-state";

export async function acceptConsent(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const identity = await requireUser();

  if (!formData.get("consent")) {
    return { error: "Please confirm you are the student's parent or legal guardian." };
  }

  const supabase = await createClient();

  // Teachers reach this page after a terms change; they have no learner.
  if (identity.role === "student") {
    const learnerFirstName = (formData.get("learnerFirstName") ?? "").toString().trim();
    const learnerGrade = (formData.get("learnerGrade") ?? "").toString().trim();
    if (!learnerFirstName) return { error: "Enter the student's first name." };
    if (!isGrade(learnerGrade)) return { error: "Select the student's grade." };

    const { error } = await supabase
      .from("profiles")
      .update({ learner_first_name: learnerFirstName, learner_grade: learnerGrade })
      .eq("id", identity.userId);
    if (error) return { error: "Could not save the student's details. Try again." };
  }

  const { error: consentError } = await supabase.rpc("record_consent", {
    p_version: CONSENT_VERSION,
    p_path: "google_interstitial",
    p_detail: null,
  });
  if (consentError) {
    console.error("[acceptConsent] consent log failed", consentError);
    return { error: "Could not record your agreement. Try again in a moment." };
  }

  redirect(resolveHome(identity.role));
}
```

- [ ] **Step 7: Build the interstitial page**

Two files: a server page that reads the role, and a client form. Split because
`useActionState` needs `"use client"` and `requireUser()` needs the server.

`src/app/(app)/consent/page.tsx`:

```tsx
import { requireUser } from "@/lib/auth";
import { ConsentForm } from "./consent-form";

export default async function ConsentPage() {
  // Safe despite the gate: requireUser exempts /consent from its own redirect.
  const identity = await requireUser();
  return (
    <div className="min-h-screen bg-gray-50 px-8 py-12">
      <div className="max-w-lg mx-auto bg-white rounded-2xl shadow-sm p-8 border border-gray-100">
        <ConsentForm role={identity.role} />
      </div>
    </div>
  );
}
```

`src/app/(app)/consent/consent-form.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { acceptConsent } from "./actions";
import { FormError } from "@/components/form-error";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GRADES } from "@/lib/consent";
import type { Role } from "@/lib/routes";

export function ConsentForm({ role }: { role: Role }) {
  const [state, formAction, isPending] = useActionState(acceptConsent, null);

  return (
    <>
      <PageHeader
        as="h1"
        title="One more thing"
        description="We need a parent or guardian's agreement before lessons can start."
      />

      <form action={formAction} className="space-y-4 mt-6">
        {role === "student" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="consent-learnerFirstName">Student&apos;s First Name</Label>
              <Input
                id="consent-learnerFirstName"
                type="text"
                name="learnerFirstName"
                required
                placeholder="The name their tutor will see"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="consent-learnerGrade">Student&apos;s Grade</Label>
              <select
                id="consent-learnerGrade"
                name="learnerGrade"
                required
                defaultValue=""
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              >
                <option value="" disabled>
                  Select a grade
                </option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        <div className="flex items-start">
          {/* name="consent" matters: without it this never reaches the server
              and `required` is browser-only decoration. Validated again in
              acceptConsent. */}
          <input type="checkbox" name="consent" value="yes" required className="mt-1 mr-2" />
          <span className="text-sm text-gray-600">
            {role === "student"
              ? "I am this student's parent or legal guardian, and I agree to the "
              : "I agree to the "}
            <Link href="/terms" className="text-teal-600 hover:text-teal-700 underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-teal-600 hover:text-teal-700 underline">
              Privacy Policy
            </Link>
          </span>
        </div>

        {state?.error && <FormError>{state.error}</FormError>}

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Saving…" : "Agree and continue"}
        </Button>
      </form>
    </>
  );
}
```

**No navigation off this page except the two policy links** — it is a gate, not a step. Do not
render the app shell's nav here if the `(app)` layout provides one; if it does, either move this
route outside that layout or hide the nav for it.

- [ ] **Step 8: Verify the gate by hand**

Run: `npm run dev`, then sign in with a Google account that has never consented.
Expected: any URL you try lands on `/consent`; `/consent` itself renders without looping;
submitting redirects to `/sessions`; and signing in again goes straight through.

- [ ] **Step 9: Gates and commit**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npm run build`

```bash
git add src/lib/consent.ts src/lib/consent.test.ts src/lib/auth.ts "src/app/(app)/consent"
git commit -m "feat(consent): one gate in requireUser, so no entry path can bypass it"
```

---

### Task 7: `/privacy`

**Files:**
- Create: `src/app/(marketing)/privacy/page.tsx`
- Modify: `src/app/(marketing)/tutor-signup/tutor-form.tsx` (add a privacy link)

**Interfaces:** none consumed; `signup-form.tsx` (Task 4) already links here.

- [ ] **Step 1: Write the page**

Mirror `src/app/(marketing)/terms/page.tsx` exactly. Read it first; this is its shell:

```tsx
import { PageHeader } from "@/components/page-header";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <main className="px-8 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-sm p-12 border border-gray-100">
            <PageHeader
              title="Privacy Policy"
              description="Last updated: September 5, 2026"
            />

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Who holds the account
              </h2>
              <p className="text-gray-700">
                An account on SMB Tutorial is held by a student&apos;s parent or
                legal guardian. The student is named on the account so their
                tutor knows who they are teaching; the student does not have a
                login of their own.
              </p>
            </section>

            {/* … one <section> per numbered item below, same shape … */}

            <section className="bg-teal-50 rounded-xl p-6 mt-8">
              <h3 className="text-lg font-bold text-gray-900 mb-2">
                Questions, or want your data deleted?
              </h3>
              <p className="text-gray-900">
                <a
                  href="mailto:support@smbtutorial.com"
                  className="text-teal-600 hover:text-teal-700 font-semibold"
                >
                  support@smbtutorial.com
                </a>
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
```

Use the same `<table>` markup the spec §8 inventory implies — or a `<ul>` if a table reads badly
at mobile width; `/terms` uses lists throughout, so lists are the safer match. Content, from
spec §8:

1. **Who we are and how to reach us** — `support@smbtutorial.com`.
2. **Who holds the account** — the parent or legal guardian; the student is named on the account
   but does not have a login.
3. **What we collect**, as a table: guardian name/email/phone; student first name and grade;
   session records (subject, grade, timestamps, duration, rate); payment references and amounts;
   reports (reason and free text); consent events. For teachers additionally: qualification,
   experience, specialisation, rate, hours, bio, demo video URL, subjects, availability, device
   push endpoints and delivery outcomes.
4. **Who processes it** — Supabase (database and authentication), Daily.co (video), Razorpay
   (payments), Google (optional sign-in), Apple and Google push services (teacher devices only),
   Sentry (error reporting), Vercel (hosting).
5. **Sessions are not recorded.** ← True today. **Plan 3 changes this line and four others
   together; do not pre-empt it.**
6. **How long we keep things** — the retention table from spec §8: delivery diagnostics 90 days;
   session and payment records as long as financial-record requirements demand; consent records
   and reports indefinitely.
7. **Deletion, honestly** — what a deletion request removes, and what survives it: reports
   outlive the teacher they concern (`0017`), and a consent record outlives the account, keeping
   the email the consent was given under (`0019`). State this plainly; a deletion promise with an
   undisclosed exception is worse than an honest one.
8. **Children** — the platform serves students in grades 6–12, the guardian consents, and the
   guardian may withdraw consent at any time by contacting support.

- [ ] **Step 2: Add the missing tutor-side link**

`tutor-form.tsx` has no privacy link at all — its two links are Terms of Service and Tutor
Agreement. Teachers' data is in the inventory above, so add a third link to `/privacy` in the
same `<span>`.

- [ ] **Step 3: Verify every link resolves**

Run: `npm run dev`, then load `/privacy`, `/signup` and `/tutor-signup` and click every policy
link on each.
Expected: no 404s. Before this task, the "Privacy Policy" link on `/signup` went to `/terms`.

- [ ] **Step 4: Gates and commit**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npm run build`

```bash
git add "src/app/(marketing)/privacy" "src/app/(marketing)/tutor-signup/tutor-form.tsx"
git commit -m "feat(legal): publish the privacy policy the signup form already promised"
```

---

### Task 8: The refund policy and the Tutor Agreement

**Files:**
- Modify: `src/app/(marketing)/terms/page.tsx`

**⚠ This task needs a human decision before it is written.** The draft below is a proposal, not a
settled policy. Confirm it with the project owner and edit before implementing.

- [ ] **Step 1: Get the refund policy confirmed**

Proposed, replacing the placeholder at `terms/page.tsx:16-28`:

| Situation | Outcome |
|---|---|
| Tutor does not join | Full refund |
| Tutor joins more than 10 minutes late | Full refund if the student chooses to cancel |
| Student does not join | No refund — the tutor was present and available |
| Technical failure preventing the session | Full refund |
| Session ended early by the tutor for conduct | No refund (already stated at line 170) |
| Any refund | To the original payment method within 7 business days |

- [ ] **Step 2: Replace the placeholder section**

Write the confirmed table into the existing `Refund Policy` section, keeping the surrounding
markup and the `support@smbtutorial.com` link. Also fix the forward reference at
`terms/page.tsx:54` — "which is not yet published" is no longer true.

- [ ] **Step 3: Add the Tutor Agreement section**

`tutor-form.tsx` links to a "Tutor Agreement" that does not exist, and that link is now
load-bearing because tutor consent is required and recorded. Add a `Tutor Agreement` section to
`/terms` (the existing link points at `/terms`, so a section anchored there satisfies it), stating
spec §10's vetting requirements as binding obligations: government ID verified against the
account name, the conduct rules already on the page, and that a `conduct` report suspends the
account pending review.

> Plan 2 implements the suspension mechanism. Stating it here first is correct — the agreement
> must bind before the enforcement exists, not after.

- [ ] **Step 4: Gates and commit**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npm run build`

```bash
git add "src/app/(marketing)/terms/page.tsx"
git commit -m "feat(legal): publish the refund policy and the Tutor Agreement"
```

---

### Task 9: Prove it against the live database

**Files:**
- Create: `scripts/probe-consent.mjs`

**Interfaces:**
- Consumes: `record_consent` (Task 2), `consent_events` (Task 2).

Seven probes exist and all exit 0. Follow their shape exactly: read
`scripts/probe-session-reports.mjs` first — it is the closest analogue (a service-role-only table
with an explicit revoke). Reuse `readEnv` from `scripts/probe-accounts.mjs`; **do not hand-roll a
dotenv parser** — the values are quoted, and `probe-auth-providers.mjs` crashed for weeks because
its own copy did not strip them.

- [ ] **Step 1: Write the probe**

It must mint throwaway accounts, delete them in a `finally`, and assert:

1. **`record_consent` stamps the server clock.** Call it, read the row back with the service
   role, and assert `accepted_at` is within a few seconds of now — not any value the client sent.
2. **`record_consent` attributes to the caller.** The row's `user_id` is the calling account's id,
   with no user id passed as an argument.
3. **`consent_events` is unreadable with the anon key.** Expect an error or zero rows, never data.
4. **`consent_events` is unreadable by an authenticated user reading their own row.** This is the
   `0017` lesson: assert the revoke, not only the policy. A passing RLS policy and a missing
   revoke look identical until someone queries with a real session.
5. **`record_consent` refuses an unauthenticated caller** — anon key, no session, expect a raised
   exception.
6. **A session created by a guardian snapshots the learner's name.** Set `learner_first_name` on
   the throwaway student, create a session, and assert `sessions.student_name` is the learner's
   name and not the account holder's. This runs in a trigger (Task 1), so only a live probe
   proves it.

- [ ] **Step 2: Run it**

Run: `node scripts/probe-consent.mjs`
Expected: exit 0, every assertion reported.

- [ ] **Step 3: Re-run the other seven**

Run each of `probe-session-rls`, `probe-happy-path`, `reconcile-payments`, `probe-availability`,
`probe-role-guard`, `probe-session-reports`, `probe-auth-providers`.
Expected: all exit 0. **`probe-availability` false-positives if a real phone registers mid-run** —
it asserts `teacher_devices` returns to its starting count. Check whether an extra row is a real
device before treating it as a leak.

- [ ] **Step 4: Commit**

```bash
git add scripts/probe-consent.mjs
git commit -m "test(probe): prove the consent log's write path and both read controls"
```

---

## Done when

- [ ] `0018` and `0019` applied live; verification counts as stated in each task.
- [ ] A student signup names a guardian and a learner, and writes one `consent_events` row.
- [ ] A Google account with no consent cannot reach any authenticated page except `/consent`.
- [ ] `/privacy` exists and every policy link on `/signup` and `/tutor-signup` resolves.
- [ ] The refund policy is published and no longer says "not yet published".
- [ ] `probe-consent.mjs` exits 0, and so do the other seven.
- [ ] `npx vitest run` / `tsc --noEmit` / `eslint .` / `npm run build` all clean.

## Not in this plan

- **Teacher vetting state and `available_teachers` exclusion** — plan 2 (spec §10).
- **Auto-suspension, `report_reviews`, report rate limiting** — plan 2 (spec §12).
- **Recording, its retention sweep, and the five coupled changes** — plan 3 (spec §11).
- **Phone OTP.** The pilot verifies guardians by operator call, recorded as
  `consent_events.path = 'operator_verified'` (spec §5). The column and the RPC already accept
  it; no code is needed until OTP replaces the call.
- **Backfilling existing accounts.** There are two test accounts. The gate in Task 6 will send
  them through `/consent` on next sign-in, which is the correct behaviour and the cheapest
  possible migration.
