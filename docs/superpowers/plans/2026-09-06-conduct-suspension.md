# Conduct Suspension and Reinstatement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a `conduct` report actually suspend a teacher — excluding them from discovery, cancelling and refunding their not-yet-started sessions — and give the operator a recorded way to reinstate.

**Architecture:** A `teacher_suspensions` table is joined into `available_teachers()`. A `security definer` trigger on `session_reports` opens a suspension atomically with the report. Cancellation and refund cannot run in that trigger (it holds the *reporting student's* `auth.uid()`, and refunds need the payment provider), so they run in an idempotent `settleSuspension()` pass modelled on `payments/settle.ts` and callable from a page load.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS + RPC), Razorpay via the `PaymentPort` interface, Vitest, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-06-conduct-suspension-design.md`

## Global Constraints

- **Migration files carry NO `begin;`/`commit;`.** `supabase db push` wraps each file in its own transaction; an explicit `commit;` would end it early and run the rest unprotected.
- **Applying DDL is a human action.** The agent writes and verifies migrations; a human runs `supabase db push` and confirms `supabase migration list` shows LOCAL == REMOTE. Task 2 ends at a human gate.
- **No literal colour classes, no emoji, no raw hex** on any surface — `src/app/app-surface.test.ts`, `src/app/(marketing)/marketing.test.ts` and `src/hover-affordance.test.ts` enforce this and run in `npx vitest run`. Use semantic tokens (`bg-destructive/12 text-destructive`, `text-muted-foreground`).
- **No no-op hovers.** `src/hover-affordance.test.ts` fails on `text-X hover:text-X` for the same utility and value.
- **The project spells itself `SMB Tutorials`.**
- **Never add `.select()` to a `session_reports` insert.** That table has no SELECT policy, so `RETURNING` is refused with `42501` even when the insert is permitted (see `scripts/probe-session-reports.mjs`).
- **Verification before any completion claim:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, `npm run build` — run them, quote the output.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0020_teacher_suspensions.sql` | Create | Table, RLS, index, `available_teachers` replacement, `cancellation_reason`, `enforce_session_update` widening, `reinstate_teacher`, `my_suspension`, the trigger |
| `scripts/probe-suspension.mjs` | Create | SQL-level proof against a real database: trigger conditions, RLS, `available_teachers` exclusion |
| `src/lib/payments/refund.ts` | Create | `refundSession()` — extracted from `settle.ts`'s closure so a second caller exists |
| `src/lib/payments/refund.test.ts` | Create | Unit tests for the extracted helper |
| `src/lib/payments/settle.ts` | Modify:104-188, 5 call sites | Delegates to `refundSession`; behaviour unchanged |
| `src/lib/suspension/settle.ts` | Create | `settleSuspension(teacherId)` — idempotent cancel + refund pass |
| `src/lib/suspension/settle.test.ts` | Create | Unit tests with a stub payment port |
| `src/app/(app)/(student)/sessions/actions.ts` | Modify:74 | Calls `settleSuspension` after a successful report insert |
| `src/app/(app)/(teacher)/dashboard/page.tsx` | Modify:15-56, 58-76 | Reads `my_suspension()`, renders the notice, calls `settleSuspension` |
| `src/components/status-pill.tsx` | Modify:6, 8-37 | Adds the `suspended` state to the shared vocabulary |
| `src/app/(app)/(teacher)/dashboard/availability-toggle.tsx` | Modify:21-53, 248, 273 | Accepts `suspended`, forces the pill, disables the control |
| `src/app/(app)/(student)/waiting/[sessionId]/page.tsx` | Modify:17, 64-71 | Calls `settleSuspension`; routes a suspension-cancelled session to its own outcome |
| `src/app/(app)/(student)/teachers/online-list.tsx` | Modify:24-57 | The `teacher_unavailable` wording |
| `src/app/(app)/(student)/sessions/page.tsx` | Modify:44-46, 104-118 | Shows why a session was cancelled |
| `src/app/(marketing)/terms/page.tsx` | Modify:190-195 | The wording matches what the product does |

---

### Task 1: Extract the refund helper

`refundAndRecord` is a closure inside `settleVerifiedEvent`, bound to that function's `db` and `event`. `settleSuspension` needs it with a session id instead. This task is a **pure refactor with no behaviour change** — the webhook's existing tests are the proof.

Do not reimplement it. It carries a retry, a guard-blocked-vs-succeeded distinction, and a "was it recorded by attempt 1" check that exist because losing them means refunding money and not recording it.

**Files:**
- Create: `src/lib/payments/refund.ts`
- Create: `src/lib/payments/refund.test.ts`
- Modify: `src/lib/payments/settle.ts:104-188` (remove the closure), and its 5 call sites at lines 213, 223, 237, 290, 328

**Interfaces:**
- Consumes: `getPaymentPort()`, `paymentProviderName()` from `./index`; `SessionStatus` from `@/lib/session`
- Produces: `refundSession(db: SupabaseClient, args: RefundArgs): Promise<void>` where
  ```ts
  interface RefundArgs {
    sessionId: string;
    paymentRef: string;
    amountPaise: number;
    nextStatus: SessionStatus | null;
    why: string;
    logPrefix: string;   // "[webhook]" or "[suspension]"
  }
  ```

- [ ] **Step 1: Read the current implementation end to end**

Run: `sed -n '104,188p' src/lib/payments/settle.ts`

You are moving this code, not rewriting it. Every `console.error` string, the retry, and the `recorded.length === 0` branch move across unchanged except that `event.sessionId` becomes `args.sessionId`, `event.paymentRef` becomes `args.paymentRef`, `event.amountPaise` becomes `args.amountPaise`, and the literal `[webhook]` becomes `${args.logPrefix}`.

- [ ] **Step 2: Write the failing test**

Create `src/lib/payments/refund.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { refundSession } from "./refund";

const port = { refund: vi.fn() };
vi.mock("./index", () => ({
  getPaymentPort: () => port,
  paymentProviderName: () => "stub",
}));

// Minimal PostgREST-shaped stub: .from().update().eq().is().select()
function stubDb(result: { data: unknown[] | null; error: unknown }) {
  const chain = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    select: vi.fn(() => Promise.resolve(result)),
  };
  return { from: vi.fn(() => chain), chain };
}

