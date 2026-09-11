# Exam targets — design

**Date:** 2026-09-11
**Status:** design agreed, not implemented
**Owner decisions recorded:** exam list, grade range, per-subject granularity

## What this is

A teacher can declare, **per subject they already teach**, that they prepare
students for **JEE** or **NEET**. A parent can see that on the card and filter
the online list by it.

Positioned as an exclusive feature: the owner's intent is that this is a
reason to choose SMB Tutorials, not a minor filter.

## What this is not, and the honest caveat

**No parent on this platform has asked for it.** Production holds six
experimental teacher rows; their `specialization` values are "Algebra",
"Mechanics" and blank. The demand for exam-targeted search is the owner's
knowledge of the market, not something observed in our data. This is recorded
because the same shape of assumption was made about language of instruction on
2026-09-11 and was wrong — every subject here is taught in English.

There is also a real tension with the product's pitch. The landing page sells
sixty seconds to a teacher who is already online; choosing by exam board is a
*considered* purchase, not an urgent one. The design keeps the exam step
**optional** throughout for exactly this reason, and tier 2 ("request an
offline teacher") is where it will earn most — that tier does not exist yet.

## Taxonomy (settled — Phase 0 complete)

Board exams are **implicit and not a value**. Every student sits them and
`curriculum + grade` already says which. Making "Boards" selectable would have
every teacher tick it, carrying no information.

An **empty exam set is meaningful**: "teaches the syllabus, claims no exam
prep."

| Exam | Grades | Stream | Subjects | Curriculum |
|---|---|---|---|---|
| `JEE` | 11th, 12th | Science | Physics, Chemistry, Mathematics | any |
| `NEET` | 11th, 12th | Science | Physics, Chemistry, Biology | any |

Deliberately excluded, and each is a schema-visible value if ever added:
CUET, NTSE, Olympiads, state CETs (MHT-CET, KCET, WBJEE), and foundation
years. Foundation was considered and rejected: a JEE claim on a Class 9 row
is not the exam, and a parent of a 9th grader would read the same badge
differently from a parent of a 12th grader.

## Schema

### A child table, NOT a widened primary key

`teacher_subjects`'s primary key is
`(teacher_id, curriculum, grade, stream, subject)`. The obvious design adds
`exam` to it. **Do not.** A primary key column cannot be nullable, so every
existing row would need an exam value — a backfill decision on live rows,
before anything else works — and the cartesian expansion in `expandSubjects`
would multiply every teacher's row count again.

Instead:

```sql
create table public.teacher_subject_exams (
  teacher_id uuid not null,
  curriculum text not null,
  grade      text not null,
  stream     text not null,
  subject    text not null,
  exam       text not null check (exam in ('JEE','NEET')),
  primary key (teacher_id, curriculum, grade, stream, subject, exam),
  foreign key (teacher_id, curriculum, grade, stream, subject)
    references public.teacher_subjects
      (teacher_id, curriculum, grade, stream, subject)
    on delete cascade
);
```

Consequences of this shape, all of them wanted:

- **No backfill.** Absence of a row is the default and it already means the
  right thing.
- **`teacher_subjects` is untouched**, so `0027`/`0028`'s revocations, its
  RLS and its indexes all keep working unchanged.
- **`on delete cascade`** means dropping a subject drops its exam claims. A
  teacher cannot leave a JEE claim attached to a subject they no longer teach.
- **Bounded growth.** At most 2 exams × 3 eligible subjects × 2 grades, and
  only for Science. This is not the combinatorial explosion a sixth PK column
  would have been.

### Validity is enforced in SQL, not only in TypeScript

`0028` exists because `0027`'s rules were bypassable with the anon key. The
same reasoning applies: **TypeScript validation is a courtesy, SQL is the
boundary.** Two layers, with a decided split — not "a trigger or the
functions", both, each doing what it is good at:

**A table CHECK** for what a single row can state on its own:

- `exam in ('JEE','NEET')`
- `grade in ('11th','12th')`
- `stream = 'Science'`
- `exam = 'JEE'` → `subject in ('Physics','Chemistry','Mathematics')`
- `exam = 'NEET'` → `subject in ('Physics','Chemistry','Biology')`

All five are row-local, so a CHECK is sufficient and no trigger is needed. A
trigger would be the wrong instrument: it can be disabled, a CHECK cannot.

**Revoked direct writes**, mirroring what `0028` did to `teacher_subjects`:
`insert`/`update`/`delete` on `teacher_subject_exams` are revoked from
`authenticated`, so the only ways in are `set_initial_subjects`,
`request_subject_change` and `approve_subject_change`. A teacher cannot add a
JEE claim with the anon key, which is exactly the hole `0028` closed.

### RLS

`teacher_subjects` is readable by everyone (`for select using (true)`), because
the teachers list joins it. **`teacher_subject_exams` needs the same read
policy** or `/teachers` cannot render the card line or filter on it. Reads are
public; writes are revoked entirely per the above.

The migration must `alter table public.teacher_subject_exams enable row level
security` in the same file as the policy. A policy on a table with RLS disabled
is not enforced at all, and the table would read as protected while being open
to anything the grants allow.

### `sessions.exam`

Nullable `text` with the same `exam in ('JEE','NEET')` CHECK. Nullable because
most sessions will have no exam — the filter is optional and 6th–10th cannot
use it at all.

A parent who filtered by NEET gets a session record that says so. Without it
we would filter on something the record does not keep, and the first question
anyone asks about this feature — *did anyone use it?* — would be unanswerable.
Given the market assumption under "What this is not", that question is the
whole point of shipping it.

## `available_teachers` — the one real hazard

Current signature: `available_teachers(text, text, text, text)`, with grants
naming that exact signature (`0010`, replaced in `0021`).

**Adding `p_exam text default null` creates an ambiguous overload.** With both
the 4-arg and the 5-arg-with-default present, a 4-argument call cannot be
resolved and Postgres raises an error. PostgREST's named-argument calls do not
avoid this.

Therefore the migration must **drop the 4-arg function and create the 5-arg
one**, re-issuing the grants for the new signature — and
`online-list.tsx`'s `supabase.rpc("available_teachers", …)` must ship in the
**same deploy**. This is the only breaking change in the feature.

`p_exam null` must mean *ignore this filter*, so every existing behaviour is
preserved when no exam is chosen. The filter is an `exists` against
`teacher_subject_exams` guarded by `p_exam is null or exists (...)` — **not** a
join to the child table. A join drops every teacher who has no exam rows, which
is most of them, and would silently empty the list for the 6th-10th majority
that cannot choose an exam at all.

## Teacher side

The jsonb payload is the good news here. `set_initial_subjects(p_subjects
jsonb)` and `request_subject_change(p_subjects jsonb, p_demo_video_url text)`
take arrays of objects, so **adding an `exam` field to each object changes no
function signature** — only the validation inside them and the row-writing.

- `subject-picker.tsx` gains exam selection. It currently emits `"Stream|Subject"`
  pairs against checkbox groups for curricula, grades and subjects; exams
  attach per subject and must be offered **only** when the picked grades and
  stream make them valid, so a Commerce teacher never sees JEE.
- `expandSubjects` in `validation.ts` validates the exam against the map.
- `0027`/`0028`'s SQL validation gains the same rules — the boundary.
- The admin diff (`0026` `teacher_revet_events`) **must** show exam changes.
  Without it a teacher adds a JEE claim and the approving admin clears them
  without ever seeing it — the approval would be of something other than what
  was requested. This is not optional polish; it is the difference between an
  approval that means something and one that does not.

## Parent side

- **`/find` gains an optional fifth step**, shown **only when the chosen grade
  is 11th or 12th and the stream is Science.** Everywhere else it is not
  rendered at all, so the funnel does not grow for the 6th–10th majority. It is
  skippable even when shown.
- **`/teachers`** filters on it, passing `p_exam` through to the RPC.
- **The card** gains a fact line: "Preps for JEE".
- **`requestSession`** records `sessions.exam`.

## Out of scope

Exam-specific pricing, exam-specific content or materials, exam-based ranking
of teachers, and any exam value beyond JEE and NEET. Tier 2 integration is
where this feature earns most and is explicitly deferred with that tier.

## Risks

1. **Taxonomy churn after Phase 1.** Once `JEE`/`NEET` are in CHECK
   constraints with live rows, every change to the list is a migration. Phase 0
   is settled precisely so this does not happen.
2. **The RPC swap.** Drop-and-recreate with a client that must land together.
   A deploy that ships one without the other breaks the teachers list.
3. **Unverified market assumption.** See the caveat above.
4. **No student account.** Two features shipped on 2026-09-11 are live having
   never been rendered in a browser. A four-phase feature verified only by
   tests would be a much worse instance of the same gap. A student login is a
   prerequisite for Phase 5, not a nice-to-have.

## Phasing

| Phase | Contents | Gate |
|---|---|---|
| 0 | Taxonomy | **Done** — recorded above |
| 1 | Migration `0031`: child table + CHECK, RLS enabled, `sessions.exam`, RPC swap | Tier A review; `db push` is the owner's |
| 2 | Teacher side: picker, `expandSubjects`, `0027`/`0028` validation, admin diff | |
| 3 | Parent side: `/find` optional step, filter, card line, session record | |
| 4 | Positioning copy, if it is the exclusive feature | |
| 5 | Browser verification with a real student and teacher account | Blocked on a student login |

Estimated 5–7 sessions. Phases 1 and 2 are the bulk; Phase 2 is the largest
because it touches the admin approval flow, which nothing this cycle has.
