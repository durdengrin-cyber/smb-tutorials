# Teacher profile editing — implementation brief

**Date:** 2026-09-06 · **Status:** designed and approved by the owner, NOT started.
**Why it is here and not in `.superpowers/`:** that directory is git-ignored scratch and does not
survive a session. This is the next piece of work, so it lives in the repo.

**Goal:** a teacher can change their own rate, subjects and profile details after signup. Today they cannot: every field is written once by `signUpTutor` and never again, and `hourly_rate` is what students are charged.

**No migration.** Migration `0001` already ships `update own profile` on `profiles`, plus `teacher manages own subjects` (insert) and `teacher deletes own subjects` (delete) on `teacher_subjects`. There is no update policy on `teacher_subjects` — changing subjects is delete-then-insert, and the composite primary key makes duplicates impossible.

---

## 1. Validation — extract, do not duplicate

`src/lib/validation.ts` has `parseTutorSignUp`, which validates the account fields **and** the profile fields together. The profile half is what editing needs.

**Extract the shared half** into `parseTeacherProfileFields(fd)` returning the profile subset, and have BOTH `parseTutorSignUp` and the new `parseTeacherProfile(fd)` call it. Signup and editing must not be able to drift on what a valid rate or qualification is — that drift is the whole reason to extract rather than copy.

`parseTeacherProfile` validates, reusing the extracted helper:

| field | rule |
|---|---|
| `fullName` | non-empty |
| `phone` | `/^\d{10}$/` |
| `experience` | whole number ≥ 0 |
| `qualification` | non-empty |
| `specialization` | optional, `null` when blank |
| `teachingLevel` | optional; one of `TEACHING_LEVELS` |
| `hourlyRate` | whole number > 0 |
| `hoursPerWeek` | one of `HOURS_PER_WEEK` |
| `demoVideoUrl` | matches `/^https?:\/\//` |
| `bio` | **new**, optional, trimmed, max 1000 chars, `null` when blank |
| `curricula` / `grades` / `subjects` | same rules as signup; **at least one of each** |

It must NOT accept `email`, `password`, `consent` or `role`. Email is auth-managed; role is immutable by design (`0013`).

**A teacher must not be able to save zero subjects** — a teacher with none is invisible in search and has no way to find out why. Reject it with a message that says that.

Unit-test `parseTeacherProfile` directly in `src/lib/validation.test.ts`, following the existing tests there. Cover: each rejection, `bio` over the cap, `bio` blank → `null`, and zero subjects.

## 2. The route — `/profile`

Create `src/app/(app)/(teacher)/profile/page.tsx` and a `profile-form.tsx` client component beside it.

Not `/setup`: that is the post-signup notification step, it is where `signUpTutor` redirects, and it should keep one job.

- `page.tsx` is a server component. `await requireRole("teacher")`, read the profile row and the teacher's `teacher_subjects` rows, and pass them as the form's initial values.
- The form mirrors `src/app/(marketing)/tutor-signup/tutor-form.tsx` in structure and uses the SAME `subject-picker.tsx` — import it from its current location rather than copying it. If that requires moving the file to `src/components/`, move it and update the signup import.
- Pre-select the teacher's existing curricula, grades and subjects. A form that silently loses selections is worse than no form.
- Add `{ href: "/profile", label: "Profile" }` to `NAV.teacher` in `src/lib/nav.ts`. `src/lib/nav.test.ts` asserts every nav href resolves to a real route, so this must be added in the same change as the page.

## 3. The action

`src/app/(app)/(teacher)/profile/actions.ts`, `"use server"`.

1. `requireRole("teacher")` — never trust a teacher id from the form.
2. `parseTeacherProfile(formData)`; return `{ error }` on failure, matching the `AuthState` shape the other forms use (`src/lib/form-state.ts`).
3. Update `profiles` for the caller's own id — under the user's own client, so RLS `update own profile` is what authorises it. **Do not use the service role.**
4. Subjects: delete all rows for this teacher, insert the new set. Both under the user's own client, so RLS enforces ownership.
5. `revalidatePath("/profile")` and `revalidatePath("/dashboard")` — the dashboard's "You're live for" card reads these subjects.

**Ordering matters.** If the profile update succeeds and the subject write fails, the teacher has a new rate and stale subjects. Do the subject replacement FIRST, and only update the profile once it succeeded — a failed profile update leaves correct subjects and an old rate, which is the less wrong half. Say so in a comment, and return a message that tells the teacher exactly which half saved.

## 4. The rate race — handle it, don't ignore it

`sessions.hourly_rate` is copied onto the row at creation, and `enforce_session_insert` (migration `0018`) raises `hourly_rate must match the teacher profile` when they differ. A price is therefore frozen at request time — correct, and it means editing a rate never re-prices an existing session.

But if a teacher changes their rate while a student is mid-request, that student's insert raises that exact message. It fails **safe** — nobody is mispriced — but the student currently sees a raw Postgres error.

In `src/app/(app)/(student)/teachers/actions.ts`, where the session insert happens, catch that specific error (match on the message text) and return something true and useful, e.g. *"That teacher just changed their rate. Open their profile again to see the new price."* Add a test for it.

## 5. The dashboard link

`src/app/(app)/(teacher)/dashboard/page.tsx` renders a read-only "You're live for" card of subjects, with an `EmptyState` when there are none. Add a link to `/profile` from that card — both when subjects exist ("Edit subjects") and in the empty state, where it is the only way out of being invisible.

---

## Constraints

- **No literal colour classes, no emoji, no raw hex.** `src/app/app-surface.test.ts` and `src/hover-affordance.test.ts` enforce this. Semantic tokens only, and no no-op hovers (`text-X hover:text-X` on the same value).
- Any module reading a non-`NEXT_PUBLIC_` `*_KEY`/`*_SECRET` must start with `import "server-only";` (`src/lib/server-secrets.test.ts`). This work should not need one — if you reach for the service role, stop and reconsider, because RLS already permits everything here.
- **Write no comment you cannot support from the code.** Five unsupported claims were made on this branch today; do not add a sixth.
- Verify: `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, `npm run build`. Quote real output.
- If a pre-existing test fails, the change is wrong — fix the change, not the test.
- Commit per logical piece, each message ending with exactly:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