beforeEach(() => {
  port.refund.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("refundSession", () => {
  it("refunds, then stamps the row with the reference", async () => {
    port.refund.mockResolvedValue({ refundRef: "rfnd_1" });
    const db = stubDb({ data: [{ id: "s1" }], error: null });

    await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: "refunded", why: "test", logPrefix: "[suspension]",
    });

    expect(port.refund).toHaveBeenCalledWith("pay_1", 50000);
    expect(db.chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "refunded", refund_ref: "rfnd_1" })
    );
  });

  it("does not stamp the row when the provider throws", async () => {
    port.refund.mockRejectedValue(new Error("provider down"));
    const db = stubDb({ data: [{ id: "s1" }], error: null });

    await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: "refunded", why: "test", logPrefix: "[suspension]",
    });

    expect(db.chain.update).not.toHaveBeenCalled();
  });

  it("omits status from the write when nextStatus is null", async () => {
    port.refund.mockResolvedValue({ refundRef: "rfnd_2" });
    const db = stubDb({ data: [{ id: "s1" }], error: null });

    await refundSession(db as never, {
      sessionId: "s1", paymentRef: "pay_1", amountPaise: 50000,
      nextStatus: null, why: "test", logPrefix: "[webhook]",
    });

    const written = db.chain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(written).not.toHaveProperty("status");
    expect(written.refund_ref).toBe("rfnd_2");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/lib/payments/refund.test.ts`
Expected: FAIL — `Failed to resolve import "./refund"`.

- [ ] **Step 4: Create the extracted helper**

Create `src/lib/payments/refund.ts`. Move the body of `refundAndRecord` (settle.ts:104-188) verbatim, applying only the substitutions from Step 1:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPaymentPort, paymentProviderName } from "./index";
import type { SessionStatus } from "@/lib/session";

export interface RefundArgs {
  sessionId: string;
  paymentRef: string;
  amountPaise: number;
  nextStatus: SessionStatus | null;
  why: string;
  // "[webhook]" or "[suspension]" — the operator greps these, so the caller
  // has to say which path issued the money back.
  logPrefix: string;
}

// Extracted from settle.ts, unchanged. It took four fix rounds to get the
// failure paths right: the retry, the guard-blocked-versus-succeeded
// distinction, and the attempt-1-may-have-committed check. A second
// implementation would have to re-earn all of it, in the one part of the
// product that moves money.
export async function refundSession(
  db: SupabaseClient,
  args: RefundArgs
): Promise<void> {
  // ... body moved from settle.ts:105-187 ...
}
```

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run src/lib/payments/refund.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Rewire settle.ts**

Delete the `refundAndRecord` closure. Replace each of the 5 call sites. The shape at every site:

```ts
// before
await refundAndRecord("amount mismatch", null);
// after
await refundSession(db, {
  sessionId: event.sessionId,
  paymentRef: event.paymentRef,
  amountPaise: event.amountPaise,
  nextStatus: null,
  why: "amount mismatch",
  logPrefix: "[webhook]",
});
```

**Identify the sites by their `why` string, not by line number** — Step 4 deleted ~85 lines above them, so the numbers in this task's Files block are already stale. The five `why` strings and `nextStatus` values, unchanged:

| settle.ts line | `why` | `nextStatus` |
|---|---|---|
| 213 | `"repair arrived too late for the minted room"` | `"refunded"` |
| 223 | `"amount mismatch"` | `null` |
| 237 | `` `payment arrived while status was ${actual}` `` | `actual` |
| 290 | `` `lost the claim race; row is now ${now.status}` `` | `null` |
| 328 | `"room could not be created"` | `"refunded"` |

- [ ] **Step 7: Prove the refactor changed nothing**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: the full suite passes with the same count as before this task plus 3, `tsc` 0, `eslint` 0 errors. **If any pre-existing payments test fails, the extraction is wrong — fix it rather than adjusting the test.**

- [ ] **Step 8: Commit**

```bash
git add src/lib/payments/refund.ts src/lib/payments/refund.test.ts src/lib/payments/settle.ts
git commit -m "refactor(payments): extract refundSession so a second caller can exist

settleSuspension needs to refund by session id. refundAndRecord was a
closure bound to the webhook's event object, so it could not be called
that way. Moved unchanged — the retry, the guard-blocked distinction and
the attempt-1-may-have-committed check are why this is an extraction and
not a reimplementation.

No behaviour change; the existing payments tests are the proof."
```

---

### Task 2: The migration

Everything schema-level, in one file. Ends at a **human gate** — the agent cannot apply DDL.

**Files:**
- Create: `supabase/migrations/0020_teacher_suspensions.sql`

**Interfaces:**
- Produces: table `public.teacher_suspensions`; column `public.sessions.cancellation_reason`; functions `public.reinstate_teacher(uuid, text, text, uuid)`, `public.my_suspension()`; trigger `on_conduct_report_suspend`

- [ ] **Step 1: Write the table, index and RLS**

Create `supabase/migrations/0020_teacher_suspensions.sql`:

```sql
-- Spec: docs/superpowers/specs/2026-09-06-conduct-suspension-design.md
--
-- /terms has promised since cycle 3 that a conduct report suspends a teacher
-- pending review. Nothing did it: available_teachers filtered on role,
-- declared, declared_until, subject match and in-flight sessions, and there
-- was no suspension state in the schema at all.

create table public.teacher_suspensions (
  id                uuid primary key default gen_random_uuid(),
  teacher_id        uuid not null references public.profiles (id) on delete cascade,
  -- What caused it. The teacher must NEVER read this: it identifies the
  -- session, and therefore the student who reported them.
  session_report_id uuid not null references public.session_reports (id) on delete cascade,
  suspended_at      timestamptz not null default now(),
  -- Null while the review is open. Stamped by reinstate_teacher().
  lifted_at         timestamptz,
  lifted_by         uuid references public.profiles (id),
  outcome           text check (outcome in ('reinstated', 'removed')),
  note              text
);

-- The open-suspension lookup runs on every availability query. Partial,
-- because open suspensions are the rare case and the only case it asks about.
create index teacher_suspensions_open_idx
  on public.teacher_suspensions (teacher_id) where lifted_at is null;

-- RLS ON, and NO policy, exactly as 0016 does for session_reports. Without
-- this line the table is readable by anyone holding the public anon key,
-- which is every visitor. The teacher reads their own state through
-- my_suspension() below, which returns a timestamp and nothing else.
alter table public.teacher_suspensions enable row level security;
```

- [ ] **Step 2: Add the cancellation reason**

Append:

```sql
-- `cancelled` stays the status: a new one would mean changing the transition
-- table in two languages (src/lib/session.ts and 0005's trigger) for no gain.
-- But a student seeing a bare "Cancelled" on a session they did not cancel is
-- being told something false by omission. NULL means the student cancelled,
-- which is the only other path that produces `cancelled`.
alter table public.sessions add column cancellation_reason text
  check (cancellation_reason in ('teacher_suspended'));
```

- [ ] **Step 3: Replace `available_teachers()` with the suspension clause added**

`create or replace function` needs the **entire** body, so this is the existing function plus one `not exists`. Extract the current definition rather than retyping it — a transcription slip here silently changes who is discoverable:

```bash
sed -n '17,70p' supabase/migrations/0010_available_teachers.sql
```

Append that definition to `0020`, changing only `create or replace`'s body by inserting this clause immediately after the `and a.declared_until > now()` line:

```sql
    -- Suspension (0020). A conduct report removes a teacher from discovery
    -- immediately and automatically; a report filed at 2am must not wait for
    -- someone to wake up.
    and not exists (
      select 1 from public.teacher_suspensions ts
      where ts.teacher_id = p.id and ts.lifted_at is null
    )
```

Then re-state the grants, because `create or replace` does not preserve a prior `revoke`:

```sql
revoke all on function public.available_teachers(text, text, text, text) from public;
grant execute on function public.available_teachers(text, text, text, text) to authenticated;
```

- [ ] **Step 4: Widen the cancellation guard**

`enforce_session_update` today contains:

```sql
if new.status = 'cancelled' and uid is distinct from old.student_id then
  raise exception 'only the student may cancel a request';
end if;
```

`uid` is `auth.uid()`, which is **null** for the service role, and `null is distinct from old.student_id` is **true** — so today nobody but that session's own student can cancel it, service role included. `settleSuspension` cannot work until this changes.

Extract the current function and append it to `0020` with two edits:

```bash
sed -n '140,273p' supabase/migrations/0005_payments.sql
```

Edit 1 — permit the service role:

```sql
-- WIDENED in 0020: "the student, or the service role". Suspension cancels a
-- teacher's not-yet-started sessions from server code, and uid is null there.
-- Consistent with the model this function already uses — paid, active and
-- refunded are already service-role-only — and it widens nothing a user token
-- can do: a student token still cannot cancel another student's session, and
-- a teacher token still cannot cancel at all.
if new.status = 'cancelled' and uid is not null and uid is distinct from old.student_id then
  raise exception 'only the student may cancel a request';
end if;
```

Edit 2 — add, immediately after the payment-columns block that ends with `raise exception 'payment columns are set by the payment webhook only';`:

```sql
-- Server-set, like the payment columns above: a user token must not be able
-- to forge a reason for its own cancellation.
if new.cancellation_reason is distinct from old.cancellation_reason
   and uid is not null then
  raise exception 'cancellation_reason is set by the server only';
end if;
```

- [ ] **Step 5: Add the two RPCs**

Append:

```sql
-- Reinstatement is manual and RECORDED. A raw UPDATE would leave no record of
-- who lifted it or why, and spec §12 requires the record: "a teacher
-- reinstated twice is a pattern nobody will see if reinstatement leaves no
-- row."
--
-- p_lifted_by exists because of how this is actually called. Stamping
-- auth.uid() alone looks right and is wrong: the operator invokes this from
-- the CLI holding the service role, where auth.uid() is NULL, so every
-- pilot-era lift would record that it happened and not who did it. The admin
-- UI (piece 3) passes nothing and auth.uid() fills in.
create or replace function public.reinstate_teacher(
  p_teacher_id uuid,
  p_outcome    text,
  p_note       text,
  p_lifted_by  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_outcome not in ('reinstated', 'removed') then
    raise exception 'outcome must be reinstated or removed, not %', p_outcome;
  end if;

  select ts.id into v_id
    from public.teacher_suspensions ts
   where ts.teacher_id = p_teacher_id and ts.lifted_at is null
   order by ts.suspended_at desc
   limit 1;

  -- Loudly, so a typo'd id fails instead of silently doing nothing.
  if v_id is null then
    raise exception 'no open suspension for teacher %', p_teacher_id;
  end if;

  -- 'removed' records the decision and leaves lifted_at NULL, so the
  -- suspension stays open and available_teachers keeps excluding them.
  -- Performing a removal is not this function's job.
  update public.teacher_suspensions
     set outcome   = p_outcome,
         note      = p_note,
         lifted_by = coalesce(p_lifted_by, (select auth.uid())),
         lifted_at = case when p_outcome = 'reinstated' then now() else null end
   where id = v_id;
end;
$$;

revoke all on function public.reinstate_teacher(uuid, text, text, uuid) from public;
revoke all on function public.reinstate_teacher(uuid, text, text, uuid) from authenticated;

-- The teacher's own state, and NOTHING else. Returns a timestamp, never the
-- report id — a teacher who learns which session was reported learns who
-- reported them, which is a retaliation vector in a child-safety feature.
create or replace function public.my_suspension()
returns timestamptz
language sql
security definer
set search_path = ''
stable
as $$
  select ts.suspended_at
    from public.teacher_suspensions ts
   where ts.teacher_id = (select auth.uid())
     and ts.lifted_at is null
   order by ts.suspended_at desc
   limit 1;
$$;

revoke all on function public.my_suspension() from public;
grant execute on function public.my_suspension() to authenticated;
```

- [ ] **Step 6: Add the trigger**

Append:

```sql
-- Atomic with the report, and doing ONLY what is pure SQL. It cannot cancel
-- sessions: security definer changes the privilege, not the claim, so
-- auth.uid() here is still the REPORTING STUDENT, and every session write
-- would be evaluated as them. Cancellation and refund run in
-- src/lib/suspension/settle.ts instead.
create or replace function public.on_conduct_report_suspend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
begin
  if new.reason <> 'conduct' then
    return new;
  end if;

  -- Read from the session, never from anything the caller supplied.
  select s.teacher_id into v_teacher_id
    from public.sessions s
   where s.id = new.session_id;
  if v_teacher_id is null then
    return new;
  end if;

  -- Already under review: do not stack rows. The open suspension covers this.
  if exists (
    select 1 from public.teacher_suspensions ts
     where ts.teacher_id = v_teacher_id and ts.lifted_at is null
  ) then
    return new;
  end if;

  -- Spec §12's anti-abuse cap: one auto-suspension per reporter per teacher,
  -- ever. A second report from the same student still files and still alerts;
  -- it does not re-suspend. Kills the repeat vector without discarding
  -- evidence. Three lines here versus a separate feature later.
  if exists (
    select 1 from public.teacher_suspensions ts
      join public.session_reports r on r.id = ts.session_report_id
     where ts.teacher_id = v_teacher_id
       and r.reporter_id = new.reporter_id
  ) then
    return new;
  end if;

  insert into public.teacher_suspensions (teacher_id, session_report_id)
  values (v_teacher_id, new.id);

  return new;
end;
$$;

create trigger on_conduct_report_suspend
  after insert on public.session_reports
  for each row execute function public.on_conduct_report_suspend();
```

- [ ] **Step 7: Check the file carries no transaction control**

Run: `grep -niE '^\s*(begin|commit|rollback)\s*;' supabase/migrations/0020_teacher_suspensions.sql`
Expected: no output. `db push` wraps each file in its own transaction.

- [ ] **Step 8: Confirm the migration is the only pending one**

Run: `supabase migration list`
Expected: every row shows LOCAL == REMOTE except `0020`, which shows LOCAL with an empty REMOTE.

- [ ] **Step 9: 🛑 HUMAN GATE — apply it**

Applying DDL is blocked inside Claude Code by the permission classifier, deliberately. Ask the human to run:

```bash
supabase db push
supabase migration list   # 0020 must now show LOCAL == REMOTE
```

**Do not proceed to Task 3 until they confirm.** The probe in Step 10 and every test after it runs against the applied schema.

- [ ] **Step 10: Write and run the probe**

Create `scripts/probe-suspension.mjs`, following `scripts/probe-session-reports.mjs` exactly — same imports from `./probe-accounts.mjs` (`readEnv`, `jsonHeaders`, `serviceHeaders`, `userHeaders`, `createThrowawayUser`, `deleteThrowawayUser`, `profileCount`), same `ok(pass, label)` reporter, same create-then-clean-up structure with a `profileCount` check either side.

Remember the hazard inherited from `session_reports`: **its inserts must send `prefer: return=minimal`**, because that table has no SELECT policy and `RETURNING` is refused with `42501`. `teacher_suspensions` has the same shape, so the same rule applies to it.

Assertions:

| # | Setup | Expect |
|---|---|---|
| 1 | student reports `conduct` on a session with teacher T | exactly 1 open row for T (read as service role) |
| 2 | student reports `technical` on a session with teacher T2 | 0 rows for T2 |
| 3 | a second `conduct` report from the same student on T | still exactly 1 row |
| 4 | `reinstate_teacher(T, 'reinstated', 'probe')` then a third `conduct` report from the **same** student | still 1 row, now lifted — the per-reporter cap holds across a lift |
| 5 | same as 4 but the report comes from a **different** student | a second row, open |
| 6 | `available_teachers(...)` while T is suspended | T absent |
| 7 | `available_teachers(...)` after reinstatement | T present |
| 8 | teacher T's own token selects `teacher_suspensions` | 0 rows (RLS on, no policy) |
| 9 | teacher T's own token calls `my_suspension()` | a timestamp while open, null after a lift |
| 10 | `reinstate_teacher` on a teacher with no open suspension | error, not a silent no-op |
| 11 | student A's token sets student B's `pending` session to `cancelled` | refused — the widening must not reach user tokens |
| 12 | teacher T's token sets one of their own sessions to `cancelled` | refused |
| 13 | the service role sets a `pending` session to `cancelled` with `cancellation_reason` | permitted — this is what the widening bought |
| 14 | student A's token sets `cancellation_reason` on their own session | refused, `cancellation_reason is set by the server only` |

Run: `node scripts/probe-suspension.mjs`
Expected: all PASS, and the trailing profile count equal to the leading one.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/0020_teacher_suspensions.sql scripts/probe-suspension.mjs
git commit -m "feat(db): suspension state, and the RPCs that open and lift it

available_teachers gains one clause; a security definer trigger opens a
suspension atomically with a conduct report, carrying the per-reporter cap.

Two guard changes are stated rather than slipped in. enforce_session_update
refused cancellation from anyone but the session's own student, and since
uid is null for the service role, null IS DISTINCT FROM student_id is true
— so nobody could cancel but that student. It now reads 'the student, or
the service role'. cancellation_reason joins the server-set columns.

teacher_suspensions gets RLS on and no policy, as 0016 does for
session_reports: the row carries session_report_id, and a teacher who can
read it can identify the student who reported them."
```

---

### Task 3: `settleSuspension`

The idempotent half. Pure logic plus the service-role client; no UI.

**Files:**
- Create: `src/lib/suspension/settle.ts`
- Create: `src/lib/suspension/settle.test.ts`

**Interfaces:**
- Consumes: `refundSession` from `@/lib/payments/refund` (Task 1)
- Produces: `settleSuspension(teacherId: string): Promise<boolean>` — `false` when no suspension is open (it did nothing), `true` once it has acted. Task 4's waiting page needs that answer to decide whether to re-read the row.

- [ ] **Step 1: Write the failing test**

Create `src/lib/suspension/settle.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const refundSession = vi.fn();
vi.mock("@/lib/payments/refund", () => ({ refundSession }));

const rows: Array<Record<string, unknown>> = [];
const updateSpy = vi.fn();
// settleSuspension gatekeeps itself: it reads teacher_suspensions first and
// returns early when nothing is open. Default to "one is open" so the
// session-handling tests exercise the path they are about.
let openSuspension: { id: string } | null = { id: "sus_1" };

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "teacher_suspensions") {
        const s: Record<string, unknown> = {
          select: () => s,
          eq: () => s,
          is: () => s,
          maybeSingle: () => Promise.resolve({ data: openSuspension, error: null }),
        };
        return s;
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => Promise.resolve({ data: rows, error: null }),
        update: (patch: unknown) => {
          updateSpy(patch);
          return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
        },
      };
      return chain;
    },
  }),
}));

