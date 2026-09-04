# Student Session Record — Design

**Cycle 3 of the redesign. Approved in conversation 2026-09-04.**

Piece 2 of the four-cycle redesign decomposition (`project_state.md`): IA + design system
(shipped), **student dashboard**, admin, polish.

---

## 1. Why this exists

A student today has `/find` → `/teachers` → the call, **and then nowhere.** Two concrete
symptoms, both verified in the code rather than assumed:

- `resolveHome()` (`src/lib/routes.ts:5`) sends a student to `/find` on every sign-in. There is
  no student surface that is not a step in buying something.
- `call/[sessionId]/page.tsx:36` sets `returnTo = isTeacher ? "/dashboard" : "/teachers"`. A
  student who has just finished a lesson is pushed to the **online-now list** — a screen whose
  whole purpose is picking a teacher to start with. The product's response to "you finished your
  lesson" is "here are more teachers".

There is also no record of what was paid. **The person paying is a parent**, and "what am I being
charged for" is the question they will actually ask. Nothing in the product answers it.

## 2. Scope

**In:** a record of sessions where money moved, at `/sessions`; the routing changes that make it
reachable; and a per-session "report a problem" path.

**Out, deliberately:**
- **Re-booking a past teacher.** Considered and dropped in conversation. Instant-pick only works
  against a teacher who is online *right now*; requesting an offline teacher is tier 2 of the
  product, which `CLAUDE.md` lists as deferred pending its own decision. A "book again" button
  would either lie when the teacher is offline or quietly drag tier 2 into this cycle.
- Any teacher-facing change. The teacher already has history and earnings.
- Declined and expired requests (see §4).

## 3. Route and navigation

| Change | From | To |
|---|---|---|
| `resolveHome("student")` | `/find` | `/sessions` |
| Student `returnTo` after a call | `/teachers` | `/sessions` |
| `NAV.student` | `Find a teacher` only | `My sessions` + `Find a teacher` |

`/sessions` sits in the `(app)/(student)` group, so it inherits the existing auth gate and shell.

**The empty state is the important screen, not the list.** Every trial student signs in for the
first time with zero rows. It says so plainly and offers *Find a teacher* — which is their real
first action. Getting this wrong makes the product feel emptier than it is.

## 4. What appears in the record

**The rule is `amount_paid_paise IS NOT NULL OR refund_ref IS NOT NULL`.**

Stated as a fact about money rather than as a status allowlist, on purpose: statuses have already
changed twice in this project's life (`0002` and `0005`), and a list of status names would drift
silently the next time. "Money touched this row" cannot drift.

What that includes and excludes falls out of it:

| Session state | Shown? | Why |
|---|---|---|
| `completed` | yes | paid and delivered |
| `active` / `paid` | yes | money collected |
| `refunded` | yes | **a parent reconciling a bank statement needs the reversal** |
| `cancelled` after payment | yes | money moved and came back |
| `pending` / `accepted` | no | nothing charged |
| `payment_expired`, declined | no | nothing charged; a student who tapped five teachers before one answered would otherwise see five rows for one lesson |

Each row shows: teacher name, subject, date, amount paid, and the refund if there is one.

**Teacher name comes from a join, not a new column.** `sessions` denormalises `student_name`
(`0004`) because a teacher **cannot** read a student's profile — `0001`'s select policy is
`role = 'teacher' or id = auth.uid()`. The reverse is not true: a student *can* read teacher
profiles, so joining is allowed and no column is needed. The asymmetry is in the RLS, not an
oversight.

## 5. Report a problem

There is **no way anywhere in this product** for a student or parent to report that something
went wrong. That is part of the child-safety gap, and a row that already names the teacher, the
subject and the date is the cheapest place to close it.

**Shape:** a button per row opens a short form — a reason plus optional free text. It writes one
row to `session_reports`.

The reason list is fixed and stored as a `check` constraint, so a report cannot arrive with a
reason nothing knows how to triage:

| value | shown as |
|---|---|
| `no_show` | The teacher didn't turn up |
| `left_early` | The lesson ended early |
| `technical` | Audio, video or connection problems |
| `teaching_quality` | The teaching wasn't what we expected |
| `conduct` | **Something the teacher said or did concerned me** |
| `other` | Something else |

`conduct` is the one this feature exists for. It is deliberately not first in the list and not
labelled in alarming language — a parent should be able to reach it without being primed, and the
other five need to exist so the button is used for ordinary problems too. A reporting path only
used in emergencies is a path nobody has practised using.

**`session_reports`** (migration `0016`): `id`, `session_id`, `reporter_id`, `reason`, `detail`,
`created_at`.

**RLS:**
- insert permitted only when `auth.uid()` is the `student_id` of the session being reported —
  a student cannot report a session they were not in;
- **no select policy at all.** Reports are readable only by the service role. A report may
  describe a child; it must not be one policy mistake from being readable by other users.

**Alerting — and an honest compromise.** The report also fires a Sentry message, because Sentry
already emails. **A "report a problem" button that files into a table nobody watches is worse
than no button**: it looks like a safety mechanism while being none. Sentry guarantees a human is
notified today, with no new dependency.

It is nonetheless a compromise, recorded here rather than left implied: **a safety report is not
an error**, and it will sit among exceptions in a dashboard built for a different purpose. The
right answer is a real email via Resend — which `CLAUDE.md` lists in the stack but which is **not
installed and has no API key**, so it cannot ship today. See §8.

**What a report carries:** ids, the reason, and the reporter's own words if they write any. Never
lesson content, never anything scraped from the session.

## 6. Testing

- **Unit:** the money-touched filter, over every session status including a cancelled-after-paid
  row and an expired-payment row — the two cases a status allowlist would get wrong.
- **Unit:** the report action — refuses when not signed in, refuses a session id the caller was
  not part of, and never throws out of the form.
- **Probe** (`scripts/probe-session-reports.mjs`, house style, throwaway accounts deleted in a
  `finally`): a student **cannot** insert a report against a session they were not in; a student
  **cannot** read reports at all, including their own; the service role can. The middle assertion
  is the one that matters — RLS with no select policy is the whole control.

## 7. Decisions, and what each costs if wrong

| Decision | If wrong |
|---|---|
| Sign-in lands students on `/sessions`, not `/find` | A new student sees an empty screen instead of the task. Mitigated by the empty state; reversible in one line of `resolveHome`. |
| Money-touched rule instead of a status list | A student sees a row they did not pay for, or misses a refund. The rule is a single expression and unit-tested against every status. |
| Reports alert through Sentry | Safety reports mix with exceptions and one could be missed among noisy errors. Closed by §8's Resend item. |
| Dropped "book again" | Students who liked a teacher have no path back to them except searching. Accepted: the honest alternative needs tier 2. |

## 8. Spike → production hardening (this cycle's debts)

Required by `CLAUDE.md`: a shortcut with a functional, security or cost cost **in service** is
recorded here, never left silent.

**1. Safety reports alert through Sentry, not email.** Works and guarantees notification, but a
report is not an error and will sit among exceptions. Close by installing `resend`, verifying a
sending domain, and routing `session_reports` inserts to a real address. Blocked on a Resend
account.

**2. No one can read reports in the product.** By design today — there is no admin. Reports are
readable only via the service role, i.e. a script. **This is acceptable only while the operator is
one person who reads their own alerts.** Admin (redesign piece 3) must give reports a real
surface, or the button should be removed rather than left as theatre.

**3. No rate limit on reporting.** A student can file unlimited reports on their own sessions.
Harmless at trial scale and self-limiting (they can only report sessions they paid for), but it
is an unbounded write path reachable by any signed-in user.

## 9. Out of scope, explicitly

Re-booking a past teacher · tier-2 offline requests · scheduled sessions · teacher-side changes ·
admin surfaces for reports · receipts or invoices as documents · ratings.
