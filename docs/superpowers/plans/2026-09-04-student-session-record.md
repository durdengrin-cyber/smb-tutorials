# Student Session Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a student a record at `/sessions` of every session where money moved, and a way to report a problem with one.

**Architecture:** One new server-rendered page in the existing `(app)/(student)` route group, reusing the teacher `SessionHistory` pattern. A pure filter function decides which sessions appear, so the rule is unit-testable without a database. Reports go through a server action into a new `session_reports` table whose RLS permits insert-only, scoped to sessions the caller was actually in, and permits no select at all.

**Tech Stack:** Next.js 16.3.2 (App Router, server components, server actions) · Supabase Postgres + RLS · Tailwind + shadcn/ui · Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-student-session-record-design.md`

## Global Constraints

- **This Next.js is not the one you remember.** Read `node_modules/next/dist/docs/` before using any Next API. Do not write a Next API from memory.
- **No new dependencies.** Everything needed is already installed. `resend` is explicitly NOT to be installed in this cycle (spec §8 item 1).
- **Migrations are numbered and applied by the USER, never by an agent.** The next free number is `0016`. Do not run migrations. Do not apply `0006` — it is deliberately unapplied.
- **Revoke from `anon` and `authenticated` BY NAME** before granting any function. Supabase's default privileges grant EXECUTE to both explicitly, and `revoke ... from public` does not remove a named role's grant. Migration `0012` shipped this exact bug to production.
- **Every `security definer` function sets `search_path` AND schema-qualifies every reference** (`public.sessions`, not `sessions`). Five for five on this branch; keep it that way.
- **Money is rendered by `<Money paise={n} />`** (`src/components/money.tsx`). Never format a currency symbol by hand.
- **Times render in `Asia/Kolkata`** with `toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })`. The server runs UTC on Vercel; omitting the zone is silently 5:30 wrong.
- **Never log or store lesson content** in a report. Ids, the reason, and the reporter's own words only.
- **Gates before every commit:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, `npm run build` — all must pass.

---

### Task 1: The money-touched filter

Pure function, no database. This is the rule the whole page depends on, and the spec (§4) chose a fact about money over a status allowlist because statuses have already changed twice in this project.

**Files:**
- Create: `src/lib/student-sessions.ts`
- Test: `src/lib/student-sessions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export interface PaidSessionRow { amount_paid_paise: number | null; refund_ref: string | null }` and `export function moneyTouched(s: PaidSessionRow): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { moneyTouched } from "./student-sessions";