const { settleSuspension } = await import("./settle");

beforeEach(() => {
  rows.length = 0;
  openSuspension = { id: "sus_1" };
  refundSession.mockReset();
  updateSpy.mockReset();
});

describe("settleSuspension", () => {
  // The gate. This is what lets the waiting page and the dashboard call it on
  // every load without a suspension check of their own — and without either
  // page component needing the service role to perform one.
  it("does nothing when the teacher has no open suspension", async () => {
    openSuspension = null;
    rows.push({ id: "a", status: "paid", payment_ref: "pay_1", amount_paid_paise: 50000 });
    await settleSuspension("t1");
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
  });

  it("cancels pending and accepted, and stamps the reason", async () => {
    rows.push(
      { id: "a", status: "pending", payment_ref: null, amount_paid_paise: null },
      { id: "b", status: "accepted", payment_ref: null, amount_paid_paise: null }
    );
    await settleSuspension("t1");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        cancellation_reason: "teacher_suspended",
      })
    );
    expect(refundSession).not.toHaveBeenCalled();
  });

  it("refunds a paid session rather than cancelling it", async () => {
    rows.push({
      id: "c", status: "paid", payment_ref: "pay_1", amount_paid_paise: 50000,
    });
    await settleSuspension("t1");
    expect(refundSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: "c", paymentRef: "pay_1", amountPaise: 50000,
        nextStatus: "refunded", logPrefix: "[suspension]",
      })
    );
  });

  it("leaves an active session alone", async () => {
    rows.push({ id: "d", status: "active", payment_ref: "pay_2", amount_paid_paise: 50000 });
    await settleSuspension("t1");
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
  });

  // The property that makes it safe to call from a page load.
  it("issues the refund once when called twice", async () => {
    rows.push({ id: "c", status: "paid", payment_ref: "pay_1", amount_paid_paise: 50000 });
    await settleSuspension("t1");
    rows.length = 0;              // second pass: the row is no longer `paid`
    await settleSuspension("t1");
    expect(refundSession).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the teacher has no sessions in flight", async () => {
    await settleSuspension("t1");
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refundSession).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/suspension/settle.test.ts`
Expected: FAIL — `Failed to resolve import "./settle"`.

- [ ] **Step 3: Implement**

Create `src/lib/suspension/settle.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import { refundSession } from "@/lib/payments/refund";

// SERVER ONLY. Holds the service role.
//
// Deliberately shaped like src/lib/payments/settle.ts, which established the
// pattern: idempotent, and therefore safe to call from a page load as well as
// from the action that caused it. That is what guarantees a student whose
// teacher was just suspended gets their refund even if the REPORTER's request
// died halfway through — no cron, no queue.
//
// Why this is not in the trigger: security definer changes the privilege, not
// the claim, so auth.uid() inside on_conduct_report_suspend is still the
// reporting student. And a refund has to call the payment provider, which SQL
// cannot do.

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

export async function settleSuspension(teacherId: string): Promise<boolean> {
  const db = admin();

  // The gate, here rather than in each caller. teacher_suspensions has no
  // SELECT policy (0020), so a page component could not perform this check
  // through the user's own client anyway — and the alternative, handing a
  // page the service role to do it, is worse than making the pass gatekeep
  // itself. Callers may therefore call this unconditionally.
  const { data: open } = await db
    .from("teacher_suspensions")
    .select("id")
    .eq("teacher_id", teacherId)
    .is("lifted_at", null)
    .maybeSingle();
  if (!open) return false;

  // `active` is absent on purpose: a lesson already under way finishes
  // (spec §3.4). The child in that call is a different student who reported
  // nothing and has paid.
  const { data: sessions, error } = await db
    .from("sessions")
    .select("id, status, payment_ref, amount_paid_paise")
    .eq("teacher_id", teacherId)
    .in("status", ["pending", "accepted", "paid"]);

  if (error) {
    console.error(`[suspension] could not read sessions for ${teacherId}:`, error);
    return;
  }

  for (const s of sessions ?? []) {
    if (s.status === "paid") {
      // Money moved and the lesson has not started. refundSession is guarded
      // on `refund_ref is null`, so a second pass issues nothing.
      if (!s.payment_ref || !s.amount_paid_paise) {
        console.error(
          `[suspension] session ${s.id} is paid but carries no payment reference — ` +
            `needs manual action; not cancelling it blind.`
        );
        continue;
      }
      await refundSession(db, {
        sessionId: s.id,
        paymentRef: s.payment_ref,
        amountPaise: s.amount_paid_paise,
        nextStatus: "refunded",
        why: "teacher suspended pending review",
        logPrefix: "[suspension]",
      });
      continue;
    }

    // pending / accepted: no money has moved. Payment happens AFTER accept,
    // so `accepted` means the teacher said yes and the student has not paid.
    // Guarded on the status we read, so a session that moved on underneath us
    // (a student paying in the same second) is not clobbered.
    const { error: cancelError } = await db
      .from("sessions")
      .update({ status: "cancelled", cancellation_reason: "teacher_suspended" })
      .eq("id", s.id)
      .eq("status", s.status);
    if (cancelError) {
      console.error(`[suspension] could not cancel ${s.id}:`, cancelError);
    }
  }

  return true;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/suspension/settle.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/suspension/
git commit -m "feat(suspension): the idempotent cancel-and-refund pass

Shaped like payments/settle.ts because it needs the same property: safe to
call from a page load, so a paid student is refunded even if the reporter's
request died. active is left alone by design — that lesson's student
reported nothing and has paid."
```

---

### Task 4: Wire the settle pass to its three callers

Suspension is instant the moment the trigger fires — `available_teachers` excludes them with no application help. This task is about the *cleanup* reaching everyone even when a request dies.

**Files:**
- Modify: `src/app/(app)/(student)/sessions/actions.ts:74`
- Modify: `src/app/(app)/(teacher)/dashboard/page.tsx` (after the existing queries)
- Modify: `src/app/(app)/(student)/waiting/[sessionId]/page.tsx` (before the exit branch)

**Interfaces:**
- Consumes: `settleSuspension` from `@/lib/suspension/settle` (Task 3)

- [ ] **Step 1: The fast path — after a report is filed**

In `src/app/(app)/(student)/sessions/actions.ts`, after the existing `reportError(...)` alerting call and before `return { ok: true }`:

```ts
  // The trigger has already opened the suspension if this was a conduct
  // report — that part is atomic with the insert and cannot be lost. This is
  // the cleanup: cancelling and refunding what the suspended teacher had in
  // flight. It is best-effort HERE and guaranteed elsewhere, because the same
  // idempotent pass runs on the affected student's waiting page and on the
  // teacher's dashboard. A reporter's browser dying must not leave another
  // student holding a paid session.
  if (input.reason === "conduct") {
    const { data: reported } = await supabase
      .from("sessions")
      .select("teacher_id")
      .eq("id", input.sessionId)
      .maybeSingle();
    if (reported?.teacher_id) {
      try {
        await settleSuspension(reported.teacher_id);
      } catch {
        // Optional catch binding: this repo's eslint reports an unused `e`.
        reportError(new Error("settleSuspension failed after a conduct report"), {
          where: "reportSession.settle",
          sessionId: input.sessionId,
        });
      }
    }
  }
```

Add the import: `import { settleSuspension } from "@/lib/suspension/settle";`

- [ ] **Step 2: The teacher's dashboard**

In `src/app/(app)/(teacher)/dashboard/page.tsx`, after `requireRole("teacher")` and the existing queries, add:

```ts
  // Idempotent, and this is one of the two guaranteed paths: if the reporter's
  // request died before the cleanup ran, it runs here instead.
  const { data: suspendedAt } = await supabase.rpc("my_suspension");
  if (suspendedAt) await settleSuspension(identity.userId);
```

`suspendedAt` is reused by Task 5. Add the import.

- [ ] **Step 3: The waiting student**

In `src/app/(app)/(student)/waiting/[sessionId]/page.tsx`, add `cancellation_reason` to the select at line 17 — **Task 6 relies on this edit and must not repeat it** — then immediately before the `if (status === "active")` line:

```ts
  // The other guaranteed path. A student sitting on this page whose teacher
  // was just suspended gets their refund here, without depending on the
  // reporter's request having finished.
  //
  // Called unconditionally for in-flight statuses: settleSuspension gatekeeps
  // itself on an open suspension. This page must NOT perform that check —
  // teacher_suspensions has no SELECT policy, so the student's own client
  // reads nothing, and handing a page component the service role to work
  // around that is exactly the wrong fix.
  if (session.status === "pending" || session.status === "accepted" || session.status === "paid") {
    await settleSuspension(session.teacher_id);
    // Re-read: the pass may have changed the row underneath this render.
    redirect(`/waiting/${sessionId}`);
  }
```

**Careful — that `redirect` as written loops forever**, because the condition is true again on the next render whenever no suspension existed. Guard it on the row actually having changed:

```ts
  if (session.status === "pending" || session.status === "accepted" || session.status === "paid") {
    const settled = await settleSuspension(session.teacher_id);
    if (settled) redirect(`/waiting/${sessionId}`);
  }
```

`settleSuspension` already returns `boolean` from Task 3 — `false` from the early gate, `true` once it has acted — so no signature change is needed here. Confirm the behaviour is pinned by adding to `src/lib/suspension/settle.test.ts`:

```ts
  it("reports whether it acted, so a caller can re-read the row", async () => {
    openSuspension = null;
    expect(await settleSuspension("t1")).toBe(false);
    openSuspension = { id: "sus_1" };
    expect(await settleSuspension("t1")).toBe(true);
  });
```

- [ ] **Step 4: Verify**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/ src/lib/suspension/
git commit -m "feat(suspension): run the cleanup from all three paths

Best-effort after the report, guaranteed on the teacher's dashboard and on
the affected student's waiting page. The open-suspension check moved inside
settleSuspension so the pass gatekeeps itself and no page component holds
the service role."
```

---

### Task 5: What the teacher sees

Without this the teacher vanishes from search while their toggle still says "you're live" — it reads as a bug in the product rather than as a consequence.

**Files:**
- Modify: `src/components/status-pill.tsx:6, 8-37`
- Modify: `src/app/(app)/(teacher)/dashboard/availability-toggle.tsx:21-53, 248, 273`
- Modify: `src/app/(app)/(teacher)/dashboard/page.tsx`
- Modify: `src/components/status-pill.test.tsx`

**Interfaces:**
- Consumes: `my_suspension()` (Task 2), `suspendedAt` from Task 4 Step 2
- Produces: `TeacherStatus` gains `"suspended"`; `AvailabilityToggle` gains a `suspended: boolean` prop

- [ ] **Step 1: Write the failing test**

Append to `src/components/status-pill.test.tsx`, **and add `"suspended"` to the existing `ALL` array at the top of that file** — otherwise the new state is the only one no test exercises:

```tsx
it("has copy for the suspended state that does not name a reporter", () => {
  const copy = STATUS_COPY.suspended;
  expect(copy.label).toBe("Account under review");
  expect(copy.description).toMatch(/cannot receive new requests/i);
  // A teacher learning which session was reported learns who reported them.
  expect(copy.description).not.toMatch(/report|student|session with/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/status-pill.test.tsx`
Expected: FAIL — `Cannot read properties of undefined (reading 'label')`.

- [ ] **Step 3: Add the state**

In `src/components/status-pill.tsx`, extend the type and the map:

```ts
export type TeacherStatus =
  | "offline" | "available" | "in_session" | "unreachable" | "suspended";
```

```ts
  suspended: {
    label: "Account under review",
    // Says what is true and nothing more. It must not name the report, the
    // session or the student — a teacher who learns which session was
    // reported learns who reported them, and this is a child-safety feature.
    description:
      "You cannot receive new requests while a review of your account is open. Contact support if you have questions.",
    tone: "bg-destructive/12 text-destructive",
  },
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/status-pill.test.tsx`
Expected: PASS.

- [ ] **Step 5: Make the toggle respect it**

In `availability-toggle.tsx`, add `suspended` to the props interface (around line 21-53), then at line 248:

```ts
  // Suspension outranks every other state: the server has already stopped
  // showing them to students, so the pill must not claim otherwise.
  const status: TeacherStatus = suspended
    ? "suspended"
    : !leaseLive
    ? /* ...existing expression unchanged... */
    : /* ... */;
```

and disable the control — add `|| suspended` to the `disabled` prop of the go-available button, so the teacher cannot toggle themselves back into a list they are excluded from.

- [ ] **Step 6: Pass it through**

`dashboard/page.tsx` already has `suspendedAt` from Task 4 Step 2. Pass `suspended={suspendedAt !== null}` into `DashboardLive`, and through `DashboardLive` into `AvailabilityToggle`.

- [ ] **Step 7: Verify**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npm run build`
Expected: all pass. The guard tests confirm no literal colours or emoji were introduced.

- [ ] **Step 8: Commit**

```bash
git add src/components/status-pill.tsx src/components/status-pill.test.tsx 'src/app/(app)/(teacher)/dashboard/'
git commit -m "feat(teacher): a suspended teacher is told, without learning who reported them

Suspension joins the shared TeacherStatus vocabulary rather than arriving as
a bolted-on banner, and outranks every other state — the server has already
stopped showing them, so the pill must not claim otherwise. The copy names
no report, session or student; a test asserts it."
```

---

### Task 6: What the student sees

A student whose session was cancelled by someone else's report is owed an explanation that does not name the report, the reason, or the other student.

**Files:**
- Modify: `src/app/(app)/(student)/waiting/[sessionId]/page.tsx:64-71`
- Modify: `src/app/(app)/(student)/teachers/online-list.tsx:24-57`
- Modify: `src/app/(app)/(student)/sessions/page.tsx:44-46, 104-118`
- Create: `src/app/(app)/(student)/teachers/online-list.test.tsx` (does not exist yet)

**Interfaces:**
- Consumes: `sessions.cancellation_reason` (Task 2)

- [ ] **Step 1: Write the failing test**

The waiting page's own comment says a `cancelled` session shows no banner *"because they cancelled on purpose"* — which is false here.

Create `src/app/(app)/(student)/teachers/online-list.test.tsx` following `src/components/status-pill.test.tsx` verbatim in shape — first line `// @vitest-environment jsdom`, then `render` and `screen` from `@testing-library/react`. The vitest environment is `node` by default in this repo and component tests opt in per file.

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { outcomeMessage } from "./online-list";

describe("outcomeMessage", () => {
  it("explains a teacher-unavailable cancellation without mentioning a report", () => {
    render(<div data-testid="m">{outcomeMessage("teacher_unavailable", "Ms Rao", 50000)}</div>);
    const text = screen.getByTestId("m").textContent ?? "";
    expect(text).toMatch(/no longer available/i);
    // The student must not learn that a report exists — that is a disclosure
    // about a third party's complaint.
    expect(text).not.toMatch(/report|suspend|review/i);
  });

  it("says the student was not charged when no refund travelled", () => {
    render(<div data-testid="m">{outcomeMessage("teacher_unavailable", "Ms Rao", undefined)}</div>);
    expect(screen.getByTestId("m").textContent).toMatch(/not been charged/i);
  });
});
```

Export `outcomeMessage` from `online-list.tsx` so it can be tested directly.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/\(app\)/\(student\)/teachers/`
Expected: FAIL — `outcomeMessage` is not exported, or returns null.

- [ ] **Step 3: Add the outcome**

In `online-list.tsx`'s `outcomeMessage` switch, before `default`:

```tsx
    case "teacher_unavailable":
      // Never "the teacher was reported": the student learning that a report
      // exists is a disclosure about a third party's complaint. What they
      // need is that the session is off and where their money went.
      return refundAmountPaise ? (
        <>
          {who} is no longer available, so that session can&apos;t go ahead.
          Your <Money paise={refundAmountPaise} /> has been refunded — it can
          take a few days to show on your statement. These teachers are free
          now.
        </>
      ) : (
        `${who} is no longer available, so that session can't go ahead. You have not been charged — these teachers are free now.`
      );
```

- [ ] **Step 4: Route to it from the waiting page**

`cancellation_reason` is already in this page's select — Task 4 Step 3 added it. Do not add it again. Replace the exit branch:

```ts
  if (status !== "pending" && status !== "accepted" && status !== "paid") {
    // A suspension-cancelled session outranks both. The old branch sent a
    // `cancelled` row to outcome=cancelled — which shows no banner, because
    // the student is assumed to have cancelled it themselves. They did not.
    if (session.cancellation_reason === "teacher_suspended") {
      redirect(exitTo("teacher_unavailable"));
    }
    redirect(exitTo(session.refund_ref ? "refunded" : status));
  }
```

`exitTo` already attaches `amount` only for `"refunded"`. Widen that condition so the refund figure travels here too:

```ts
      ...(outcome === "refunded" || outcome === "teacher_unavailable"
        ? { amount: String(amountPaise) }
        : {}),
```

- [ ] **Step 5: Show it in the history**

In `sessions/page.tsx`, add `cancellation_reason` to the `.select(...)` at line 44-46, then after the `Refunded` pill block (line ~114-118):

```tsx
                            {s.cancellation_reason === "teacher_suspended" && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                Teacher unavailable
                              </span>
                            )}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/(app)/(student)/'
