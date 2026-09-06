# Conduct Suspension and Reinstatement — Design

**Date:** 2026-09-06
**Status:** designed, not built
**Predecessor:** `2026-09-04-child-safety-and-consent-design.md` §12, which DECIDED this
behaviour and did not build it.

---

## 1. Why this exists

`/terms` is published and says, verbatim:

> **Reports Pending Review:** A conduct report filed against your account suspends your account
> pending review. You may not accept or continue teaching sessions while such a review is open.

Nothing in the product does this. `session_reports` (0016) inserts a row and raises a Sentry
alert; `available_teachers()` (0010) filters on `role`, `declared`, `declared_until`, subject
match and in-flight sessions, and on nothing else. **There is no suspension state in the schema
at all.** A teacher reported for conduct at 2am stays bookable, immediately, by any child.

This is not a deferred item. The child-safety spec §12 marked it **DECIDED** — *"A `conduct`
report suspends the teacher immediately and automatically… because a report filed at 2am must not
wait for someone to wake up"* — and the terms shipped promising it. The gap is between a decision
and its delivery, and it is the most serious open item in the product.

## 2. Scope

**In:** automatic suspension on a `conduct` report; exclusion from discovery; cancellation and
refund of that teacher's not-yet-started sessions; a recorded reinstatement path usable before an
admin UI exists; what the teacher and the affected student each see; the `/terms` correction.

**Out, deliberately:** the admin UI (piece 3 — this design gives it the RPC and the tables it
will read); the external escalation threshold, which needs the legal input of child-safety spec
§17; email to the guardian, which is blocked on the domain and on Resend existing at all; a
general rate limit on reporting (§14).

## 3. What suspension means, exactly

A suspended teacher:

1. **Does not appear in `available_teachers()`** — no student can find or request them.
2. **Has their `pending` and `accepted` sessions cancelled.** Neither has taken money: payment
   happens *after* accept, so `accepted` means "teacher said yes, student has not paid".
3. **Has their `paid` sessions cancelled and refunded.** `paid` means the money moved and the
   lesson has not started.
4. **Keeps an `active` session running to its end.** DECIDED 2026-09-06, against the first
   recommendation — see §12.
5. **Keeps their account, their profile, their history and their availability row.** Suspension
   is not deletion and not a role change.

Suspension is **immediate and automatic**. Reinstatement is **manual and recorded**.

## 4. Schema (migration `0020_teacher_suspensions.sql`)

```sql
create table public.teacher_suspensions (
  id                uuid primary key default gen_random_uuid(),
  teacher_id        uuid not null references public.profiles (id) on delete cascade,
  -- What caused it. NOT readable by the teacher — see §9.
  session_report_id uuid not null references public.session_reports (id) on delete cascade,
  suspended_at      timestamptz not null default now(),
  -- Null while the review is open. Stamped by reinstate_teacher().
  lifted_at         timestamptz,
  lifted_by         uuid references public.profiles (id),
  outcome           text check (outcome in ('reinstated', 'removed')),
  note              text
);

-- The open-suspension lookup runs on every availability query, so it is the
-- one that gets an index. Partial, because open suspensions are the rare case
-- and the only case this query asks about.
create index teacher_suspensions_open_idx
  on public.teacher_suspensions (teacher_id) where lifted_at is null;

-- RLS ON, and NO policy — see §9. Without this line the table is readable by
-- anyone holding the public anon key, which is every visitor.
alter table public.teacher_suspensions enable row level security;
```

**Append-only by intent.** A lift stamps `lifted_at`/`lifted_by`/`outcome` on the existing row; it
never deletes. This is what makes §12's requirement — *"a teacher reinstated twice is a pattern
nobody will see if reinstatement leaves no row"* — a `count(*)`, rather than something an operator
has to remember to log by hand.

**Rejected: `profiles.suspended_at`.** Faster to read (no join, and `available_teachers` already
scans `profiles`), but it holds one bit and no history, so the repeat-pattern requirement would
depend on a second log being written faithfully every time. Two sources of truth that can drift.

**Rejected: forcing `teacher_availability.declared = false`.** No schema change at all, and fatally
wrong: the teacher's own availability toggle flips it straight back, and it erases the difference
between "not working today" and "under review".

### 4.1 `available_teachers()` gains one clause

```sql
    and not exists (
      select 1 from public.teacher_suspensions s
      where s.teacher_id = p.id and s.lifted_at is null
    )
```