describe("moneyTouched", () => {
  // Stated as a fact about money rather than a list of status names: statuses
  // changed in 0002 and again in 0005, and a name list drifts silently.
  it("includes a session that was paid for", () => {
    expect(moneyTouched({ amount_paid_paise: 50000, refund_ref: null })).toBe(true);
  });

  it("includes a refunded session even though the money came back", () => {
    // A parent reconciling a bank statement sees a charge AND a reversal.
    // Hiding this row leaves them with a refund they cannot explain.
    expect(moneyTouched({ amount_paid_paise: 50000, refund_ref: "rfnd_1" })).toBe(true);
  });

  it("includes a refund recorded with no amount still on the row", () => {
    expect(moneyTouched({ amount_paid_paise: null, refund_ref: "rfnd_1" })).toBe(true);
  });

  it("includes a session cancelled AFTER it was paid for", () => {
    // Named in spec §6 because a status allowlist gets this one wrong: the
    // status reads `cancelled`, but the money moved and came back.
    expect(moneyTouched({ amount_paid_paise: 50000, refund_ref: "rfnd_2" })).toBe(true);
  });

  it("excludes a session whose payment window expired", () => {
    // Also named in spec §6: `payment_expired` looks like a real outcome but
    // nothing was ever charged, so it does not belong in a record of charges.
    expect(moneyTouched({ amount_paid_paise: null, refund_ref: null })).toBe(false);
  });

  it("excludes a request where nothing was ever charged", () => {
    // A student who tapped five teachers before one answered must not see
    // five rows for one lesson.
    expect(moneyTouched({ amount_paid_paise: null, refund_ref: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/student-sessions.test.ts`
Expected: FAIL — `Failed to resolve import "./student-sessions"`.

- [ ] **Step 3: Write the implementation**

```ts
// Which sessions belong in a student's record (spec §4).
//
// Deliberately a fact about MONEY, not a list of status names. `sessions`
// statuses changed in 0002 and again in 0005; a status allowlist would have
// drifted silently both times. "Money touched this row" cannot drift.
export interface PaidSessionRow {
  amount_paid_paise: number | null;
  refund_ref: string | null;
}

export function moneyTouched(s: PaidSessionRow): boolean {
  return s.amount_paid_paise !== null || s.refund_ref !== null;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/student-sessions.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/student-sessions.ts src/lib/student-sessions.test.ts
git commit -m "feat(sessions): the money-touched rule for a student's record"
```

---

### Task 2: Migration 0016 — session_reports

Writing the SQL only. **You do not apply it.** The user applies migrations; §"Global Constraints" says so and this project has already shipped one grant bug to production by being casual here.

**Files:**
- Create: `supabase/migrations/0016_session_reports.sql`

**Interfaces:**
- Produces: table `public.session_reports` with columns `id, session_id, reporter_id, reason, detail, created_at`; `reason` constrained to `no_show | left_early | technical | teaching_quality | conduct | other`.

- [ ] **Step 1: Write the migration**

```sql
-- Cycle 3, spec §5. The first reporting path in this product.
--
-- Until now a student or parent had no way to tell anyone that something went
-- wrong in a lesson: no report button, no block, nowhere for it to go. That is
-- part of the child-safety gap, and a session row already naming the teacher,
-- the subject and the date is the cheapest place to close it.
begin;

create table if not exists public.session_reports (
  id          uuid primary key default gen_random_uuid(),
  -- cascade: a report about a deleted session has nothing left to describe.
  session_id  uuid not null references public.sessions (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  -- Fixed list, enforced here, so a report cannot arrive carrying a reason
  -- nothing knows how to triage. 'conduct' is the one this feature exists for.
  reason      text not null check (reason in (
                'no_show', 'left_early', 'technical',
                'teaching_quality', 'conduct', 'other'
              )),
  -- The reporter's own words, optional. NEVER lesson content.
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists session_reports_session_idx
  on public.session_reports (session_id);

alter table public.session_reports enable row level security;

-- INSERT only, and only for a session the caller was actually in. Without the
-- subquery, any signed-in user could file a report against any session id they
-- guessed, and the report names a teacher.
create policy session_reports_insert on public.session_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
       where s.id = session_id
         and s.student_id = (select auth.uid())
    )
  );

-- NO SELECT POLICY, deliberately. With RLS on and no policy, every ordinary
-- client is refused and only the service role can read. A report may describe
-- a child; it must not be one policy mistake away from being readable by other
-- users — including by the teacher it is about. Reports are read by an
-- operator script until admin exists (spec §8 item 2).

commit;
```

- [ ] **Step 2: Confirm the number is free and nothing else was touched**

Run: `ls supabase/migrations/ | tail -3`
Expected: `0014_signup_consent.sql`, `0015_notification_events.sql`, `0016_session_reports.sql`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0016_session_reports.sql
git commit -m "feat(db): session_reports, insert-only and readable by no client"
```

- [ ] **Step 4: Hand the migration to the user**

Print the file contents and tell them to run it in the Supabase SQL editor for project `upggvzzzoxqgourjywtd`. **Stop and wait for confirmation before Task 3** — Task 3's probe cannot pass until this is applied.

---

### Task 3: Probe the report RLS against the live database

The house style: security is proved against the real database, not by reading the policy. `scripts/probe-role-guard.mjs` is the model — read it before writing this.

**Files:**
- Create: `scripts/probe-session-reports.mjs`

**Interfaces:**
- Consumes: `readEnv`, `jsonHeaders`, `serviceHeaders`, `userHeaders`, `createThrowawayUser`, `deleteThrowawayUser`, `profileCount` from `./probe-accounts.mjs`. Note the real signatures: `createThrowawayUser(env, { role, fullName, hourlyRate })`, `deleteThrowawayUser(env, id)`, `userHeaders(env, token)`.
- Produces: an executable probe exiting 0 on success, 1 on any failure.

- [ ] **Step 1: Write the probe**

```js
#!/usr/bin/env node
// Cycle 3, spec §6. session_reports is the first table in this product whose
// rows may describe a child, so "who can read this" is the question that
// matters most about it.
//
// Usage: node scripts/probe-session-reports.mjs
import {
  readEnv, jsonHeaders, serviceHeaders, userHeaders,
  createThrowawayUser, deleteThrowawayUser, profileCount,
} from "./probe-accounts.mjs";

const env = readEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
let failures = 0;
const ok = (pass, label) => {
  console.log(`  ${pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${label}`);
  if (!pass) failures++;
};

const before = await profileCount(env);
const created = [];

try {
  const student = await createThrowawayUser(env, { role: "student", fullName: "Report Probe" });
  created.push(student.id);
  const teacher = await createThrowawayUser(env, { role: "teacher", fullName: "Probe Teacher", hourlyRate: 500 });
  created.push(teacher.id);
  const outsider = await createThrowawayUser(env, { role: "student", fullName: "Outsider" });
  created.push(outsider.id);

  const SH = userHeaders(env, student.token);
  const OH = userHeaders(env, outsider.token);
  const TH = userHeaders(env, teacher.token);

  // Seed a session the student was in, via the service role.
  const sess = await (await fetch(`${URL}/rest/v1/sessions`, {
    method: "POST",
    headers: { ...jsonHeaders(serviceHeaders(env)), prefer: "return=representation" },
    body: JSON.stringify({
      student_id: student.id, teacher_id: teacher.id,
      curriculum: "CBSE", grade: "10th", stream: "Science", subject: "Physics",
      hourly_rate: 500, status: "pending",
      accept_deadline: new Date(Date.now() + 120_000).toISOString(),
    }),
  })).json();
  const sessionId = sess?.[0]?.id;
  if (!sessionId) throw new Error(`could not seed a session (setup, not the test): ${JSON.stringify(sess).slice(0, 300)}`);

  const report = async (H, reporterId, reason = "conduct") =>
    fetch(`${URL}/rest/v1/session_reports`, {
      method: "POST", headers: jsonHeaders(H),
      body: JSON.stringify({ session_id: sessionId, reporter_id: reporterId, reason, detail: "probe" }),
    });

  // 1. The participant may report.
  const mine = await report(SH, student.id);
  ok(mine.ok, `the student in the session can file a report (HTTP ${mine.status})`);

  // 2. A stranger may not — the report names a teacher, and a session id is
  //    guessable enough that the policy must check participation.
  const theirs = await report(OH, outsider.id);
  ok(!theirs.ok, `a student NOT in the session is refused (HTTP ${theirs.status})`);

  // 3. Nor may they file one under someone else's id.
  const spoof = await report(OH, student.id);
  ok(!spoof.ok, `a student cannot file a report under another user's id (HTTP ${spoof.status})`);

  // 4. THE ONE THAT MATTERS: no client can read reports at all.
  const readMine = await fetch(`${URL}/rest/v1/session_reports?select=*`, { headers: SH });
  const rowsMine = readMine.ok ? await readMine.json() : null;
  ok(readMine.ok && Array.isArray(rowsMine) && rowsMine.length === 0,
     `the reporter reads back ZERO reports, including their own (HTTP ${readMine.status}, ${rowsMine?.length ?? "?"} rows)`);

  // 5. Least of all the teacher the report is about.
  const readTeacher = await fetch(`${URL}/rest/v1/session_reports?select=*`, { headers: TH });
  const rowsTeacher = readTeacher.ok ? await readTeacher.json() : null;
  ok(Array.isArray(rowsTeacher) && rowsTeacher.length === 0,
     `the reported teacher reads back ZERO reports (${rowsTeacher?.length ?? "?"} rows)`);

  // 6. The operator can, or the feature is write-only theatre.
  const readService = await (await fetch(
    `${URL}/rest/v1/session_reports?select=*&session_id=eq.${sessionId}`,
    { headers: serviceHeaders(env) })).json();
  ok(Array.isArray(readService) && readService.length === 1,
     `the service role reads the report back (${readService?.length ?? "?"} rows)`);

  // 7. A reason outside the fixed list is refused by the constraint.
  const badReason = await report(SH, student.id, "whatever");
  ok(!badReason.ok, `an unknown reason is refused (HTTP ${badReason.status})`);

  await fetch(`${URL}/rest/v1/sessions?id=eq.${sessionId}`, { method: "DELETE", headers: serviceHeaders(env) });
} finally {
  console.log("\ncleanup");
  for (const id of created) {
    const gone = await deleteThrowawayUser(env, id);
    if (!gone) { console.log(`  \x1b[31mLEAKED\x1b[0m ${id} — remove by hand`); failures++; }
  }
  const after = await profileCount(env);
  ok(after === before, `profiles returned to ${before} row(s) (now ${after})`);
}

console.log(failures === 0
  ? "\n\x1b[32mALL CLEAR\x1b[0m — reports are insert-only, participant-scoped, and readable by no client."
  : `\n\x1b[31m${failures} FAILURE(S)\x1b[0m`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it**

Run: `node scripts/probe-session-reports.mjs`
Expected: 8 PASS lines, `ALL CLEAR`, exit 0. If assertion 4 or 5 fails, **stop** — a readable report table is the one outcome this task exists to prevent.

- [ ] **Step 3: Commit**

```bash
git add scripts/probe-session-reports.mjs
git commit -m "test(db): probe that session reports are insert-only and unreadable"
```

---

### Task 4: The report server action

**Files:**
- Create: `src/app/(app)/(student)/sessions/reasons.ts`
- Create: `src/app/(app)/(student)/sessions/actions.ts`
- Test: `src/app/(app)/(student)/sessions/actions.test.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`; `reportError` from `@/lib/observability/report`.
- Produces: `reasons.ts` exports `REPORT_REASONS` (readonly tuple) and `type ReportReason`. `actions.ts` exports `async function reportSession(input: { sessionId: string; reason: string; detail: string }): Promise<{ ok: true } | { error: string }>`.

> **Why the constant lives in its own file.** `actions.ts` carries `"use server"`, and in a
> `"use server"` module **only async functions may be exported**. Exporting a plain `const` there
> empties the module and every import of it fails — `tsc` does NOT catch this; only `npm run
> build` does. This project hit exactly that bug on 2026-09-04 (`CONSENT_VERSION` in
> `src/app/auth/actions.ts`). Keep `REPORT_REASONS` out of the server-action file.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  insertError: null as null | { message: string },
  inserted: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      insert: async (row: unknown) => {
        state.inserted.push(row);
        return { error: state.insertError };
      },
    }),
  }),
}));

const reportErrorMock = vi.fn();
vi.mock("@/lib/observability/report", () => ({
  reportError: (...a: unknown[]) => reportErrorMock(...a),
}));

import { reportSession } from "./actions";
import { REPORT_REASONS } from "./reasons";

beforeEach(() => {
  state.user = { id: "student-1" };
  state.insertError = null;
  state.inserted = [];
  reportErrorMock.mockReset();
});

describe("reportSession", () => {
  it("refuses when nobody is signed in", async () => {
    state.user = null;
    expect(await reportSession({ sessionId: "s1", reason: "conduct", detail: "" }))
      .toEqual({ error: "Sign in first." });
    expect(state.inserted).toHaveLength(0);
  });

  // The reason list is a check constraint in 0016. Sending an unknown value
  // would fail at the database with an opaque error; refuse it here instead.
  it("refuses a reason outside the fixed list", async () => {
    const r = await reportSession({ sessionId: "s1", reason: "whatever", detail: "" });
    expect("error" in r).toBe(true);
    expect(state.inserted).toHaveLength(0);
  });

  it("writes the report with the caller as reporter", async () => {
    const r = await reportSession({ sessionId: "s1", reason: "conduct", detail: " worried " });
    expect(r).toEqual({ ok: true });
    expect(state.inserted[0]).toEqual({
      session_id: "s1",
      reporter_id: "student-1",
      reason: "conduct",
      detail: "worried",
    });
  });

  it("stores null rather than an empty string when no detail is given", async () => {
    await reportSession({ sessionId: "s1", reason: "technical", detail: "   " });
    expect(state.inserted[0]).toMatchObject({ detail: null });
  });

  // A safety report that fails silently is the worst outcome this feature has:
  // the reporter believes they have been heard and nobody has been told.
  it("reports the failure and tells the user when the insert fails", async () => {
    state.insertError = { message: "db down" };
    const r = await reportSession({ sessionId: "s1", reason: "conduct", detail: "" });
    expect("error" in r).toBe(true);
    expect(reportErrorMock).toHaveBeenCalled();
  });

  // Alerting is the whole point: a report that only lands in a table nobody
  // watches is not a safety mechanism (spec §5).
  it("raises an alert on a successful report too", async () => {
    await reportSession({ sessionId: "s1", reason: "conduct", detail: "" });
    expect(reportErrorMock).toHaveBeenCalled();
  });

  it("exposes the six reasons the constraint allows", () => {
    expect([...REPORT_REASONS]).toEqual([
      "no_show", "left_early", "technical", "teaching_quality", "conduct", "other",
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run "src/app/(app)/(student)/sessions/actions.test.ts"`
Expected: FAIL — cannot resolve `./actions`.

- [ ] **Step 3: Write the implementation**

First `src/app/(app)/(student)/sessions/reasons.ts` — a plain module, NOT a server-action file:

```ts
// Mirrors the check constraint in migration 0016. Changing one without the
// other gives the user an opaque database error instead of a clean refusal.
//
// Deliberately NOT in actions.ts: that file is "use server", where only async
// functions may be exported. A const there empties the module at build time,
// and tsc does not catch it.
export const REPORT_REASONS = [
  "no_show", "left_early", "technical", "teaching_quality", "conduct", "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
```

Then `src/app/(app)/(student)/sessions/actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/report";
import { REPORT_REASONS } from "./reasons";

export async function reportSession(input: {
  sessionId: string;
  reason: string;
  detail: string;
}): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  if (!(REPORT_REASONS as readonly string[]).includes(input.reason)) {
    return { error: "Pick a reason for the report." };
  }

  const detail = input.detail.trim();

  // RLS (0016) re-checks that this caller was actually in this session, so a
  // forged sessionId is refused by the database rather than by this code.
  const { error } = await supabase.from("session_reports").insert({
    session_id: input.sessionId,
    reporter_id: user.id,
    reason: input.reason,
    detail: detail.length > 0 ? detail : null,
  });

  if (error) {
    // A safety report failing silently is the worst outcome here: the reporter
    // believes they have been heard and nobody has been told.
    reportError(error, {
      where: "reportSession.insert",
      sessionId: input.sessionId,
      reason: input.reason,
    });
    return { error: "Couldn't send that report — please try again." };
  }

  // Alerting, not error handling. A report that only lands in a table nobody
  // watches is not a safety mechanism (spec §5). Sentry is a deliberate
  // compromise until Resend exists — spec §8 item 1.
  reportError(new Error(`session report filed: ${input.reason}`), {
    where: "session-report",
    sessionId: input.sessionId,
    reason: input.reason,
    reporterId: user.id,
  });

  return { ok: true };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run "src/app/(app)/(student)/sessions/actions.test.ts"`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/(student)/sessions/reasons.ts" "src/app/(app)/(student)/sessions/actions.ts" "src/app/(app)/(student)/sessions/actions.test.ts"
git commit -m "feat(sessions): report-a-problem action, alerting on success and failure"
```

- [ ] **Step 6: Prove the "use server" split actually holds**

Run: `npm run build`
Expected: exit 0. A `const` export sneaking back into `actions.ts` fails HERE and nowhere earlier — `npx tsc --noEmit` passes either way.

---

### Task 5: The report form

A client component. One button per row that opens an inline form.

**Files:**
- Create: `src/app/(app)/(student)/sessions/report-button.tsx`
- Test: `src/app/(app)/(student)/sessions/report-button.test.tsx`

**Interfaces:**
- Consumes: `reportSession`, `REPORT_REASONS` from `./actions`.
- Produces: `export function ReportButton({ sessionId }: { sessionId: string })`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const reportSession = vi.fn();
// Only the action is mocked. REPORT_REASONS comes from reasons.ts, which is a
// plain module and needs no mock.
vi.mock("./actions", () => ({ reportSession: (i: unknown) => reportSession(i) }));

import { ReportButton } from "./report-button";

beforeEach(() => reportSession.mockReset().mockResolvedValue({ ok: true }));

describe("ReportButton", () => {
  it("does not show the form until asked", () => {
    render(<ReportButton sessionId="s1" />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("sends the chosen reason and detail", async () => {
    render(<ReportButton sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /report a problem/i }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "conduct" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "worried" } });
    fireEvent.click(screen.getByRole("button", { name: /^send report$/i }));

    await waitFor(() =>
      expect(reportSession).toHaveBeenCalledWith({
        sessionId: "s1", reason: "conduct", detail: "worried",
      })
    );
  });

  // The reporter must be told it landed. Silence after reporting a concern
  // about a child is the failure this whole path exists to avoid.
  it("confirms when the report is sent", async () => {
    render(<ReportButton sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /report a problem/i }));
    fireEvent.click(screen.getByRole("button", { name: /^send report$/i }));
    await waitFor(() => expect(screen.getByText(/thank you/i)).toBeInTheDocument());
  });

  it("shows the error and leaves the form usable when sending fails", async () => {
    reportSession.mockResolvedValue({ error: "Couldn't send that report — please try again." });
    render(<ReportButton sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /report a problem/i }));
    fireEvent.click(screen.getByRole("button", { name: /^send report$/i }));

    await waitFor(() => expect(screen.getByText(/couldn't send that report/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^send report$/i })).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run "src/app/(app)/(student)/sessions/report-button.test.tsx"`
Expected: FAIL — cannot resolve `./report-button`.

- [ ] **Step 3: Write the implementation**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { reportSession } from "./actions";
import { REPORT_REASONS } from "./reasons";

// Order matters. 'conduct' is what this feature exists for, and it is
// deliberately NOT first: a parent should reach it without being primed, and
// the ordinary reasons need to exist so the button gets used at all. A
// reporting path only touched in emergencies is one nobody has practised.
const LABELS: Record<string, string> = {
  no_show: "The teacher didn't turn up",
  left_early: "The lesson ended early",
  technical: "Audio, video or connection problems",
  teaching_quality: "The teaching wasn't what we expected",
  conduct: "Something the teacher said or did concerned me",
  other: "Something else",
};

export function ReportButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [detail, setDetail] = useState("");

  if (sent) {
    return (
      <p className="text-sm text-muted-foreground">
        Thank you — we&apos;ve got this and someone will look at it.
      </p>
    );
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Report a problem
      </Button>
    );
  }

  async function send() {
    setBusy(true);
    setError(null);
    const result = await reportSession({ sessionId, reason, detail });
    setBusy(false);
    if ("error" in result) {
      // Leave the form open and usable: someone reporting a concern must not
      // have to start again, and must never be left unsure whether it sent.
      setError(result.error);
      return;
    }
    setSent(true);
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border p-3">
      <label className="block text-sm font-medium" htmlFor={`reason-${sessionId}`}>
        What went wrong?
      </label>
      <select
        id={`reason-${sessionId}`}
        className="w-full rounded-md border px-3 py-2 text-sm"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      >
        {REPORT_REASONS.map((r) => (
          <option key={r} value={r}>{LABELS[r]}</option>
        ))}
      </select>
      <textarea
        className="w-full rounded-md border px-3 py-2 text-sm"
        rows={3}
        placeholder="Anything you want to add (optional)"
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
      />
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <Button size="sm" onClick={send} disabled={busy}>
          {busy ? "Sending…" : "Send report"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run "src/app/(app)/(student)/sessions/report-button.test.tsx"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/(student)/sessions/report-button.tsx" "src/app/(app)/(student)/sessions/report-button.test.tsx"
git commit -m "feat(sessions): the report form, with conduct deliberately not first"
```

---

### Task 6: The /sessions page

Server component. Read `src/app/(app)/(teacher)/dashboard/session-history.tsx` first and follow it — same shape, same date handling.

**Files:**
- Create: `src/app/(app)/(student)/sessions/page.tsx`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/auth`; `createClient` from `@/lib/supabase/server`; `moneyTouched` from `@/lib/student-sessions`; `ReportButton` from `./report-button`; `Money`, `EmptyState`, `PageHeader`, `Card`, `Button`.

- [ ] **Step 1: Write the page**

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { moneyTouched } from "@/lib/student-sessions";
import { Money } from "@/components/money";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReportButton } from "./report-button";

const PAGE = 25;

// Server-rendered, so the runtime's zone is UTC on Vercel. Naming the zone
// keeps times right for the audience instead of silently 5:30 off.
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default async function SessionsPage() {
  const identity = await requireUser();
  const supabase = await createClient();

  // The teacher's NAME comes from a join, unlike the teacher's view of a
  // student, which reads a denormalised sessions.student_name (0004). The
  // asymmetry is in the RLS: 0001 lets anyone read a TEACHER profile
  // (`role = 'teacher' or id = auth.uid()`), so no extra column is needed here.
  const { data, error } = await supabase
    .from("sessions")
    .select(
      "id, subject, curriculum, grade, created_at, started_at, amount_paid_paise, refund_ref, teacher:profiles!sessions_teacher_id_fkey (full_name)"
    )
    .eq("student_id", identity.userId)
    .order("created_at", { ascending: false })
    .limit(PAGE);

  if (error) console.error("[sessions] history query failed", error);

  const rows = (data ?? []).filter(moneyTouched);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="px-8 py-12">
        <div className="mx-auto max-w-3xl space-y-8">
          <PageHeader
            title="Your sessions"
            description="Every lesson you've paid for, and any refunds."
          />

          {rows.length === 0 ? (
            <EmptyState
              title={error ? "Couldn't load your sessions" : "No sessions yet"}
              description={
                error
                  ? "This is on us, not you. Try reloading in a moment."
                  : "Lessons you pay for will appear here, with what you were charged. Ready to start?"
              }
              action={
                <Button asChild>
                  <Link href="/find">Find a teacher</Link>
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex justify-end">
                <Button asChild variant="outline">
                  <Link href="/find">Find a teacher</Link>
                </Button>
              </div>
              <ul className="space-y-4">
                {rows.map((s) => {
                  const teacherName =
                    (s.teacher as { full_name?: string } | null)?.full_name ?? "Your teacher";
                  return (
                    <li key={s.id}>
                      <Card>
                        <CardContent className="p-6">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h3 className="font-semibold text-gray-900">
                              {s.subject} with {teacherName}
                            </h3>
                            <span className="text-sm text-muted-foreground">
                              {when(s.started_at ?? s.created_at)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {s.curriculum} · {s.grade}
                          </p>
                          <p className="mt-3 text-sm">
                            {s.amount_paid_paise ? (
                              <>
                                Paid <Money paise={s.amount_paid_paise} />
                              </>
                            ) : (
                              "No charge recorded"
                            )}
                            {s.refund_ref && (
                              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                                Refunded
                              </span>
                            )}
                          </p>
                          <div className="mt-4">
                            <ReportButton sessionId={s.id} />
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the foreign-key name in the join**

The `profiles!sessions_teacher_id_fkey` hint must match the real constraint name or PostgREST returns a 400.

Run:
```bash
node -e "
const {readEnv,serviceHeaders}=require('./scripts/probe-accounts.mjs');
" 2>/dev/null || node --input-type=module -e "
import { readEnv, serviceHeaders } from './scripts/probe-accounts.mjs';
const env = readEnv();
const r = await fetch(\`\${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sessions?select=id,teacher:profiles!sessions_teacher_id_fkey(full_name)&limit=1\`, { headers: serviceHeaders(env) });
console.log('HTTP', r.status, (await r.text()).slice(0,200));
"
```
Expected: `HTTP 200`. If 400 with "Could not find a relationship", read the real constraint name and fix the hint before continuing — do not guess a second time.

- [ ] **Step 3: Typecheck, lint and build**

Run: `npx tsc --noEmit && npx eslint . && npm run build`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/(student)/sessions/page.tsx"
git commit -m "feat(sessions): the student's record of what they paid for"
```

---

### Task 7: Route students to it

Three small edits that turn the page from unreachable into the student's home.

**Files:**
- Modify: `src/lib/routes.ts` (`resolveHome`)
- Modify: `src/lib/nav.ts` (`NAV.student`)
- Modify: `src/app/(fullscreen)/call/[sessionId]/page.tsx:36` (`returnTo`)
- Test: `src/lib/routes.test.ts` (extend), `src/lib/nav.test.ts` (extend if it exists; create if not)

**Interfaces:**
- Consumes: `moneyTouched` is unrelated here. `resolveHome(role: Role): string` already exists.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

```ts
// in src/lib/routes.test.ts
import { describe, it, expect } from "vitest";
import { resolveHome } from "./routes";

describe("resolveHome", () => {
  // Before this, a student's every sign-in landed on /find — the product had
  // no student surface that was not a step in buying something.
  it("sends a student to their session record", () => {
    expect(resolveHome("student")).toBe("/sessions");
  });

  it("still sends a teacher to their dashboard", () => {
    expect(resolveHome("teacher")).toBe("/dashboard");
  });

  it("still sends an admin to admin", () => {
    expect(resolveHome("admin")).toBe("/admin");
  });
});
```

```ts
// in src/lib/nav.test.ts
import { describe, it, expect } from "vitest";
import { NAV } from "./nav";

describe("NAV", () => {
  // A nav pointing at a page that does not exist is the same defect as
  // marketing copy advertising a deferred feature.
  it("gives a student both their record and the way to find a teacher", () => {
    expect(NAV.student.map((i) => i.href)).toEqual(["/sessions", "/find"]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/routes.test.ts src/lib/nav.test.ts`
Expected: FAIL — `resolveHome("student")` returns `/find`; `NAV.student` has one entry.

Note: `src/lib/routes.test.ts:10` already asserts `resolveHome("student") === "/find"`. That
assertion is the behaviour this task changes — replace it rather than adding a second,
contradictory one.

- [ ] **Step 3: Make the three edits**

In `src/lib/routes.ts`, change the `default` branch of `resolveHome`:

```ts
    default:
      // Students land on their own record, not on the search form. /find is
      // one tap away and is in the nav; landing there made the product's only
      // student surface a step in buying something.
      return "/sessions";
```

In `src/lib/nav.ts`:

```ts
  student: [
    { href: "/sessions", label: "My sessions" },
    { href: "/find", label: "Find a teacher" },
  ],
```

In `src/app/(fullscreen)/call/[sessionId]/page.tsx` line 36:

```ts
  // A student who has just finished a lesson used to be pushed to /teachers —
  // the online-now list — so the product's answer to "you finished" was "here
  // are more teachers to buy". Send them to their record instead.
  const returnTo = isTeacher ? "/dashboard" : "/sessions";
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run`
Expected: the whole suite passes. If a test asserted the old `/find` or `/teachers` values, update it — that is the behaviour change this task exists to make, not a regression.

- [ ] **Step 5: Commit**

```bash
git add src/lib/routes.ts src/lib/nav.ts "src/app/(fullscreen)/call/[sessionId]/page.tsx" src/lib/routes.test.ts src/lib/nav.test.ts
git commit -m "feat(sessions): make the record a student's home and post-call landing"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run every gate**

```bash
npx vitest run
npx tsc --noEmit
npx eslint .
npm run build
```
Expected: all exit 0, and the test count is above the starting baseline.

- [ ] **Step 2: Run every database probe**

```bash
node scripts/probe-session-reports.mjs
node scripts/probe-role-guard.mjs
node scripts/probe-session-rls.mjs
node scripts/probe-happy-path.mjs
node scripts/probe-availability.mjs
node scripts/reconcile-payments.mjs
```
Expected: all exit 0. `session_reports` adds a table and a policy; the others prove nothing else moved.

- [ ] **Step 3: Confirm the record honours the spec's rule**

Run: `node scripts/why-no-ring.mjs` — unrelated, but confirms the operator tooling still runs.

Then check by hand in the app, signed in as a student with at least one paid session: the row appears, a declined request does not, and the refunded badge shows on a refunded row.

- [ ] **Step 4: Commit anything outstanding and report**

Report: tests before/after, all four gates, all six probes, and anything deferred.