git commit -m "feat(student): say why a session was cancelled, without naming the report

The waiting page's own comment said a cancelled row shows no banner
'because they cancelled on purpose'. A suspension-cancelled pending session
hit exactly that path, so the student was told they cancelled it themselves.
It now routes to its own outcome, and the refund figure travels with it."
```

---

### Task 7: `/terms` matches what the product does

**Files:**
- Modify: `src/app/(marketing)/terms/page.tsx:190-195`

- [ ] **Step 1: Replace the wording**

The published sentence claims more than the build does — an `active` lesson finishes (spec §3.4). Replace lines 190-195:

```tsx
                <li>
                  <strong>Reports Pending Review:</strong> A conduct report
                  filed against your account opens a review and suspends your
                  account. You will not receive or be able to accept new
                  session requests while the review is open, and any session
                  that has not yet started is cancelled and refunded to the
                  student. A session already under way may finish.
                </li>
```

- [ ] **Step 2: Verify the marketing guards still pass**

Run: `npx vitest run "src/app/(marketing)"`
Expected: PASS — no emoji, no literal colours, no stock-photo hotlinks.

- [ ] **Step 3: Full verification**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npm run build`
Expected: all four at zero.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/(marketing)/terms/page.tsx'
git commit -m "docs(terms): the suspension clause now describes what the product does

It said a teacher may not 'accept or continue' sessions during a review. An
active lesson finishes, by decision. Closing one terms-versus-reality gap
while leaving a smaller one open would repeat the mistake this whole change
exists to correct."
```

---

## Done when

- `npx vitest run` green, `npx tsc --noEmit` 0, `npx eslint .` 0 errors, `npm run build` 0 — each run, with output quoted.
- `node scripts/probe-suspension.mjs` all PASS, profile count unchanged.
- `supabase migration list` shows `0020` LOCAL == REMOTE.
- A `conduct` report against a teacher with a `pending`, an `accepted` and a `paid` session leaves: one open suspension row, two `cancelled` rows carrying `teacher_suspended`, one `refunded` row with a `refund_ref`, and that teacher absent from `available_teachers()`.
- `/terms` describes that behaviour and no more.