Note that the function **already** excludes teachers with in-flight sessions, so a suspended
teacher mid-`active`-lesson is hidden by the existing clause regardless. The new clause is what
hides them once that lesson ends.

### 4.2 `sessions.cancellation_reason`

```sql
alter table public.sessions add column cancellation_reason text
  check (cancellation_reason in ('teacher_suspended'));
```

`cancelled` is the right status — adding a new one would mean changing the transition table in two
languages (`src/lib/session.ts` and 0005's trigger) for no gain. But a student seeing a bare
"Cancelled" on a session they did not cancel is being told something false by omission. One
nullable column lets `/sessions` say what actually happened without touching the state machine.

**Null means the student cancelled**, which is the only other path that produces `cancelled`. A
`'student'` value was considered and dropped: nothing would ever write it, and a constraint listing
a value no code sets invites someone to assume one does.

## 5. The trigger — what must be atomic with the report

`on_conduct_report_suspend`, `after insert on session_reports`, `security definer`.

It does **only** what is pure SQL and must not be lost if the caller dies mid-request:

```
if new.reason <> 'conduct' then return new; end if;

-- Already suspended? Do not stack rows; the review that is open covers this.
if exists (select 1 from teacher_suspensions
            where teacher_id = <the session's teacher> and lifted_at is null)
  then return new; end if;

-- §12's anti-abuse cap: one auto-suspension per reporter per teacher, ever.
-- A second report from the same student still files and still alerts; it does
-- not re-suspend. This kills the repeat vector without discarding evidence.
if exists (select 1 from teacher_suspensions ts
             join session_reports r on r.id = ts.session_report_id
            where ts.teacher_id = <teacher> and r.reporter_id = new.reporter_id)
  then return new; end if;

insert into teacher_suspensions (teacher_id, session_report_id) values (…, new.id);
```

The teacher is read from `sessions` via `new.session_id`, not trusted from the caller.

**Why the cap ships now**, when §12 lists it as required only before signups open beyond the
pilot: it is three lines *here*, inside a trigger being written anyway, versus a separate feature
with its own migration later. The general rate limit stays deferred (§14) because it is genuinely
separate machinery.

**Why the trigger does not cancel sessions.** Two reasons, and the second is decisive. First,
cancelling touches the payment provider for `paid` rows, which SQL cannot do. Second, the trigger
runs with `auth.uid()` still set to the *reporting student* — `security definer` changes the
privilege, not the claim — so every session write it attempted would be evaluated as that student.
See §7.

## 6. `settleSuspension(teacherId)` — the idempotent part

A server-side function using the service-role client, in `src/lib/suspension/settle.ts`,
deliberately modelled on `src/lib/payments/settle.ts`, which established this shape: **idempotent,
and therefore safe to call from a page load as well as from the action that caused it.**

```
for each session of teacherId where status in ('pending','accepted'):
    -> cancelled, cancellation_reason = 'teacher_suspended'
for each session of teacherId where status = 'paid':
    -> refund via the payment port, then -> refunded, cancellation_reason = 'teacher_suspended'
```

Called from three places:

1. `reportSession()`, immediately after the insert succeeds — the fast path.
2. The affected student's **waiting page** load — so a student whose teacher was just suspended
   gets their refund even if the reporter's browser died mid-request.
3. The teacher's **dashboard** load — the same guarantee from the other side.

This is the existing pattern's whole point: no cron, no queue, and no student left holding a paid
session because someone else's request failed.

### 6.1 The refund helper must be extracted first

`refundAndRecord` today is a **closure inside `settle.ts`**, bound to the webhook's `event`
object. It is not exported and cannot be called with a session id.

Extract it to `src/lib/payments/refund.ts` as
`refundSession({ sessionId, paymentRef, amountPaise, nextStatus })`, and have the webhook path
call the extracted version. Its existing guarantees are the reason to reuse rather than
reimplement: it is guarded on `refund_ref is null` so a redelivery cannot double-refund, it uses
`.select("id")` so a guard-blocked write is distinguishable from a successful one, and it logs
`REFUND FAILED … needs manual action` loudly when the provider call throws — the one failure with
no automatic recovery. A parallel implementation would have to re-earn all of that.

This is core infrastructure, not a spike: the refactor is the fix, and the webhook keeps its
behaviour, pinned by its existing tests.

## 7. The guard widening — stated plainly, because it is a security change

`enforce_session_update` (0005) contains:

```sql
if new.status = 'cancelled' and uid is distinct from old.student_id then
  raise exception 'only the student may cancel a request';
end if;
```

`uid` is `auth.uid()`. For the service role `uid` is null, and `null is distinct from
old.student_id` is **true** — so today *nobody except the session's own student can cancel it*,
service role included. `settleSuspension` cannot work without changing this.

**The change:**

```sql
if new.status = 'cancelled' and uid is not null and uid is distinct from old.student_id then
  raise exception 'only the student may cancel a request';
end if;
```

This widens cancellation from "the student" to "the student, or the service role". That is
consistent with the model 0005 already uses — `paid`, `active` and `refunded` are *already*
service-role-only, and the service role is only ever held by server code. It does not widen what
any user token can do: a student token still cannot cancel another student's session, and a
teacher token still cannot cancel at all.

It is recorded here rather than slipped into a migration because widening a security guard is
exactly the kind of change that should be findable later by someone asking "when did this stop
being student-only?"

`cancellation_reason` joins the immutable-terms list in the same trigger, so a user token cannot
forge one.

## 8. Reinstatement — `reinstate_teacher()`

```sql
create function public.reinstate_teacher(
  p_teacher_id uuid, p_outcome text, p_note text, p_lifted_by uuid default null
) returns void
language plpgsql security definer set search_path = ''
```

Stamps `lifted_at = now()`, `outcome`, `note` and
`lifted_by = coalesce(p_lifted_by, (select auth.uid()))` on the open row. Raises if no open
suspension exists, so a typo'd id fails loudly rather than silently doing nothing.

**`p_lifted_by` exists because of how this is actually called.** The obvious implementation stamps
`auth.uid()` alone — but the operator invokes this from the CLI holding the service role, where
`auth.uid()` is **null**, so every pilot-era lift would record *that it happened* and not *who did
it*. That silently guts the accountability this RPC exists to provide. The operator passes their
own profile id during the pilot; the admin UI later passes nothing and `auth.uid()` fills in.

**No UI, and no admin role.** During the pilot the operator calls it from the Supabase CLI. This
is the same posture §12 already takes — *"the operator reads their own alerts and acts in SQL,
which is honest only at pilot size"* — with one difference that matters: a raw `UPDATE` leaves no
record of *who* lifted it, *why*, or that it happened at all. The RPC does.

`execute` is granted to `service_role` only. When admin is built (piece 3), it calls this same
function; the seam is already in the right place, so the UI is a caller and not a rewrite.

**`outcome = 'removed'`** records the decision but does not delete the account — removal is a
separate action nothing in this design performs, and the row stays open (`lifted_at` null) so the
teacher stays suspended.

## 9. What the teacher sees — and what they must not

**Must see:** a banner on `/dashboard`. Without it, they vanish from search while their
availability toggle still says "you're live", and it reads as a bug in the product rather than as
a consequence. The banner states that an account review is open, that they cannot receive new
requests, and how to reach the operator.

**Must not see: which report, or which session, caused it.** A suspension row carries
`session_report_id`; a teacher who can read that can identify the session, and therefore the
student who reported them. In a child-safety feature that is a retaliation vector, and it is the
kind of leak that arrives by accident through a convenient `select *`.

Therefore `teacher_suspensions` gets **no SELECT policy at all** — the same posture 0016 takes for
`session_reports`, and for the same reason. The banner reads from a narrow `security definer`
function:

```sql
create function public.my_suspension() returns timestamptz  -- suspended_at, or null
language sql security definer set search_path = '' stable;

revoke all on function public.my_suspension() from public;
grant execute on function public.my_suspension() to authenticated;
```

which returns one timestamp for `auth.uid()` and nothing else. This follows the existing narrow-RPC
pattern (`become_teacher`, `record_consent`) rather than inventing one — including the
`revoke … from public` / `grant … to authenticated` pair that 0010 uses on `available_teachers`,
without which a `security definer` function is executable by the anonymous role.

## 10. What the affected student sees

A student whose session was cancelled by someone else's report is owed an explanation that does
not name the report, the reason, or the other student.

- **On the waiting page**, if their session is cancelled underneath them: the session cannot go
  ahead, their payment has been refunded, and what to do next (find another teacher).
- **In `/sessions` history**: "Cancelled — teacher unavailable", driven by
  `cancellation_reason = 'teacher_suspended'`, with the refund shown by the existing money
  rendering.

Never "the teacher was reported". The student learning that a report exists is a disclosure about
a third party's complaint.

## 11. `/terms` — the wording must match the build

§3.4 lets an `active` lesson finish. The published sentence says a teacher "may not accept **or
continue**" sessions while a review is open, and after this ships that is still not true.

Change it to state what the product does: **no new requests, sessions already under way finish,
and anything not yet started is cancelled and refunded.**

Closing one terms-versus-reality gap while leaving a smaller one open would repeat exactly the
mistake this design exists to correct.

## 12. Decisions, and what each costs if wrong

| Decision | Cost if wrong |
|---|---|
| **An `active` lesson finishes.** Chosen by the owner 2026-09-06 over the alternative of ending it. The reported incident is from a *completed* session; the child in the live call is a different student who reported nothing and has paid | A just-reported teacher is alone with another child for up to an hour. This is the decision in this document most worth revisiting, and reversing it costs a `deleteRoom()` in `daily.ts` plus a refund path that §6 already builds |
| **Suspension is a table, not a column** | A join on every availability query. Measured cost is one partial-index lookup; the repeat-pattern requirement is what buys it |
| **The trigger suspends; a settle pass cancels** | Two moving parts instead of one. The alternative is a trigger that cannot run, per §7 |
| **The per-reporter cap ships now** | One student can suspend a given teacher once, ever. A genuinely repeated offender reported twice by the *same* child does not re-suspend — but the second report still files, still alerts, and any *other* student's report suspends normally |
| **No SELECT policy for the teacher on their own suspension** | A teacher cannot self-serve the detail of what they are accused of; they must contact the operator. The alternative leaks the reporter |
| **Reinstatement is CLI-only** | The operator needs a terminal and the service role to lift a suspension. Honest at pilot size; dishonest the moment there are two operators |

## 13. Testing

**Trigger (SQL-level, against a real database):**
- A `conduct` report opens exactly one suspension row.
- A non-`conduct` report opens none. All five other reasons.
- A second report while one is open opens no second row.
- A second report from the *same* reporter after a lift opens no new row; from a *different*
  reporter it does.
- The teacher is resolved from `sessions`, not from anything the caller supplies.

**`available_teachers()`:**
- A suspended teacher is absent; the same teacher is present after `reinstate_teacher`.
- The existing in-flight and subject-match clauses still behave — the probe that asserts SQL and
  `src/lib/session.ts` agree, status by status, must stay green.

**`settleSuspension` (unit, with a stub port):**
- `pending` and `accepted` → `cancelled` with the reason stamped.
- `paid` → refund called once, then `refunded`.
- `active` → untouched.
- **Called twice, the refund is issued once** — the property that makes it safe on a page load.
- A provider throw leaves the row `paid`, logs loudly, and does not mark it refunded.

**Guard (§7):** a student token still cannot cancel another student's session; a teacher token
still cannot cancel; the service role now can.

**Privacy:** a teacher token selecting `teacher_suspensions` gets zero rows; `my_suspension()`
returns their timestamp and no report id.

## 14. Out of scope, explicitly

- **The admin UI.** This design hands piece 3 its tables and its RPC.
- **A general rate limit on reporting.** §12 promotes it to required before signups open beyond
  the pilot; the per-reporter cap in §5 covers the repeat-suspension vector, which is the half
  that *acts*. Separate machinery, separate change.
- **Notifying the guardian.** §12 requires it; it needs email, which needs Resend and the domain.
- **Removal of a teacher.** `outcome = 'removed'` records the decision; performing it is not here.
- **The external escalation threshold.** Needs the legal input in child-safety spec §17.

## 15. Rollout

One migration, `0020_teacher_suspensions.sql`: the table, the index, the
`available_teachers` replacement, `sessions.cancellation_reason`, the `enforce_session_update`
widening, `reinstate_teacher`, `my_suspension`, and the trigger. It carries no `begin;`/`commit;`
— `db push` wraps each file in its own transaction (CLAUDE.md).

**Applying it is a human action.** The agent prepares and verifies; a human runs `supabase db
push` and confirms `supabase migration list` shows LOCAL == REMOTE.

Application code and the `/terms` change ship in the same branch. There is no ordering hazard in
either direction: the migration alone suspends nobody until a report arrives, and the application
code alone cannot suspend without the table.
