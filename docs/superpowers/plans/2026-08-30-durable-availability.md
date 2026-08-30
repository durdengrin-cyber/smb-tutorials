# Durable Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teacher who declares themselves available stays available across a closed tab and a locked phone — and when we genuinely cannot reach them, they are hidden from students and told so.

**Architecture:** Three facts that "online" used to conflate are split apart. The **declaration** ("I want work") is a durable Postgres row with a 4-hour lease. **Liveness** ("a device is connected now") stays in Supabase Realtime presence, costing zero database writes. **Reach** ("we can wake a device") is a push-subscription registry pruned only by a send-time 404/410. A student's list is `declared ∧ lease-valid ∧ ¬in-session ∧ (live-connection ∨ working-device)` — the first three evaluated in SQL by one `security definer` RPC, the final `∨` on the client, because the client is the only place both halves exist at once.

**Tech Stack:** Next.js 16 (App Router) · Supabase (Postgres + Auth + Realtime) · Web Push (VAPID, `web-push`) · Vitest · Playwright · Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-29-durable-availability-design.md` — read it alongside this plan. Every task cites the spec section it implements; where the two disagree, the spec wins and the plan is wrong.

---

## Before Task 1 — two gates outside this plan

1. **The payment-surface component tests** (cycle-1 spec §17.5) are a separate bounded task and run **first**. They protect the student-flow and teacher-dashboard files this plan modifies. Do not begin Task 1 until they are merged.
2. **This machine is a fresh clone.** Task 1 restores the baseline. Nothing can be built, run, tested or probed before it.

## Global Constraints

Every task's requirements implicitly include this section.

- **Migration `0006_roles_admin.sql` is written and DELIBERATELY UNAPPLIED.** It is the only thing preventing self-service admin promotion (cycle-1 spec §17.1). New migrations are `0007`+, must **not** depend on `0006`, and must apply cleanly to a database where `0006` was skipped. **Do not apply `0006`.**
- **`.env.local` is the user's file** (ruling 2026-08-27). Propose the exact lines and let them paste. **Never write it.** Reading it is fine.
- **Never commit keys.** VAPID private key, service role key, Razorpay secrets — `.env.local` and Vercel env vars only.
- **This is not the Next.js you know.** Read `node_modules/next/dist/docs/` before writing app code. Known: `middleware.ts` is deprecated → `src/proxy.ts` exporting `proxy()`; `searchParams` is a Promise; a `"use server"` file may only export async functions; Supabase `.select()` must be a **single string literal** or type inference collapses to `GenericStringError`.
- **The push dispatcher runs on the Node runtime, not Edge** — VAPID signing requires it.
- **Root-cause fixes only** (CLAUDE.md). If a change is a spike or shortcut, say so unprompted and record it in the spec's hardening section.
- **Green means all five:** `npm test` · `npx tsc --noEmit` · `npx eslint` · `npm run build` · the three existing probes exit 0.
- **Exact constant names** used across tasks: `ACCEPT_WINDOW_SECONDS`, `LEASE_SECONDS`, `RENEW_FLOOR_SECONDS`, `PRESENCE_CHANNEL`.
- **Copy is specified verbatim.** The strings in Tasks 11–14 are the spec's honesty requirements, not suggestions. Do not paraphrase them.

---

### Task 1: Restore the build baseline

No feature code. Nothing after this task can be trusted until this passes.

**Files:**
- Modify: `.env.local` (**by the user, not by you**)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `node_modules`, a populated `.env.local`, and a **recorded** test/lint/build baseline that later tasks compare against.

- [ ] **Step 1: Install dependencies**

```bash
npm install
```

- [ ] **Step 2: Propose the `.env.local` lines for the user to paste**

Print this block and **stop** until the user confirms they have pasted it. Values come from the Vercel project (`smb-tutorials`, team `durdengrin-6266s-projects`), Settings → Environment Variables.

```
DAILY_API_KEY=<from Vercel>
NEXT_PUBLIC_SUPABASE_URL=<from Vercel>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from Vercel>
SUPABASE_SERVICE_ROLE_KEY=<from Vercel>
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=<from Vercel>
RAZORPAY_KEY_SECRET=<from Vercel>
PAYMENT_WEBHOOK_SECRET=<from Vercel>
```

- [ ] **Step 3: Record the real baseline**

```bash
npm test 2>&1 | tail -5
npx tsc --noEmit && echo "tsc OK"
npx eslint && echo "eslint OK"
npm run build 2>&1 | tail -5
```

Expected: all four clean. `project_state.md` claims "154 tests passing / 3 skipped" **measured on a different machine** — write down whatever this machine actually reports and use that as the before-number. If it is not green, stop and report: a red baseline is a finding, not something to work around.

- [ ] **Step 4: Verify the database probes still pass**

```bash
node scripts/probe-session-rls.mjs && node scripts/probe-happy-path.mjs && node scripts/reconcile-payments.mjs
```

Expected: all three exit 0. `probe-happy-path` takes ~70s by design — it waits for a real Postgres deadline rather than mocking a clock.

- [ ] **Step 5: Confirm `0006` is still unapplied**

```bash
node -e '
const fs=require("fs");
const env=Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n")
 .filter(l=>!l.trim().startsWith("#")&&l.includes("="))
 .map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["\x27]|["\x27]$/g,"")]}));
fetch(env.NEXT_PUBLIC_SUPABASE_URL+"/rest/v1/profiles?select=role&limit=1",
 {headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY}})
 .then(r=>r.json()).then(d=>console.log("profiles reachable:",JSON.stringify(d)));'
```

Then confirm in the Supabase SQL editor that the `profiles_role_check` constraint does **not** include `admin`. If it does, `0006` was applied — stop and report it as a security finding.

- [ ] **Step 6: Commit nothing**

This task changes no tracked files. Do not commit. Report the baseline numbers.

---

### Task 2: Lease math

Pure functions. No network, no React. Spec §4.1.

**Files:**
- Create: `src/lib/availability.ts`
- Test: `src/lib/availability.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `LEASE_SECONDS: number` (14400), `RENEW_FLOOR_SECONDS: number` (900)
  - `leaseUntilFrom(now: Date): Date`
  - `isLeaseLive(declaredUntil: string | null, now: Date): boolean`
  - `shouldRenew(declaredUntil: string | null, now: Date, lastRenewedAt: Date | null): boolean`
  - `formatLeaseEnd(declaredUntil: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/availability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  LEASE_SECONDS,
  RENEW_FLOOR_SECONDS,
  leaseUntilFrom,
  isLeaseLive,
  shouldRenew,
  formatLeaseEnd,
} from "./availability";

const at = (iso: string) => new Date(iso);

describe("leaseUntilFrom", () => {
  it("buys exactly four hours", () => {
    expect(leaseUntilFrom(at("2026-08-30T10:00:00Z")).toISOString()).toBe(
      "2026-08-30T14:00:00.000Z"
    );
    expect(LEASE_SECONDS).toBe(4 * 60 * 60);
  });
});

describe("isLeaseLive", () => {
  it("is false when never declared", () => {
    expect(isLeaseLive(null, at("2026-08-30T10:00:00Z"))).toBe(false);
  });

  it("is true while time remains", () => {
    expect(
      isLeaseLive("2026-08-30T14:00:00Z", at("2026-08-30T13:59:59Z"))
    ).toBe(true);
  });

  // The boundary decides whether a lapsed teacher is listed for one more
  // request. Exactly-expired counts as lapsed.
  it("is false at the instant it expires", () => {
    expect(
      isLeaseLive("2026-08-30T14:00:00Z", at("2026-08-30T14:00:00Z"))
    ).toBe(false);
  });
});

describe("shouldRenew", () => {
  it("does not renew above the halfway point", () => {
    // 2h01m left of a 4h lease.
    expect(
      shouldRenew("2026-08-30T14:00:00Z", at("2026-08-30T11:59:00Z"), null)
    ).toBe(false);
  });

  it("renews below the halfway point", () => {
    // 1h59m left of a 4h lease.
    expect(
      shouldRenew("2026-08-30T14:00:00Z", at("2026-08-30T12:01:00Z"), null)
    ).toBe(true);
  });

  // The floor is what stops four open tabs, or a remount loop, turning a
  // rare write into a frequent one. Without it the halfway rule fires on
  // every single mount for the whole second half of the lease.
  it("refuses a second renewal inside the 15-minute floor", () => {
    expect(
      shouldRenew(
        "2026-08-30T14:00:00Z",
        at("2026-08-30T12:05:00Z"),
        at("2026-08-30T12:00:00Z")
      )
    ).toBe(false);
    expect(RENEW_FLOOR_SECONDS).toBe(15 * 60);
  });

  it("allows a renewal once the floor has passed", () => {
    expect(
      shouldRenew(
        "2026-08-30T14:00:00Z",
        at("2026-08-30T12:16:00Z"),
        at("2026-08-30T12:00:00Z")
      )
    ).toBe(true);
  });

  it("never renews a lease that has already lapsed", () => {
    // A lapsed lease is a fresh decision by the teacher, not a renewal.
    expect(
      shouldRenew("2026-08-30T14:00:00Z", at("2026-08-30T14:00:01Z"), null)
    ).toBe(false);
  });

  it("never renews when not declared", () => {
    expect(shouldRenew(null, at("2026-08-30T12:00:00Z"), null)).toBe(false);
  });
});

describe("formatLeaseEnd", () => {
  it("renders a short local wall-clock time", () => {
    const out = formatLeaseEnd("2026-08-30T14:00:00Z");
    expect(out).toMatch(/\d/);
    expect(out).not.toContain("T");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/availability.test.ts`
Expected: FAIL — `Failed to resolve import "./availability"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/availability.ts`:

```ts
// Pure availability-lease rules. Nothing here touches the network — the same
// functions run in Server Actions and in the browser, which is what lets a
// serverless stack expire a declaration without a cron (spec §4.1).
//
// Why a lease and not a heartbeat: a 15-second heartbeat is ~667 writes/sec
// at 10,000 teachers. A 4-hour lease renewed at its halfway point is ~1.4.
// Same honesty, ~240x cheaper.

export const LEASE_SECONDS = 4 * 60 * 60;

// The floor exists because the halfway rule alone fires on every mount for
// the whole second half of a lease, and a teacher may have several tabs open.
export const RENEW_FLOOR_SECONDS = 15 * 60;

export function leaseUntilFrom(now: Date): Date {
  return new Date(now.getTime() + LEASE_SECONDS * 1000);
}

export function isLeaseLive(declaredUntil: string | null, now: Date): boolean {
  if (!declaredUntil) return false;
  return new Date(declaredUntil).getTime() > now.getTime();
}

export function shouldRenew(
  declaredUntil: string | null,
  now: Date,
  lastRenewedAt: Date | null
): boolean {
  // A lapsed lease is not renewed: going available again is a fresh decision
  // by the teacher, and renewing it silently would resurrect a declaration
  // they never made.
  if (!isLeaseLive(declaredUntil, now)) return false;

  const remainingMs = new Date(declaredUntil as string).getTime() - now.getTime();
  if (remainingMs > (LEASE_SECONDS / 2) * 1000) return false;

  if (
    lastRenewedAt &&
    now.getTime() - lastRenewedAt.getTime() < RENEW_FLOOR_SECONDS * 1000
  ) {
    return false;
  }
  return true;
}

// Shown to the teacher at the moment they declare, so lapsing is what they
// agreed to rather than a surprise sprung on them (spec §4.1).
export function formatLeaseEnd(declaredUntil: string): string {
  return new Date(declaredUntil).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/availability.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/availability.ts src/lib/availability.test.ts
git commit -m "feat(availability): lease math with a halfway renewal and a 15-minute floor"
```

---

### Task 3: Migration 0007 — `teacher_availability`

The durable declaration, its RLS, and the guard that keeps students out of it. Spec §4.1, §4.3.

**Files:**
- Create: `supabase/migrations/0007_teacher_availability.sql`
- Create: `scripts/probe-availability.mjs`

**Interfaces:**
- Consumes: `scripts/probe-accounts.mjs` (`readEnv`, `serviceHeaders`, `serviceRepr`, `userHeaders`, `jsonHeaders`, `createThrowawayUser`, `deleteThrowawayUser`, `profileCount`).
- Produces: table `public.teacher_availability`; the probe file that Tasks 5 and 6 extend.

- [ ] **Step 1: Write the failing probe**

Create `scripts/probe-availability.mjs`. Follow the house style exactly: no arguments, no standing credential, mints and deletes its own accounts, asserts row counts return to baseline.

```js
#!/usr/bin/env node
// Cycle 2's security probe. teacher_availability and teacher_devices are new
// attack surface, and one of them holds capabilities: a push endpoint is not
// data, it is the ability to wake someone's phone. The single most important
// assertion in this file is that a student cannot read another teacher's
// device row.
//
// Usage: node scripts/probe-availability.mjs
import {
  readEnv, jsonHeaders, serviceHeaders, serviceRepr, userHeaders,
  createThrowawayUser, deleteThrowawayUser, profileCount,
} from "./probe-accounts.mjs";

const env = readEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = serviceHeaders(env);

let failures = 0;
const permitted = (ok, label) => {
  console.log(`  ${ok ? "\x1b[32mPERMITTED\x1b[0m" : "\x1b[31mREFUSED  \x1b[0m"}  ${label}`);
  if (!ok) failures++;
};
const refused = (ok, label) => {
  console.log(`  ${ok ? "\x1b[32mREFUSED  \x1b[0m" : "\x1b[31mPERMITTED\x1b[0m"}  ${label}`);
  if (!ok) failures++;
};

async function availabilityCount() {
  const res = await fetch(`${URL}/rest/v1/teacher_availability?select=teacher_id`, { headers: SERVICE });
  return (await res.json()).length;
}

async function main() {
  const baselineProfiles = await profileCount(env);
  const baselineAvailability = await availabilityCount();

  const teacher = await createThrowawayUser(env, { role: "teacher" });
  const student = await createThrowawayUser(env, { role: "student" });

  try {
    console.log("\nteacher_availability — the declaration");

    // A teacher declares for themselves.
    let res = await fetch(`${URL}/rest/v1/teacher_availability`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, teacher.token)),
      body: JSON.stringify({
        teacher_id: teacher.id,
        declared: true,
        declared_at: new Date().toISOString(),
        declared_until: new Date(Date.now() + 4 * 3600_000).toISOString(),
      }),
    });
    permitted(res.ok, "teacher declares their own availability");

    // A teacher must not declare on someone else's behalf.
    res = await fetch(`${URL}/rest/v1/teacher_availability`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, student.token)),
      body: JSON.stringify({
        teacher_id: teacher.id,
        declared: true,
        declared_until: new Date(Date.now() + 4 * 3600_000).toISOString(),
      }),
    });
    refused(!res.ok, "student forges a declaration for a teacher");

    // A student cannot park a declaration on their own row either: the list
    // only reads teacher profiles, but a stray row is still junk in a table
    // whose whole point is to be authoritative.
    res = await fetch(`${URL}/rest/v1/teacher_availability`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, student.token)),
      body: JSON.stringify({
        teacher_id: student.id,
        declared: true,
        declared_until: new Date(Date.now() + 4 * 3600_000).toISOString(),
      }),
    });
    refused(!res.ok, "student declares availability for themselves");

    // A student must not be able to switch a teacher off.
    res = await fetch(
      `${URL}/rest/v1/teacher_availability?teacher_id=eq.${teacher.id}`,
      {
        method: "PATCH",
        headers: jsonHeaders(userHeaders(env, student.token)),
        body: JSON.stringify({ declared: false }),
      }
    );
    const after = await fetch(
      `${URL}/rest/v1/teacher_availability?teacher_id=eq.${teacher.id}&select=declared`,
      { headers: SERVICE }
    ).then((r) => r.json());
    refused(after[0]?.declared === true, "student switches a teacher offline");

    // Availability is not secret — the roster has to read it.
    res = await fetch(
      `${URL}/rest/v1/teacher_availability?teacher_id=eq.${teacher.id}&select=declared`,
      { headers: userHeaders(env, student.token) }
    );
    permitted(res.ok && (await res.json()).length === 1, "student reads a declaration");
  } finally {
    await fetch(`${URL}/rest/v1/teacher_availability?teacher_id=eq.${teacher.id}`, {
      method: "DELETE", headers: SERVICE,
    });
    await deleteThrowawayUser(env, teacher.id);
    await deleteThrowawayUser(env, student.id);
  }

  const endProfiles = await profileCount(env);
  const endAvailability = await availabilityCount();
  console.log("\ncleanup");
  console.log(`  profiles ${baselineProfiles} -> ${endProfiles}`);
  console.log(`  teacher_availability ${baselineAvailability} -> ${endAvailability}`);
  if (endProfiles !== baselineProfiles) failures++;
  if (endAvailability !== baselineAvailability) failures++;

  console.log(failures === 0 ? "\n\x1b[32mALL CLEAR\x1b[0m" : `\n\x1b[31m${failures} FAILURE(S)\x1b[0m`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the probe to verify it fails**

Run: `node scripts/probe-availability.mjs`
Expected: FAIL — the table does not exist, so PostgREST answers 404 and the permitted assertions go red.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0007_teacher_availability.sql`:

```sql
-- Cycle 2, spec §4.1 and §4.3. The durable half of "available": a
-- declaration that survives a closed tab, with a lease so it cannot become a
-- ghost that outlives the teacher's intent.
--
-- Deliberately a NEW TABLE rather than columns on profiles. profiles carries
-- the known-broken update policy from cycle-1 spec §17.1 (no column
-- restriction — any signed-in user can rewrite their own row, including
-- role), and cycle 3 is blocked on closing it. Hanging a hot column off that
-- table would entangle this cycle with that debt; a new table gets correct
-- column-scoped RLS from day one and inherits nothing.
--
-- NOTE: migration 0006 is deliberately UNAPPLIED (it would permit role =
-- 'admin' before a role-write guard exists). Nothing below depends on it.
begin;

create table public.teacher_availability (
  teacher_id     uuid primary key references public.profiles (id) on delete cascade,
  declared       boolean     not null default false,
  declared_at    timestamptz,
  declared_until timestamptz,          -- the lease; NULL when not declared
  updated_at     timestamptz not null default now()
);

-- Partial: the roster only ever asks about teachers who are declared.
create index teacher_availability_live_idx
  on public.teacher_availability (declared_until)
  where declared;

alter table public.teacher_availability enable row level security;

-- Availability is not secret, and the roster read needs it. Cycle 1 already
-- put /find and /teachers behind sign-in, so "authenticated" is the whole
-- audience.
create policy teacher_availability_select on public.teacher_availability
  for select to authenticated using (true);

create policy teacher_availability_insert on public.teacher_availability
  for insert to authenticated with check (auth.uid() = teacher_id);

create policy teacher_availability_update on public.teacher_availability
  for update to authenticated
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);

-- No delete policy on purpose. Rows are toggled, never removed; the FK's
-- `on delete cascade` still fires when a profile goes, because FK actions do
-- not consult RLS.

-- A student cannot park a declaration. The roster joins profiles on
-- role = 'teacher' anyway, so this is defence in depth rather than the only
-- guard — but a table whose job is to be authoritative should not accept
-- rows that can never be true.
create or replace function public.availability_requires_teacher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.teacher_id and role = 'teacher'
  ) then
    raise exception 'teacher_availability requires a teacher profile';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger teacher_availability_guard
  before insert or update on public.teacher_availability
  for each row execute function public.availability_requires_teacher();

commit;
```

- [ ] **Step 4: Apply it and run the probe**

Apply via the Supabase SQL editor (`https://supabase.com/dashboard/project/upggvzzzoxqgourjywtd/sql/new`), pasting the file whole.

Run: `node scripts/probe-availability.mjs`
Expected: PASS — 5 assertions, `ALL CLEAR`, and both row counts returned to baseline.

- [ ] **Step 5: Re-run the existing probes**

Run: `node scripts/probe-session-rls.mjs && node scripts/probe-happy-path.mjs`
Expected: both exit 0. A new table must not disturb the session battery.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0007_teacher_availability.sql scripts/probe-availability.mjs
git commit -m "feat(db): teacher_availability with a lease, column-scoped RLS and a teacher-only guard"
```

---

### Task 4: Declaration server actions

Spec §4.1. The write path the toggle will use in Task 12.

**Files:**
- Modify: `src/app/(app)/(teacher)/dashboard/actions.ts`
- Test: `src/app/(app)/(teacher)/dashboard/actions.test.ts` (create if absent)

**Interfaces:**
- Consumes: `leaseUntilFrom`, `shouldRenew`, `isLeaseLive` from `@/lib/availability` (Task 2); `createClient` from `@/lib/supabase/server`.
- Produces:
  - `declareAvailable(): Promise<{ declaredUntil: string } | { error: string }>`
  - `undeclareAvailable(): Promise<{ ok: true } | { error: string }>`
  - `renewLease(): Promise<{ declaredUntil: string } | { error: string } | { skipped: true }>`

- [ ] **Step 1: Write the failing test**

Add to `src/app/(app)/(teacher)/dashboard/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsert = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "t1" } } }) },
    from: () => ({
      upsert: (...a: unknown[]) => { upsert(...a); return { select: () => ({ single: async () => ({ data: { declared_until: "2026-08-30T14:00:00Z" }, error: null }) }) }; },
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}));

beforeEach(() => { upsert.mockClear(); maybeSingle.mockReset(); });

describe("declareAvailable", () => {
  it("writes a lease four hours out and returns it", async () => {
    const { declareAvailable } = await import("./actions");
    const result = await declareAvailable();
    expect(result).toEqual({ declaredUntil: "2026-08-30T14:00:00Z" });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ teacher_id: "t1", declared: true }),
      expect.objectContaining({ onConflict: "teacher_id" })
    );
  });
});

describe("renewLease", () => {
  it("does nothing when more than half the lease remains", async () => {
    // A renewal on every mount is the write storm the lease exists to avoid.
    maybeSingle.mockResolvedValue({
      data: {
        declared: true,
        declared_until: new Date(Date.now() + 3 * 3600_000).toISOString(),
      },
      error: null,
    });
    const { renewLease } = await import("./actions");
    expect(await renewLease()).toEqual({ skipped: true });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("renews when under half remains", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        declared: true,
        declared_until: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
      error: null,
    });
    const { renewLease } = await import("./actions");
    expect(await renewLease()).toEqual({ declaredUntil: "2026-08-30T14:00:00Z" });
    expect(upsert).toHaveBeenCalled();
  });

  it("does not resurrect a lapsed declaration", async () => {
    // Going available again is a fresh decision by the teacher.
    maybeSingle.mockResolvedValue({
      data: {
        declared: true,
        declared_until: new Date(Date.now() - 60_000).toISOString(),
      },
      error: null,
    });
    const { renewLease } = await import("./actions");
    expect(await renewLease()).toEqual({ skipped: true });
    expect(upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(app)/(teacher)/dashboard/actions.test.ts"`
Expected: FAIL — `declareAvailable is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/app/(app)/(teacher)/dashboard/actions.ts` (the file already has `"use server"` at the top — **only async functions may be exported**):

```ts
import { leaseUntilFrom, shouldRenew } from "@/lib/availability";

// The durable half of "available" (spec §4.1). Presence still carries
// liveness; this carries intent, and it is what a push is authorised
// against — so it must survive the tab that created it.
export async function declareAvailable(): Promise<
  { declaredUntil: string } | { error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to go available." };

  const now = new Date();
  const until = leaseUntilFrom(now);

  const { data, error } = await supabase
    .from("teacher_availability")
    .upsert(
      {
        teacher_id: user.id,
        declared: true,
        declared_at: now.toISOString(),
        declared_until: until.toISOString(),
      },
      { onConflict: "teacher_id" }
    )
    .select("declared_until")
    .single();

  if (error || !data) {
    console.error("[declareAvailable] upsert failed", error);
    return { error: "Couldn't go available — try again." };
  }
  return { declaredUntil: data.declared_until as string };
}

export async function undeclareAvailable(): Promise<
  { ok: true } | { error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  // declared_until is cleared as well as the flag. Leaving a live lease on a
  // row whose flag is false is a contradiction waiting for a query that
  // forgets one of the two conditions.
  const { error } = await supabase
    .from("teacher_availability")
    .upsert(
      { teacher_id: user.id, declared: false, declared_until: null },
      { onConflict: "teacher_id" }
    );

  if (error) {
    console.error("[undeclareAvailable] upsert failed", error);
    return { error: "Couldn't go offline — try again." };
  }
  return { ok: true };
}

// Called by any live client on mount and on a slow interval. shouldRenew
// decides, not the caller: the halfway rule plus the 15-minute floor is what
// keeps this at ~1.4 writes/sec at 10,000 teachers instead of ~667.
export async function renewLease(): Promise<
  { declaredUntil: string } | { error: string } | { skipped: true }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  const { data: row, error: readError } = await supabase
    .from("teacher_availability")
    .select("declared, declared_until")
    .eq("teacher_id", user.id)
    .maybeSingle();

  if (readError) {
    console.error("[renewLease] read failed", readError);
    return { error: "Couldn't check your availability." };
  }
  if (!row?.declared) return { skipped: true };

  const now = new Date();
  // The server owns the floor as well as the halfway test. A client passing
  // its own lastRenewedAt could renew on every mount; this one cannot be
  // talked into it, because it only ever renews inside the second half.
  if (!shouldRenew(row.declared_until as string | null, now, null)) {
    return { skipped: true };
  }

  const until = leaseUntilFrom(now);
  const { data, error } = await supabase
    .from("teacher_availability")
    .upsert(
      { teacher_id: user.id, declared: true, declared_until: until.toISOString() },
      { onConflict: "teacher_id" }
    )
    .select("declared_until")
    .single();

  if (error || !data) {
    console.error("[renewLease] upsert failed", error);
    return { error: "Couldn't extend your availability." };
  }
  return { declaredUntil: data.declared_until as string };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/(app)/(teacher)/dashboard/actions.test.ts"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/(teacher)/dashboard/actions.ts" "src/app/(app)/(teacher)/dashboard/actions.test.ts"
git commit -m "feat(availability): declare, undeclare and lazily renew the lease"
```

---

### Task 5: Migration 0008 — `teacher_devices` and `register_device`

The push registry. **This is the task with the security assertion of the cycle.** Spec §4.2, §4.3.

**Files:**
- Create: `supabase/migrations/0008_teacher_devices.sql`
- Modify: `scripts/probe-availability.mjs`

**Interfaces:**
- Consumes: Task 3's probe scaffolding.
- Produces: table `public.teacher_devices`; RPC `public.register_device(text, text, text, text)`.

- [ ] **Step 1: Extend the probe with the failing assertions**

In `scripts/probe-availability.mjs`, add a `deviceCount()` helper beside `availabilityCount()` and this block inside the `try`, after the availability assertions:

```js
    console.log("\nteacher_devices — endpoints are capabilities, not data");

    // Register through the RPC, the way the app does.
    let res = await fetch(`${URL}/rest/v1/rpc/register_device`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, teacher.token)),
      body: JSON.stringify({
        p_endpoint: `https://push.example.test/${teacher.id}`,
        p_p256dh: "probe-p256dh",
        p_auth: "probe-auth",
        p_user_agent: "probe",
      }),
    });
    permitted(res.ok, "teacher registers their own device");

    // THE assertion. A push endpoint is the ability to wake someone's phone.
    // If a student can read this row, they can spam a teacher's device.
    res = await fetch(
      `${URL}/rest/v1/teacher_devices?teacher_id=eq.${teacher.id}&select=endpoint`,
      { headers: userHeaders(env, student.token) }
    );
    const leaked = res.ok ? await res.json() : [];
    refused(leaked.length === 0, "student reads a teacher's push endpoint");

    // The owner must still be able to read their own.
    res = await fetch(
      `${URL}/rest/v1/teacher_devices?teacher_id=eq.${teacher.id}&select=endpoint`,
      { headers: userHeaders(env, teacher.token) }
    );
    permitted(res.ok && (await res.json()).length === 1, "teacher reads their own device");

    // A student must not be able to insert a row pointing at their own
    // endpoint under a teacher's id, which would redirect that teacher's
    // requests to the student's phone.
    res = await fetch(`${URL}/rest/v1/teacher_devices`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, student.token)),
      body: JSON.stringify({
        teacher_id: teacher.id,
        transport: "webpush",
        endpoint: "https://push.example.test/hijack",
        p256dh: "x",
        auth: "y",
      }),
    });
    refused(!res.ok, "student inserts a device row for a teacher");

    // Re-registering the same endpoint updates rather than duplicating.
    await fetch(`${URL}/rest/v1/rpc/register_device`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, teacher.token)),
      body: JSON.stringify({
        p_endpoint: `https://push.example.test/${teacher.id}`,
        p_p256dh: "probe-p256dh",
        p_auth: "probe-auth",
        p_user_agent: "probe-2",
      }),
    });
    const rows = await fetch(
      `${URL}/rest/v1/teacher_devices?teacher_id=eq.${teacher.id}&select=id`,
      { headers: SERVICE }
    ).then((r) => r.json());
    permitted(rows.length === 1, "re-registering the same endpoint does not duplicate");
```

Add the cleanup in the `finally`, **before** the account deletion:

```js
    await fetch(`${URL}/rest/v1/teacher_devices?teacher_id=eq.${teacher.id}`, {
      method: "DELETE", headers: SERVICE,
    });
```

And a baseline/end comparison for `deviceCount()` alongside the other two.

- [ ] **Step 2: Run the probe to verify it fails**

Run: `node scripts/probe-availability.mjs`
Expected: FAIL — `register_device` does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0008_teacher_devices.sql`:

```sql
-- Cycle 2, spec §4.2 and §4.3. The push-subscription registry.
--
-- Read this before changing anything here: a row in this table is a
-- CAPABILITY, not a record. Anyone holding an endpoint plus its keys can wake
-- that teacher's phone. That is why select is owner-only, why the roster RPC
-- (0009) publishes a boolean instead of a join, and why the probe's single
-- most important assertion is that a student reading this table gets nothing.
begin;

create table public.teacher_devices (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references public.profiles (id) on delete cascade,
  -- One legal value today. The column exists from day one because it is the
  -- App Store seam: an APNs or FCM adapter adds a value here and an adapter
  -- file, and no caller changes (spec §8.1, §10).
  transport      text not null check (transport in ('webpush')),
  endpoint       text not null,
  p256dh         text not null,
  auth           text not null,
  user_agent     text,
  created_at     timestamptz not null default now(),
  last_ok_at     timestamptz,
  last_failed_at timestamptz,
  -- A 404/410 at send time is the ONLY death signal a push subscription has:
  -- userVisibleOnly is mandatory, so there is no silent probe. These columns
  -- are how a transient failure is told apart from a dead device.
  failure_count  int not null default 0
);

create unique index teacher_devices_endpoint_idx on public.teacher_devices (endpoint);
create index teacher_devices_teacher_idx on public.teacher_devices (teacher_id);

alter table public.teacher_devices enable row level security;

create policy teacher_devices_select on public.teacher_devices
  for select to authenticated using (auth.uid() = teacher_id);

create policy teacher_devices_insert on public.teacher_devices
  for insert to authenticated with check (auth.uid() = teacher_id);

create policy teacher_devices_update on public.teacher_devices
  for update to authenticated
  using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

create policy teacher_devices_delete on public.teacher_devices
  for delete to authenticated using (auth.uid() = teacher_id);

-- Registration goes through this rather than a raw upsert. Two teachers
-- sharing one browser profile produce the SAME endpoint; a plain upsert would
-- have to update a row owned by someone else, RLS would correctly refuse, and
-- the teacher would watch setup fail for no visible reason.
--
-- The risk this leaves, stated rather than assumed away (spec §4.3): the
-- arguments come from the caller, so this cannot PROVE the caller holds the
-- subscription. Someone who learned another teacher's full triple could
-- reassign it — stripping that teacher's reachability and misrouting their
-- notifications. Three things make that acceptable: endpoints never leave the
-- server (select is owner-only; the roster RPC publishes a boolean),
-- reassignment requires all three values rather than the endpoint alone, and
-- sign-out already deletes the row, so reassignment is the rare path.
create or replace function public.register_device(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_uid and role = 'teacher'
  ) then
    raise exception 'only a teacher can register a device';
  end if;

  -- Reassignment: the caller supplied the whole subscription, so this is the
  -- shared-device case rather than a hijack of an endpoint they only guessed.
  delete from public.teacher_devices
   where endpoint = p_endpoint
     and p256dh   = p_p256dh
     and auth     = p_auth
     and teacher_id <> v_uid;

  -- Anything still standing under this endpoint belongs to someone else and
  -- did NOT match the keys. Fail loudly: a silent no-op here would leave a
  -- teacher believing setup succeeded while nothing can reach them.
  if exists (
    select 1 from public.teacher_devices
    where endpoint = p_endpoint and teacher_id <> v_uid
  ) then
    raise exception 'endpoint is registered to another account';
  end if;

  insert into public.teacher_devices
    (teacher_id, transport, endpoint, p256dh, auth, user_agent)
  values
    (v_uid, 'webpush', p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set p256dh        = excluded.p256dh,
        auth          = excluded.auth,
        user_agent    = excluded.user_agent,
        -- A re-registration is a fresh start: an old failure streak must not
        -- follow a subscription that has just proved it is alive.
        failure_count = 0,
        last_failed_at = null;
end;
$$;

revoke all on function public.register_device(text, text, text, text) from public;
grant execute on function public.register_device(text, text, text, text) to authenticated;

commit;
```

- [ ] **Step 4: Apply it and run the probe**

Apply in the Supabase SQL editor, then run: `node scripts/probe-availability.mjs`
Expected: PASS — 10 assertions, `ALL CLEAR`, all three row counts back to baseline.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_teacher_devices.sql scripts/probe-availability.mjs
git commit -m "feat(db): teacher_devices with owner-only reads and a register_device RPC"
```

---

### Task 6: Migration 0009 — `available_teachers`

The roster read. Spec §4.4, §4.4.1.

**Files:**
- Create: `supabase/migrations/0009_available_teachers.sql`
- Modify: `scripts/probe-availability.mjs`

**Interfaces:**
- Consumes: `teacher_availability` (Task 3), `teacher_devices` (Task 5).
- Produces: RPC `public.available_teachers(p_curriculum text, p_grade text, p_stream text, p_subject text)` returning rows of `(teacher_id uuid, has_device boolean)`.

- [ ] **Step 1: Read `hasOpenRequest` before writing any SQL**

Open `src/lib/session.ts` and read `effectiveStatus` and `hasOpenRequest` in full. The SQL below must mirror them **exactly** — four statuses and three deadline columns. This duplication is deliberate (the check has to be server-side to be worth anything) and Step 2's parity assertion is the only thing keeping the two honest.

- [ ] **Step 2: Extend the probe with the failing parity assertions**

Add to `scripts/probe-availability.mjs` inside the `try`:

```js
    console.log("\navailable_teachers — the roster read");

    const taxonomy = {
      p_curriculum: "CBSE", p_grade: "10", p_stream: "Science", p_subject: "Mathematics",
    };
    await fetch(`${URL}/rest/v1/teacher_subjects`, {
      method: "POST", headers: jsonHeaders(SERVICE),
      body: JSON.stringify({
        teacher_id: teacher.id, curriculum: "CBSE", grade: "10",
        stream: "Science", subject: "Mathematics",
      }),
    });

    const roster = async () =>
      fetch(`${URL}/rest/v1/rpc/available_teachers`, {
        method: "POST",
        headers: jsonHeaders(userHeaders(env, student.token)),
        body: JSON.stringify(taxonomy),
      }).then((r) => r.json());

    let rows = await roster();
    const mine = rows.find((r) => r.teacher_id === teacher.id);
    permitted(Boolean(mine), "a declared teacher is returned");

    // The defect this cycle's review caught: the RPC must PUBLISH
    // reachability, not APPLY it. A teacher who declared, has the dashboard
    // open and declined notifications is reachable RIGHT NOW — excluding
    // them here would refuse work to someone able to take it.
    permitted(mine?.has_device === true, "has_device is true once a device is registered");

    await fetch(`${URL}/rest/v1/teacher_devices?teacher_id=eq.${teacher.id}`, {
      method: "DELETE", headers: SERVICE,
    });
    rows = await roster();
    const noDevice = rows.find((r) => r.teacher_id === teacher.id);
    permitted(Boolean(noDevice), "a declared teacher with NO device is still returned");
    permitted(noDevice?.has_device === false, "…carrying has_device = false");

    // No endpoint may ever appear in this result, whatever columns are added
    // later.
    refused(
      !Object.keys(noDevice ?? {}).some((k) => /endpoint|p256dh|auth/.test(k)),
      "the roster result carries a subscription column"
    );

    // In-session exclusion, one status at a time, against hasOpenRequest.
    const seed = async (patch) => {
      const res = await fetch(`${URL}/rest/v1/sessions`, {
        method: "POST", headers: jsonHeaders(serviceRepr(env)),
        body: JSON.stringify({
          student_id: student.id, teacher_id: teacher.id,
          curriculum: "CBSE", grade: "10", stream: "Science",
          subject: "Mathematics", type: "instant", hourly_rate: 500,
          duration_minutes: 60, ...patch,
        }),
      });
      return (await res.json())[0];
    };
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();

    for (const [label, patch, expectListed] of [
      ["pending, deadline ahead", { status: "pending", accept_deadline: future }, false],
      ["pending, deadline passed", { status: "pending", accept_deadline: past }, true],
      ["accepted, window open", { status: "accepted", accept_deadline: past, payment_deadline: future }, false],
      ["accepted, window lapsed", { status: "accepted", accept_deadline: past, payment_deadline: past }, true],
    ]) {
      const row = await seed(patch);
      const listed = (await roster()).some((r) => r.teacher_id === teacher.id);
      permitted(listed === expectListed, `${label} -> ${expectListed ? "listed" : "hidden"}`);
      await fetch(`${URL}/rest/v1/sessions?id=eq.${row.id}`, { method: "DELETE", headers: SERVICE });
    }
```

Add `teacher_subjects` and `sessions` cleanup to the `finally`.

- [ ] **Step 3: Run the probe to verify it fails**

Run: `node scripts/probe-availability.mjs`
Expected: FAIL — `available_teachers` does not exist.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/0009_available_teachers.sql`:

```sql
-- Cycle 2, spec §4.4. The roster read, as ONE function.
--
-- Why a security definer function rather than a view or a join in the client:
-- 0008 makes teacher_devices readable only by its owner, because an endpoint
-- is a capability. But the student's list needs to know whether a teacher has
-- a working device. The derived answer is published; the thing that produced
-- it is not. Never add an endpoint, a key, or a device count to this result.
--
-- What it deliberately does NOT do: exclude teachers without a device. This
-- function is SQL and cannot see presence — presence lives in the Realtime
-- service, not in Postgres. A teacher who declared, has the dashboard open
-- and declined notifications is reachable right now, and hiding them here
-- would refuse work to someone able to take it. has_device is PUBLISHED, not
-- APPLIED; the client does the final AND against its presence roster,
-- because the client is the only place both facts exist at once.
begin;

create or replace function public.available_teachers(
  p_curriculum text,
  p_grade      text,
  p_stream     text,
  p_subject    text
)
returns table (teacher_id uuid, has_device boolean)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    exists (select 1 from public.teacher_devices d where d.teacher_id = p.id)
  from public.profiles p
  join public.teacher_availability a on a.teacher_id = p.id
  where p.role = 'teacher'
    and a.declared
    and a.declared_until > now()
    and exists (
      select 1 from public.teacher_subjects s
      where s.teacher_id = p.id
        and s.curriculum = p_curriculum
        and s.grade      = p_grade
        and s.stream     = p_stream
        and s.subject    = p_subject
    )
    -- The in-session exclusion. Until this cycle, hiding a busy teacher was a
    -- SIDE EFFECT of presence untracking when they navigated into the call.
    -- That no longer suffices: a push-only teacher has no presence to drop,
    -- so without this a teacher would be listed as startable mid-lesson and
    -- pushed a fresh request while teaching.
    --
    -- This mirrors hasOpenRequest / effectiveStatus in src/lib/session.ts.
    -- One rule, two languages — the probe asserts they agree, status by
    -- status. If you change one, change both, or the probe goes red.
    and not exists (
      select 1 from public.sessions x
      where x.teacher_id = p.id
        and (
             (x.status = 'pending'  and x.accept_deadline  > now())
          or (x.status = 'accepted' and x.payment_deadline > now())
          or (x.status = 'paid')
          or (x.status = 'active'
              and x.started_at + make_interval(mins => x.duration_minutes) > now())
        )
    );
$$;

revoke all on function public.available_teachers(text, text, text, text) from public;
grant execute on function public.available_teachers(text, text, text, text) to authenticated;

commit;
```

- [ ] **Step 5: Apply it and run the probe**

Run: `node scripts/probe-availability.mjs`
Expected: PASS — all assertions including the four parity cases, `ALL CLEAR`, counts at baseline.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0009_available_teachers.sql scripts/probe-availability.mjs
git commit -m "feat(db): available_teachers publishes reachability without leaking endpoints"
```

---

### Task 7: The notification port and its Web Push adapter

Spec §8.1, §9.3.

**Files:**
- Create: `src/lib/notifications/port.ts`
- Create: `src/lib/notifications/payload.ts`
- Create: `src/lib/notifications/webpush.ts`
- Create: `src/lib/notifications/index.ts`
- Test: `src/lib/notifications/webpush.test.ts`
- Modify: `package.json` (add `web-push`)

**Interfaces:**
- Consumes: nothing.
- Produces: `NotificationPort`, `DeviceSubscription`, `NotificationPayload`, `SendResult`, `requestPayload()`, `getNotificationPort()`.

- [ ] **Step 1: Add the dependency**

```bash
npm install web-push
npm install --save-dev @types/web-push
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/notifications/webpush.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) },
}));

import { webPushPort } from "./webpush";
import { requestPayload } from "./payload";

const sub = { endpoint: "https://push.example/1", p256dh: "k", auth: "a" };
const payload = requestPayload("Aditya", "Mathematics");

beforeEach(() => sendNotification.mockReset());

describe("webPushPort.send", () => {
  it("reports success", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const port = webPushPort("pub", "priv", "mailto:ops@smbtutorials.in");
    expect(await port.send(sub, payload)).toEqual({ ok: true });
  });

  // The single most consequential mapping in the adapter. 404/410 is the ONLY
  // death signal a subscription has, so a wrong verdict here either deletes a
  // live device on a transient blip or keeps a dead one forever.
  it.each([404, 410])("treats %i as gone", async (statusCode) => {
    sendNotification.mockRejectedValue({ statusCode });
    const port = webPushPort("pub", "priv", "mailto:ops@smbtutorials.in");
    const result = await port.send(sub, payload);
    expect(result).toMatchObject({ ok: false, gone: true, status: statusCode });
  });

  it.each([429, 500, 502])("treats %i as transient, not gone", async (statusCode) => {
    sendNotification.mockRejectedValue({ statusCode });
    const port = webPushPort("pub", "priv", "mailto:ops@smbtutorials.in");
    const result = await port.send(sub, payload);
    expect(result).toMatchObject({ ok: false, gone: false, status: statusCode });
  });

  it("treats a network throw as transient", async () => {
    sendNotification.mockRejectedValue(new Error("ECONNRESET"));
    const port = webPushPort("pub", "priv", "mailto:ops@smbtutorials.in");
    const result = await port.send(sub, payload);
    expect(result).toMatchObject({ ok: false, gone: false });
  });

  // razorpayPort refuses to start without its webhook secret rather than
  // failing at the first charge. Same rule here.
  it("refuses to construct without a key", () => {
    expect(() => webPushPort("", "priv", "mailto:ops@smbtutorials.in")).toThrow();
    expect(() => webPushPort("pub", "", "mailto:ops@smbtutorials.in")).toThrow();
  });
});

describe("requestPayload", () => {
  it("names the student and the subject, and uses a replacing tag", () => {
    const p = requestPayload("Aditya", "Mathematics");
    expect(p.body).toContain("Aditya");
    expect(p.body).toContain("Mathematics");
    expect(p.url).toBe("/dashboard");
    // A fixed tag so a second request REPLACES the first rather than
    // stacking two notifications the teacher must dismiss separately.
    expect(p.tag).toBe("session-request");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/notifications/webpush.test.ts`
Expected: FAIL — cannot resolve `./webpush`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/notifications/port.ts`:

```ts
// The whole transport surface this cycle needs. Anything a push service does
// beyond this is not our concern; anything we need beyond this is a change to
// the port, deliberately, in one place — the same rule payments/port.ts sets.
//
// This interface is the App Store seam (spec §8.1, §10): an APNs or FCM
// adapter slots in here with no caller change.

export interface DeviceSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  // A fixed tag per notification kind, so a second request replaces the first
  // instead of stacking. There is no dismissal push available to us —
  // userVisibleOnly is mandatory — so replacement is the only tidying we get.
  tag: string;
}

// `gone` is the ONLY reason a device row is ever deleted. Everything else is
// transient: a 500 from a push service must not cost a teacher their
// reachability.
export type SendResult =
  | { ok: true }
  | { ok: false; gone: boolean; status?: number; error: string };

export interface NotificationPort {
  readonly transport: "webpush";
  send(sub: DeviceSubscription, payload: NotificationPayload): Promise<SendResult>;
}
```

Create `src/lib/notifications/payload.ts`:

```ts
import type { NotificationPayload } from "./port";

export const REQUEST_TAG = "session-request";

// What a teacher reads on a lock screen. Short, names the student and the
// subject, and says nothing that would be wrong by the time they look —
// deliberately no countdown, because a notification cannot tick.
export function requestPayload(
  studentName: string,
  subject: string
): NotificationPayload {
  return {
    title: "New session request",
    body: `${studentName} · ${subject}`,
    url: "/dashboard",
    tag: REQUEST_TAG,
  };
}
```

Create `src/lib/notifications/webpush.ts`:

```ts
import webpush from "web-push";
import type {
  DeviceSubscription,
  NotificationPayload,
  NotificationPort,
  SendResult,
} from "./port";

// We do NOT hand-roll the crypto. RFC 8291 payload encryption and RFC 8292
// VAPID signing are exactly the code nobody should write themselves, and the
// port means swapping this file later is one branch in index.ts.
//
// Consequently the tests here cover what WE wrote — the status mapping, the
// payload, the config wiring — and not the library's ciphertext. Asserting
// someone else's RFC vectors and calling it our coverage would be theatre
// (spec §9.3).
export function webPushPort(
  publicKey: string,
  privateKey: string,
  subject: string
): NotificationPort {
  // Fail at construction, not at the first send. A missing key discovered
  // when a student is already waiting is a silent outage on the road that
  // exists to survive outages.
  if (!publicKey) throw new Error("VAPID public key is missing");
  if (!privateKey) throw new Error("VAPID private key is missing");
  if (!subject) throw new Error("VAPID subject is missing");

  webpush.setVapidDetails(subject, publicKey, privateKey);

  return {
    transport: "webpush",
    async send(
      sub: DeviceSubscription,
      payload: NotificationPayload
    ): Promise<SendResult> {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload)
        );
        return { ok: true };
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410 mean the push service has forgotten this subscription — the
        // only death signal there is. Anything else, including a network
        // throw with no status at all, is transient by default: deleting a
        // device on a 500 would quietly un-reach a teacher who did nothing
        // wrong.
        const gone = status === 404 || status === 410;
        return {
          ok: false,
          gone,
          status,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}
```

Create `src/lib/notifications/index.ts`:

```ts
import type { NotificationPort } from "./port";
import { webPushPort } from "./webpush";

export * from "./port";
export * from "./payload";

// The single place any caller obtains a port, mirroring payments/index.ts.
// Adding APNs or FCM means one branch here and one adapter file.
export function getNotificationPort(): NotificationPort {
  return webPushPort(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
    process.env.VAPID_PRIVATE_KEY ?? "",
    process.env.VAPID_SUBJECT ?? ""
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/notifications/webpush.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Propose the VAPID keys for the user to paste**

Generate and print, then **stop** until the user confirms. The private key must not be committed or logged anywhere else.

```bash
node -e 'const w=require("web-push");const k=w.generateVAPIDKeys();
console.log("NEXT_PUBLIC_VAPID_PUBLIC_KEY="+k.publicKey);
console.log("VAPID_PRIVATE_KEY="+k.privateKey);
console.log("VAPID_SUBJECT=mailto:ops@smbtutorials.in");'
```

Tell the user these three lines go in `.env.local` **and** in Vercel for Production, Preview and Development.

- [ ] **Step 7: Commit**

```bash
git add src/lib/notifications package.json package-lock.json
git commit -m "feat(notifications): transport port and web-push adapter behind it"
```

---

### Task 8: The dispatcher and the fan-out

Spec §5.1, §8.

**Files:**
- Create: `src/lib/notifications/dispatch.ts`
- Test: `src/lib/notifications/dispatch.test.ts`
- Modify: `src/app/(app)/(student)/teachers/actions.ts`

**Interfaces:**
- Consumes: `getNotificationPort`, `requestPayload` (Task 7); `register_device`'s table from Task 5.
- Produces: `notifyTeacherOfRequest(teacherId: string, studentName: string, subject: string): Promise<{ sent: number; pruned: number }>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/notifications/dispatch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const send = vi.fn();
const deleted: string[] = [];

vi.mock("./index", async () => {
  const actual = await vi.importActual<typeof import("./index")>("./index");
  return { ...actual, getNotificationPort: () => ({ transport: "webpush", send }) };
});

vi.mock("@/lib/supabase/admin", () => ({
  createDispatchClient: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({
          data: [
            { id: "d1", endpoint: "e1", p256dh: "k1", auth: "a1" },
            { id: "d2", endpoint: "e2", p256dh: "k2", auth: "a2" },
          ],
          error: null,
        }),
      }),
      delete: () => ({ in: async (_c: string, ids: string[]) => { deleted.push(...ids); return { error: null }; } }),
      update: () => ({ in: async () => ({ error: null }) }),
    }),
  }),
}));

import { notifyTeacherOfRequest } from "./dispatch";

beforeEach(() => { send.mockReset(); deleted.length = 0; });

describe("notifyTeacherOfRequest", () => {
  it("sends to every registered device", async () => {
    send.mockResolvedValue({ ok: true });
    const result = await notifyTeacherOfRequest("t1", "Aditya", "Mathematics");
    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 2, pruned: 0 });
  });

  it("prunes only the devices the service says are gone", async () => {
    send
      .mockResolvedValueOnce({ ok: false, gone: true, status: 410, error: "gone" })
      .mockResolvedValueOnce({ ok: false, gone: false, status: 500, error: "boom" });
    const result = await notifyTeacherOfRequest("t1", "Aditya", "Mathematics");
    expect(deleted).toEqual(["d1"]);
    expect(result).toEqual({ sent: 0, pruned: 1 });
  });

  // One dead device must not stop a live one from ringing. The roads are
  // independent by design and so are the devices on one road.
  it("keeps sending after one device throws", async () => {
    send
      .mockRejectedValueOnce(new Error("unexpected"))
      .mockResolvedValueOnce({ ok: true });
    const result = await notifyTeacherOfRequest("t1", "Aditya", "Mathematics");
    expect(result.sent).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/notifications/dispatch.test.ts`
Expected: FAIL — cannot resolve `./dispatch` or `@/lib/supabase/admin`.

- [ ] **Step 3: Write the elevated client**

Create `src/lib/supabase/admin.ts`:

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";

// Spec §12: the dispatcher needs a privileged read of teacher_devices across
// teachers, and the cycle-1 handoff reserves the service role for the payment
// webhook alone. Which credential this ends up being is a DEFERRED decision —
// a dedicated sb_secret_* key is preferred, the service role is the fallback.
//
// It is one line of config on purpose. Set NOTIFICATION_DB_KEY to narrow the
// blast radius; leave it unset and this falls back to the service role, which
// works but widens that key's reach into a student-triggerable path.
export function createDispatchClient() {
  const key =
    process.env.NOTIFICATION_DB_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("No dispatcher credential configured");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

Create `src/lib/notifications/dispatch.ts`:

```ts
import "server-only";
import { createDispatchClient } from "@/lib/supabase/admin";
import { getNotificationPort, requestPayload } from "./index";

// Road 2 of the fan-out (spec §5.1). Road 1 is the existing realtime card,
// and the two know nothing about each other on purpose: one failing still
// leaves one landing.
export async function notifyTeacherOfRequest(
  teacherId: string,
  studentName: string,
  subject: string
): Promise<{ sent: number; pruned: number }> {
  const supabase = createDispatchClient();

  const { data: devices, error } = await supabase
    .from("teacher_devices")
    .select("id, endpoint, p256dh, auth")
    .eq("teacher_id", teacherId);

  if (error || !devices?.length) {
    if (error) console.error("[notify] device read failed", error);
    return { sent: 0, pruned: 0 };
  }

  const port = getNotificationPort();
  const payload = requestPayload(studentName, subject);

  // In parallel, and every device settled independently: one dead phone must
  // not stop a live one from ringing.
  const results = await Promise.allSettled(
    devices.map((d) =>
      port.send({ endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth }, payload)
    )
  );

  const gone: string[] = [];
  const failed: string[] = [];
  let sent = 0;

  results.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      failed.push(devices[i].id);
      return;
    }
    if (r.value.ok) { sent++; return; }
    if (r.value.gone) gone.push(devices[i].id);
    else failed.push(devices[i].id);
  });

  // 404/410 is the only death signal a subscription has, so it is the only
  // thing that deletes a row.
  if (gone.length) {
    const { error: delError } = await supabase
      .from("teacher_devices").delete().in("id", gone);
    if (delError) console.error("[notify] prune failed", delError);
  }

  // Transient failures are recorded, never deleted — a teacher must not lose
  // reachability because a push service had a bad minute.
  if (failed.length) {
    const { error: updError } = await supabase
      .from("teacher_devices")
      .update({ last_failed_at: new Date().toISOString() })
      .in("id", failed);
    if (updError) console.error("[notify] failure stamp failed", updError);
  }

  return { sent, pruned: gone.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/notifications/dispatch.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire the fan-out into `requestSession`**

In `src/app/(app)/(student)/teachers/actions.ts`, after the session insert succeeds and **before** the `redirect()` — `redirect()` throws, so anything scheduled after it never runs. Read `node_modules/next/dist/docs/` for this version's post-response API (`after()` from `next/server`) before writing it.

```ts
import { after } from "next/server";
import { notifyTeacherOfRequest } from "@/lib/notifications/dispatch";

// ...after the insert, before redirect():
// The student must not wait on a push service to see their waiting screen.
after(async () => {
  try {
    await notifyTeacherOfRequest(
      input.teacherId,
      session.student_name ?? "A student",
      input.subject
    );
  } catch (e) {
    // Road 2 failing must never take the request down with it — road 1 is
    // still live and the catch-up query still runs on the teacher's mount.
    console.error("[requestSession] push fan-out failed", e);
  }
});
```

- [ ] **Step 6: Verify the whole suite and the build**

Run: `npm test && npx tsc --noEmit && npx eslint && npm run build`
Expected: all clean. If the build complains about the Node runtime, add `export const runtime = "nodejs"` to the route that hosts the action — VAPID signing cannot run on Edge.

- [ ] **Step 7: Commit**

```bash
git add src/lib/notifications/dispatch.ts src/lib/notifications/dispatch.test.ts src/lib/supabase/admin.ts "src/app/(app)/(student)/teachers/actions.ts"
git commit -m "feat(notifications): fan out a push beside the realtime road, pruning only on 404/410"
```

---

### Task 9: The PWA — manifest, icons, service worker

Spec §7.1. There is no Web Push without a service worker, so this is mandatory, not polish.

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/sw.js`
- Create: `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: a registered service worker handling `push` and `notificationclick`; a manifest making iOS installable.

- [ ] **Step 1: Generate the icons**

No icon assets exist. Generate a plain teal mark — a rounded square in the brand teal with a white "SMB". Recorded as a **known placeholder** (spec §7.1), swapped when a real logo exists.

```bash
node -e '
const fs=require("fs");
const svg=(s)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><rect width="${s}" height="${s}" rx="${s*0.18}" fill="#0d9488"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,sans-serif" font-weight="700" font-size="${s*0.3}" fill="#fff">SMB</text></svg>`;
for (const s of [192,512]) fs.writeFileSync(`public/icon-${s}.svg`, svg(s));
console.log("SVG marks written — convert to PNG before committing");'
```

Convert to PNG with any available tool (`sips -s format png public/icon-192.svg --out public/icon-192.png` on macOS), produce `icon-maskable-512.png` from the 512 with ~20% padding, then delete the SVGs.

- [ ] **Step 2: Write the manifest**

Create `public/manifest.webmanifest`:

```json
{
  "name": "SMB Tutorials",
  "short_name": "SMB",
  "description": "Teach one-to-one, on demand.",
  "start_url": "/home",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0d9488",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`start_url` is `/home`, the role router, so the installed app serves either role later. On the very first launch inside an installed iOS app there is no session — it lands on `/signin`, then `/home`, then `/dashboard`. That sequence is the point of Task 11's copy.

- [ ] **Step 3: Write the service worker**

Create `public/sw.js`:

```js
// Push only. No caching, no offline shell, no precache manifest.
//
// That is a deliberate limit (spec §7.1): caching a Next.js app carelessly
// serves stale RSC payloads, offline is out of scope for this cycle, and a
// worker that only handles push has almost no failure surface to debug at
// 2am. If offline is ever wanted, it arrives as its own decision.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload must still wake the teacher: userVisibleOnly means
    // a push that shows nothing is a permission violation, and browsers
    // punish it by revoking the subscription.
  }
  const title = data.title || "New session request";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "A student is asking for a session.",
      tag: data.tag || "session-request",
      data: { url: data.url || "/dashboard" },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      requireInteraction: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // Focus a tab that is already on the dashboard rather than opening a
      // second one — two dashboards means two presence entries and a teacher
      // who cannot tell which is live.
      for (const client of list) {
        if (client.url.includes(target) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

// Fired when the browser rotates a subscription. Handled, but NOT trusted:
// Safari's support is thin, so the real backstop is the re-registration the
// dashboard performs on every mount (spec §8).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: event.oldSubscription
          ? event.oldSubscription.options.applicationServerKey
          : undefined,
      })
      .then((sub) =>
        fetch("/api/devices", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        })
      )
      .catch(() => {
        // Nothing to do here. The dashboard's mount-time re-registration
        // repairs it the next time the teacher opens the app.
      })
  );
});
```

- [ ] **Step 4: Link the manifest from the root layout**

In `src/app/layout.tsx`, extend the existing `metadata` export:

```ts
export const metadata: Metadata = {
  title: "SMB Tutorials",
  description: "Find a teacher online right now for a one-to-one video lesson.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "SMB", statusBarStyle: "default" },
};
```

- [ ] **Step 5: Verify it is served**

```bash
npm run dev &
sleep 5
node -e '(async()=>{for(const p of ["/manifest.webmanifest","/sw.js","/icon-192.png"]){const r=await fetch("http://localhost:3000"+p);console.log(p,r.status,r.headers.get("content-type"));}})()'
```

Expected: all three 200. `sw.js` must be served from the **root** — a worker under `/_next/` cannot claim scope `/`.

- [ ] **Step 6: Commit**

```bash
git add public/manifest.webmanifest public/sw.js public/icon-192.png public/icon-512.png public/icon-maskable-512.png src/app/layout.tsx
git commit -m "feat(pwa): manifest, placeholder icons and a push-only service worker"
```

---

### Task 10: Push client and the onboarding state machine

Spec §7.2, §8. The state machine is pure and exhaustively tested; the browser reads sit beside it.

**Files:**
- Create: `src/lib/push/state.ts`
- Create: `src/lib/push/client.ts`
- Test: `src/lib/push/state.test.ts`
- Create: `src/app/api/devices/route.ts`

**Interfaces:**
- Consumes: `register_device` RPC (Task 5).
- Produces:
  - `type SetupFacts = { isIOS: boolean; standalone: boolean; permission: NotificationPermission; hasSubscription: boolean }`
  - `type SetupAction = "install_ios" | "enable" | "blocked" | "done"`
  - `nextSetupAction(facts: SetupFacts): SetupAction`
  - `readSetupFacts(): Promise<SetupFacts>`
  - `enableNotifications(): Promise<{ ok: true } | { error: string }>`
  - `registerExistingSubscription(): Promise<void>`
  - `closeStaleNotifications(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/push/state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextSetupAction, type SetupFacts } from "./state";

const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  isIOS: false, standalone: false, permission: "default", hasSubscription: false, ...over,
});

describe("nextSetupAction", () => {
  // iOS is checked FIRST and deliberately. An iPhone Safari tab has no
  // PushManager at all, so asking for permission there is impossible — the
  // install is the only next step that can lead anywhere.
  it("asks an iPhone in a Safari tab to install, whatever else is true", () => {
    expect(nextSetupAction(facts({ isIOS: true }))).toBe("install_ios");
    expect(nextSetupAction(facts({ isIOS: true, permission: "granted" }))).toBe("install_ios");
  });

  it("does not ask a desktop or Android user to install anything", () => {
    // Push works in an ordinary tab everywhere except iOS. Pushing an install
    // on Android would be friction with nothing behind it.
    expect(nextSetupAction(facts())).toBe("enable");
  });

  it("asks an installed iPhone to enable", () => {
    expect(nextSetupAction(facts({ isIOS: true, standalone: true }))).toBe("enable");
  });

  // A denied permission is close to permanent — browsers will not let us ask
  // twice — so this state gets its own honest dead end rather than a button
  // that silently does nothing.
  it("reports a dead end when permission is denied", () => {
    expect(nextSetupAction(facts({ permission: "denied" }))).toBe("blocked");
    expect(nextSetupAction(facts({ isIOS: true, standalone: true, permission: "denied" }))).toBe("blocked");
  });

  it("is done once permission is granted and a subscription exists", () => {
    expect(nextSetupAction(facts({ permission: "granted", hasSubscription: true }))).toBe("done");
  });

  // Granted but no subscription is repaired silently by the mount-time
  // registration, so the teacher is never shown a button for it.
  it("is done when granted even without a subscription yet", () => {
    expect(nextSetupAction(facts({ permission: "granted", hasSubscription: false }))).toBe("done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/push/state.test.ts`
Expected: FAIL — cannot resolve `./state`.

- [ ] **Step 3: Write the state machine**

Create `src/lib/push/state.ts`:

```ts
// Onboarding is a state machine, not a wizard (spec §7.2). The shape is
// forced by a browser fact: an installed iOS web app has its OWN cookie jar,
// storage and service worker, so a teacher who signs up in Safari and then
// installs lands in a signed-out app. The permission ask therefore cannot
// live in the signup flow on iOS — the tab where they sign up can never hold
// a subscription. It has to happen wherever they land after installing,
// which is the dashboard.
//
// Keeping this pure is what makes the four-way table testable without a
// browser; the impure reads live in client.ts.

export interface SetupFacts {
  isIOS: boolean;
  standalone: boolean;
  permission: NotificationPermission;
  hasSubscription: boolean;
}

export type SetupAction = "install_ios" | "enable" | "blocked" | "done";

export function nextSetupAction(f: SetupFacts): SetupAction {
  // Order matters. iOS Safari reports permission "default" and has no
  // PushManager, so any other branch first would offer a button that cannot
  // work.
  if (f.isIOS && !f.standalone) return "install_ios";
  if (f.permission === "denied") return "blocked";
  if (f.permission === "default") return "enable";
  // Granted. A missing subscription is repaired silently by the mount-time
  // registration, so it is not something to put a button in front of.
  return "done";
}
```

Create `src/lib/push/client.ts`:

```ts
"use client";

import type { SetupFacts } from "./state";
import { REQUEST_TAG } from "@/lib/notifications/payload";

const SW_PATH = "/sw.js";

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as MacIntel with touch points, which is why the
  // user-agent test alone is not enough.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export async function readSetupFacts(): Promise<SetupFacts> {
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  if (!supported) {
    return {
      isIOS: detectIOS(),
      standalone: detectStandalone(),
      permission: "default",
      hasSubscription: false,
    };
  }

  let hasSubscription = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    hasSubscription = Boolean(await reg?.pushManager.getSubscription());
  } catch {
    // A blocked storage context throws here. Treat it as "no subscription"
    // rather than crashing the dashboard.
  }

  return {
    isIOS: detectIOS(),
    standalone: detectStandalone(),
    permission: Notification.permission,
    hasSubscription,
  };
}

// Called ONLY from a user's explicit tap. Never on page load: a denied
// permission is close to permanent, and spending it on a load nobody asked
// for costs that teacher the push road forever (spec §6.4).
export async function enableNotifications(): Promise<
  { ok: true } | { error: string }
> {
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH);
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { error: "Notifications are blocked for this site." };
    }
    const sub = await reg.pushManager.subscribe({
      // Mandatory. There is no silent push, which is also why there is no
      // silent way to test whether a device is still reachable.
      userVisibleOnly: true,
      applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    });
    await postSubscription(sub);
    return { ok: true };
  } catch (e) {
    console.error("[push] enable failed", e);
    return { error: "Couldn't turn on notifications — try again." };
  }
}

// The re-registration-on-launch path (spec §8). Idempotent, cheap, and it
// repairs drift without anyone noticing — including a subscription rotated
// while the app was closed, which pushsubscriptionchange cannot be relied on
// to report.
export async function registerExistingSubscription(): Promise<void> {
  try {
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.register(SW_PATH);
    const sub = await reg.pushManager.getSubscription();
    if (sub) await postSubscription(sub);
  } catch (e) {
    console.error("[push] re-registration failed", e);
  }
}

// Spec §5.2. A teacher who arrives by notification lands on a dashboard that
// already shows the request via the existing catch-up query — so the
// notification behind it is stale the instant they get here. There is no
// dismissal push available to us (userVisibleOnly means every push must be
// visible), so the only way to clear it is from the page itself.
export async function closeStaleNotifications(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    const open = await reg.getNotifications({ tag: REQUEST_TAG });
    open.forEach((n) => n.close());
  } catch {
    // A browser that cannot enumerate notifications simply keeps showing one
    // that is merely redundant, never wrong. Not worth failing over.
  }
}

async function postSubscription(sub: PushSubscription): Promise<void> {
  await fetch("/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
}
```

Create `src/app/api/devices/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The service worker cannot call a Server Action, so registration lands here.
// It is a thin shell over register_device, which does the real work under
// security definer (spec §4.3).
export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "incomplete subscription" }, { status: 400 });
  }

  const { error } = await supabase.rpc("register_device", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: request.headers.get("user-agent") ?? null,
  });

  if (error) {
    console.error("[api/devices] register_device failed", error);
    return NextResponse.json({ error: "could not register" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.endpoint) {
    return NextResponse.json({ error: "no endpoint" }, { status: 400 });
  }
  // RLS scopes this to the caller's own rows, so an endpoint belonging to
  // someone else simply matches nothing.
  const { error } = await supabase
    .from("teacher_devices").delete().eq("endpoint", body.endpoint);
  if (error) return NextResponse.json({ error: "could not remove" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/push/state.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/push src/app/api/devices/route.ts
git commit -m "feat(push): onboarding state machine, client helpers and the device endpoint"
```

---

### Task 11: The setup surface — full-screen step and dashboard card

Spec §7.2, §7.3, §7.4. **Copy is verbatim.**

**Files:**
- Create: `src/components/notification-setup.tsx`
- Create: `src/app/(app)/(teacher)/setup/page.tsx`
- Modify: `src/app/(app)/(teacher)/dashboard/page.tsx`
- Modify: `src/app/(marketing)/tutor-signup/actions.ts`
- Test: `src/components/notification-setup.test.tsx`

**Interfaces:**
- Consumes: `nextSetupAction`, `readSetupFacts`, `enableNotifications`, `registerExistingSubscription` (Task 10).
- Produces: `<NotificationSetup variant="full" | "card" />`.

- [ ] **Step 1: Write the failing test**

Create `src/components/notification-setup.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const readSetupFacts = vi.fn();
const enableNotifications = vi.fn();

vi.mock("@/lib/push/client", () => ({
  readSetupFacts: () => readSetupFacts(),
  enableNotifications: () => enableNotifications(),
  registerExistingSubscription: async () => {},
}));

import { NotificationSetup } from "./notification-setup";

beforeEach(() => { readSetupFacts.mockReset(); enableNotifications.mockReset(); });

describe("NotificationSetup", () => {
  it("gives an iPhone in Safari the Add to Home Screen instruction", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: true, standalone: false, permission: "default", hasSubscription: false,
    });
    render(<NotificationSetup variant="card" />);
    await waitFor(() => expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument());
    // The re-sign-in cliff must be stated up front, not discovered.
    expect(screen.getByText(/sign in once more/i)).toBeInTheDocument();
  });

  it("offers a single enable button elsewhere", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: false, standalone: false, permission: "default", hasSubscription: false,
    });
    render(<NotificationSetup variant="card" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /turn on notifications/i })).toBeInTheDocument()
    );
  });

  it("renders nothing once setup is complete", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: false, standalone: false, permission: "granted", hasSubscription: true,
    });
    const { container } = render(<NotificationSetup variant="card" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("explains the dead end when permission is denied", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: false, standalone: false, permission: "denied", hasSubscription: false,
    });
    render(<NotificationSetup variant="card" />);
    await waitFor(() => expect(screen.getByText(/browser settings/i)).toBeInTheDocument());
    // No button: browsers will not let us ask twice, so offering one would lie.
    expect(screen.queryByRole("button", { name: /turn on/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/notification-setup.test.tsx`
Expected: FAIL — cannot resolve `./notification-setup`.

- [ ] **Step 3: Write the component**

Create `src/components/notification-setup.tsx` as a `"use client"` component that calls `readSetupFacts()` in an effect, derives `nextSetupAction(...)`, calls `registerExistingSubscription()` when the action is `done`, and renders one of four states. Use `Card`, `Button` and `FormError` from the existing component layer. **These strings are the spec's honesty requirements — use them exactly:**

- `install_ios` — heading **"One more step so students can reach you"**, body **"iPhone needs the app on your Home Screen before it can notify you. Tap Share, then Add to Home Screen. Open it from there and sign in once more — then we'll finish setting up."**
- `enable` — heading **"Turn on notifications"**, body **"We'll notify you when a student asks for a session, even with your phone locked."**, button **"Turn on notifications"**.
- `blocked` — heading **"Can't reach you"**, body **"Notifications are blocked for this site, so students aren't being shown to you when your dashboard is closed. You can turn them back on in your browser settings for this site."** No button.
- `done` — render `null`.

`variant="full"` wraps the same content in a centred full-screen layout with a **"Skip for now"** link to `/dashboard`; `variant="card"` renders the `Card` inline.

- [ ] **Step 4: Create the full-screen step and route signup into it**

Create `src/app/(app)/(teacher)/setup/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth";
import { NotificationSetup } from "@/components/notification-setup";

export default async function SetupPage() {
  await requireRole("teacher");
  return <NotificationSetup variant="full" />;
}
```

In `src/app/(marketing)/tutor-signup/actions.ts`, change the final line from `redirect("/home")` to `redirect("/setup")`.

In `src/app/(app)/(teacher)/dashboard/page.tsx`, render `<NotificationSetup variant="card" />` directly above `<DashboardLive .../>`. This is what retro-onboards existing teachers and what reappears when a working setup later breaks — one component, three appearances, no separate mechanism.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/notification-setup.test.tsx && npx tsc --noEmit`
Expected: PASS, 4 tests, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/notification-setup.tsx src/components/notification-setup.test.tsx "src/app/(app)/(teacher)/setup/page.tsx" "src/app/(app)/(teacher)/dashboard/page.tsx" "src/app/(marketing)/tutor-signup/actions.ts"
git commit -m "feat(onboarding): one setup component for signup, retro-onboarding and repair"
```

---

### Task 12: Rework the availability toggle

Spec §6.1, §6.3. **Delete the apology.**

**Files:**
- Modify: `src/app/(app)/(teacher)/dashboard/availability-toggle.tsx`
- Modify: `src/app/(app)/(teacher)/dashboard/dashboard-live.tsx`
- Modify: `src/app/(app)/(teacher)/dashboard/page.tsx`
- Test: `src/app/(app)/(teacher)/dashboard/availability-toggle.test.tsx`

**Interfaces:**
- Consumes: `declareAvailable`, `undeclareAvailable`, `renewLease` (Task 4); `formatLeaseEnd`, `isLeaseLive` (Task 2); `readSetupFacts` (Task 10).
- Produces: a toggle whose durable state is the declaration, not `localStorage`.

- [ ] **Step 1: Write the failing test**

Create `src/app/(app)/(teacher)/dashboard/availability-toggle.test.tsx` asserting:

```tsx
// The sentence this cycle exists to delete. Its presence is a regression.
it("never tells the teacher to keep the tab open", async () => {
  render(<AvailabilityToggle {...props} declaredUntil={futureIso} />);
  await waitFor(() => expect(screen.getByText(/Available until/i)).toBeInTheDocument());
  expect(screen.queryByText(/keep this tab open/i)).not.toBeInTheDocument();
});

it("shows the lease end so lapsing is what the teacher agreed to", async () => {
  render(<AvailabilityToggle {...props} declaredUntil={futureIso} />);
  await waitFor(() =>
    expect(screen.getByText(/we'll notify you even with your phone locked/i)).toBeInTheDocument()
  );
});

// A lapsed lease must read as Offline and say so, rather than leaving the
// teacher to infer it from a toggle that silently moved.
it("reads Offline and explains when the lease has lapsed", async () => {
  render(<AvailabilityToggle {...props} declaredUntil={pastIso} />);
  await waitFor(() => expect(screen.getByText(/Your availability ended at/i)).toBeInTheDocument());
});

// Declared but unreachable: hidden from students, and TOLD. This is the
// state cycle 1 built the vocabulary for and had no mechanism to produce.
it("shows Can't reach you when declared with no device and no live channel", async () => {
  readSetupFacts.mockResolvedValue({ isIOS: false, standalone: false, permission: "denied", hasSubscription: false });
  render(<AvailabilityToggle {...props} declaredUntil={futureIso} channelFailed />);
  await waitFor(() => expect(screen.getByText(/Can't reach you/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(app)/(teacher)/dashboard/availability-toggle.test.tsx"`
Expected: FAIL — the component takes no `declaredUntil` prop yet, and the "keep this tab open" assertion fails because that string is still there.

- [ ] **Step 3: Rework the component**

Changes, all of them root-cause rather than cosmetic:

1. **`page.tsx` reads the declaration server-side** and passes `declaredUntil` down through `DashboardLive`. The `localStorage` intent flag stops being the source of truth; keep it only as an offline-first hint for the presence channel, or delete it if presence subscribes off the declaration cleanly.
2. **`goOnline()` calls `declareAvailable()` first**, then tracks presence. Presence without a declaration is the old lie; a declaration is what push is authorised against.
3. **`goOffline()` calls `undeclareAvailable()`** as well as untracking.
4. **On mount and every 10 minutes while visible, call `renewLease()`.** The server decides whether to write; the client only asks.
5. **On mount, call `closeStaleNotifications()`** (spec §5.2). A teacher who arrived by tapping a notification is looking at the dashboard now, and `incoming-request.tsx`'s catch-up query has already put the request card in front of them — leaving the notification up asks them to dismiss something they have already acted on. There is no dismissal push available to us, so the page is the only place this can happen.
6. **Delete the `status === "available"` block containing `"Keep this tab open — closing it takes you offline."`** — this string must not survive the task.
7. **Status derivation** becomes: not declared or lease lapsed → `offline`; declared and `inSession` → `in_session`; declared, lease live, and (presence channel healthy **or** a registered device exists) → `available`; declared, lease live, neither → `unreachable`.
8. Copy per state — `available`: **"Available until {formatLeaseEnd(declaredUntil)} — we'll notify you even with your phone locked."**; lapsed: **"Your availability ended at {formatLeaseEnd(declaredUntil)}."**; `unreachable`: the existing `STATUS_COPY.unreachable.description` plus the setup card, which is already on the page from Task 11.

- [ ] **Step 4: Run the tests and the whole suite**

Run: `npm test && npx tsc --noEmit && npx eslint`
Expected: all clean.

- [ ] **Step 5: Prove the string is gone**

```bash
grep -rn "Keep this tab open" src/ && echo "STILL PRESENT — task incomplete" || echo "apology deleted"
```

Expected: `apology deleted`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/(teacher)/dashboard/"
git commit -m "feat(availability): declaration-backed toggle, and delete the keep-this-tab-open apology"
```

---

### Task 13: The student roster — RPC, ranking and polling

Spec §4.4, §4.4.2, §6.2.

**Files:**
- Create: `src/lib/roster.ts`
- Test: `src/lib/roster.test.ts`
- Modify: `src/app/(app)/(student)/teachers/online-list.tsx`

**Interfaces:**
- Consumes: `available_teachers` RPC (Task 6); `rosterFromPresenceState`, `OnlineTeacher` from `@/lib/presence`.
- Produces:
  - `interface AvailableRow { teacher_id: string; has_device: boolean }`
  - `deriveRoster<T extends { id: string }>(eligible: T[], available: AvailableRow[], presence: OnlineTeacher[]): T[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/roster.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveRoster } from "./roster";

const t = (id: string) => ({ id, full_name: id });
const present = (id: string) => ({ teacher_id: id, full_name: id, hourly_rate: 500 });

describe("deriveRoster", () => {
  it("keeps a teacher with a live connection", () => {
    expect(
      deriveRoster([t("a")], [{ teacher_id: "a", has_device: false }], [present("a")]).map((x) => x.id)
    ).toEqual(["a"]);
  });

  // The push-only tier — the entire point of the cycle. A teacher with a
  // locked phone and a registered device is still startable.
  it("keeps a teacher with no connection but a working device", () => {
    expect(
      deriveRoster([t("a")], [{ teacher_id: "a", has_device: true }], []).map((x) => x.id)
    ).toEqual(["a"]);
  });

  // "Can't reach you" — hidden, not greyed. M2's rule: every visible card is
  // genuinely startable.
  it("hides a declared teacher with neither", () => {
    expect(deriveRoster([t("a")], [{ teacher_id: "a", has_device: false }], [])).toEqual([]);
  });

  it("hides a teacher the RPC did not return at all", () => {
    // Not declared, lease lapsed, or already in a session.
    expect(deriveRoster([t("a")], [], [present("a")])).toEqual([]);
  });

  // RANK, DON'T LABEL (spec §6.2). Badging push-only teachers would punish
  // exactly the teachers who did what we asked, and would land hardest on
  // iPhone users — a marketplace quietly discriminating by handset. Sorting
  // gets the same outcome with none of that.
  it("ranks live-connection teachers above push-only ones", () => {
    const out = deriveRoster(
      [t("push"), t("live")],
      [{ teacher_id: "push", has_device: true }, { teacher_id: "live", has_device: false }],
      [present("live")]
    );
    expect(out.map((x) => x.id)).toEqual(["live", "push"]);
  });

  it("preserves the incoming order within each tier", () => {
    const out = deriveRoster(
      [t("p1"), t("l1"), t("p2"), t("l2")],
      ["p1", "l1", "p2", "l2"].map((id) => ({ teacher_id: id, has_device: true })),
      [present("l1"), present("l2")]
    );
    expect(out.map((x) => x.id)).toEqual(["l1", "l2", "p1", "p2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/roster.test.ts`
Expected: FAIL — cannot resolve `./roster`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/roster.ts`:

```ts
import type { OnlineTeacher } from "./presence";

export interface AvailableRow {
  teacher_id: string;
  has_device: boolean;
}

// The final AND of spec §3.3's expression, and the ONLY place it can happen:
// the RPC knows the declaration, the lease and the in-session state but
// cannot see presence, because presence lives in the Realtime service rather
// than in Postgres. The client is where both halves exist at once.
//
// has_device arrives PUBLISHED, not applied — the RPC deliberately still
// returns a teacher with no device, because such a teacher may have the
// dashboard open right now and be perfectly reachable.
export function deriveRoster<T extends { id: string }>(
  eligible: T[],
  available: AvailableRow[],
  presence: OnlineTeacher[]
): T[] {
  const reachable = new Map(available.map((r) => [r.teacher_id, r.has_device]));
  const live = new Set(presence.map((p) => p.teacher_id));

  const kept = eligible.filter((e) => {
    if (!reachable.has(e.id)) return false;      // not declared / lapsed / busy
    return live.has(e.id) || reachable.get(e.id) === true;
  });

  // Rank, don't label (spec §6.2). A visible second tier would stop push-only
  // teachers being picked at all; ordering gets the student to the fastest
  // teacher without marking anyone second-rate. Stable within each tier.
  const liveTier = kept.filter((e) => live.has(e.id));
  const pushTier = kept.filter((e) => !live.has(e.id));
  return [...liveTier, ...pushTier];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/roster.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire it into the list, with polling**

In `src/app/(app)/(student)/teachers/online-list.tsx`:

1. Add state `available: AvailableRow[]`.
2. Add a `loadAvailable()` callback calling `supabase.rpc("available_teachers", { p_curriculum: curriculum, p_grade: grade, p_stream: stream, p_subject: subject })`.
3. Call it on mount, on `window` **focus**, and on a **30-second interval** while the document is visible. Clear both on unmount.
4. Replace `intersectOnline(eligible, roster)` with `deriveRoster(eligible, available, roster)`.
5. Leave `connFailed` alone — but note it now means "the live tier is unknown", not "nobody is online", because push-only teachers still list without the channel.

The comment to leave at the polling effect:

```ts
// Presence streams the live tier; the push-only tier is a snapshot from the
// RPC, so it needs refreshing or a teacher who declares while the student
// watches never appears. Polling was chosen over Broadcast deliberately
// (spec §4.4.2): it scales with STUDENTS, whereas postgres_changes scales
// with teachers x students — ~67 req/s at 2,000 concurrent students, which
// is nothing. When this is outgrown the replacement is Broadcast, behind
// available_teachers, never postgres_changes.
```

- [ ] **Step 6: Verify**

Run: `npm test && npx tsc --noEmit && npx eslint && npm run build`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/roster.ts src/lib/roster.test.ts "src/app/(app)/(student)/teachers/online-list.tsx"
git commit -m "feat(roster): declaration-aware list, live-first ranking, focus and 30s polling"
```

---

### Task 14: The accept window, and telling the student the truth

Spec §5.3.

**Files:**
- Modify: `src/lib/session.ts:5`
- Modify: `src/app/(app)/(student)/waiting/[sessionId]/waiting-client.tsx`
- Modify: `src/lib/session.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ACCEPT_WINDOW_SECONDS === 60`.

- [ ] **Step 1: Update the test first**

In `src/lib/session.test.ts`, change every assertion that depends on a 30-second accept window to 60, and add:

```ts
it("gives a sleeping phone time to be woken", () => {
  // 30s was sized for a teacher already looking at the screen. Waking a
  // locked phone does not fit inside it: delivery, noticing, unlocking,
  // tapping. This is a DEADLINE, not a wait — a teacher who accepts in two
  // seconds still resolves in two seconds, so the fast path costs nothing.
  expect(ACCEPT_WINDOW_SECONDS).toBe(60);
  expect(acceptDeadlineFrom(new Date("2026-08-30T10:00:00Z")).toISOString())
    .toBe("2026-08-30T10:01:00.000Z");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/session.test.ts`
Expected: FAIL — expected 60, received 30.

- [ ] **Step 3: Change the constant and the waiting copy**

In `src/lib/session.ts:5`: `export const ACCEPT_WINDOW_SECONDS = 60;` and update its comment to say why.

In the waiting screen, add the one honest sentence beneath the countdown — the waiting screen is where the honesty lives, since §6.2 keeps it off the teacher cards:

```
Asking {teacherName}… this can take a moment if their phone is asleep.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. Any test still assuming 30 seconds is a test to update, not a failure to route around.

- [ ] **Step 5: Re-run the happy-path probe**

Run: `node scripts/probe-happy-path.mjs`
Expected: exit 0. It waits on real Postgres deadlines, so a changed window changes its timing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/session.ts src/lib/session.test.ts "src/app/(app)/(student)/waiting/"
git commit -m "feat(session): 60s accept window, and say why the wait may be longer"
```

---

### Task 15: Sign-out removes this device

Spec §8. A shared family phone must not keep waking a teacher who signed out.

**Files:**
- Modify: `src/app/auth/actions.ts:43-47`
- Create: `src/components/sign-out-button.tsx` (or modify the existing sign-out caller)

**Interfaces:**
- Consumes: `DELETE /api/devices` (Task 10).
- Produces: sign-out that unregisters the local subscription first.

- [ ] **Step 1: Write the failing test**

```tsx
it("removes this device's subscription before signing out", async () => {
  // Otherwise the next person to use this phone keeps receiving a teacher's
  // session requests — and that teacher believes they are reachable.
  const unsubscribe = vi.fn();
  render(<SignOutButton />);
  await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/devices", expect.objectContaining({ method: "DELETE" })));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/sign-out-button.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Client-side, before calling the `signOut` server action: read the current subscription, `DELETE /api/devices` with its endpoint, then `unsubscribe()` locally, then sign out. Every step wrapped so a failure still signs the teacher out — being unable to tidy a device row must never trap someone in a session they are trying to leave.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sign-out-button.tsx src/components/sign-out-button.test.tsx src/app/auth/actions.ts
git commit -m "feat(push): sign-out unregisters this device"
```

---

### Task 16: The browser walk — Playwright

Spec §9.4. **A debt three cycles old.**

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/two-browser.spec.ts`
- Create: `e2e/push.spec.ts`
- Modify: `package.json`, `vitest.config.ts`

- [ ] **Step 1: Install and configure**

```bash
npm install --save-dev @playwright/test
npx playwright install chrome
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:3000",
    // channel: "chrome" is NOT a preference. Playwright's bundled Chromium
    // ships without Google's API keys and generally CANNOT register for web
    // push at all — the push spec would go green while proving nothing,
    // which is the most dangerous failure mode in this cycle's spec (§9.4).
    ...devices["Desktop Chrome"],
    channel: "chrome",
  },
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true },
});
```

Add to `package.json` scripts: `"e2e": "playwright test"`. In `vitest.config.ts`, ensure `exclude` covers `e2e/**` so Vitest does not try to run Playwright specs.

- [ ] **Step 2: Write the two-browser walk**

`e2e/two-browser.spec.ts` — two browser contexts, a student and a teacher, driving: teacher goes available → student sees them listed → student starts → teacher's card appears → teacher accepts → student reaches the payment step. Then the cases no unit test can reach: teacher closes their tab while declared, and the student **still** sees them (push-only tier); teacher's lease is expired directly in the database, and the student stops seeing them.

- [ ] **Step 3: Write the push loop**

`e2e/push.spec.ts` — grant notification permission via `context.grantPermissions(["notifications"])`, let the dashboard register, assert a `teacher_devices` row exists, trigger a request from the student context, and assert the service worker received a `push` event. **If subscription registration fails, the test must FAIL LOUDLY rather than skip** — a skipped push test is indistinguishable from a passing one in CI, and that is exactly the trap §9.4 warns about.

- [ ] **Step 4: Run it**

Run: `npm run e2e`
Expected: both specs pass against a real Chrome. Report honestly which assertions ran and which were unreachable.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e package.json package-lock.json vitest.config.ts
git commit -m "test(e2e): two-browser walk and a real push loop, on channel chrome"
```

---

### Task 17: The locked-phone checklist

Spec §9.4. The part no machine here can do.

**Files:**
- Create: `docs/superpowers/checklists/2026-08-30-locked-phone-walk.md`

- [ ] **Step 1: Write the checklist**

A numbered list the user performs on a real iPhone and a real Android phone, each step naming its exact expected outcome:

1. iPhone Safari → `/dashboard` → the setup card says **Add to Home Screen**.
2. Share → Add to Home Screen → open from the Home Screen → **it asks you to sign in** (the separate cookie jar — confirm this rather than being surprised by it).
3. Sign in → dashboard → **Turn on notifications** → grant.
4. Go available → the pill reads **Available until {time}**.
5. **Lock the phone.** From another device, sign in as a student and request that teacher.
6. **A notification appears on the lock screen** within ~10 seconds.
7. Tap it → the app opens on `/dashboard` with the request card already showing, and the countdown has time left.
8. Accept → both parties reach the call.
9. Repeat 5–7 on Android, noting Doze delay if any.
10. Decline notifications on a second account → that teacher reads **Can't reach you** and does **not** appear in the student's list.

- [ ] **Step 2: Hand it to the user and record the result**

The user performs it. Record the outcome — including any step that failed — in `project_state.md`. **Do not mark this cycle verified until steps 6 and 7 have actually been observed by a human.**

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/checklists/
git commit -m "docs: locked-phone verification checklist"
```

---

## Final verification

- [ ] `npm test` — green, and the count is **above** Task 1's recorded baseline
- [ ] `npx tsc --noEmit` — exit 0
- [ ] `npx eslint` — clean
- [ ] `npm run build` — clean
- [ ] `node scripts/probe-session-rls.mjs` — exit 0
- [ ] `node scripts/probe-happy-path.mjs` — exit 0
- [ ] `node scripts/reconcile-payments.mjs` — exit 0
- [ ] `node scripts/probe-availability.mjs` — exit 0
- [ ] `npm run e2e` — passing against real Chrome
- [ ] `grep -rn "Keep this tab open" src/` — no matches
- [ ] Migration `0006` still **unapplied**; `0007`–`0009` applied
- [ ] Task 17's checklist performed by a human, steps 6 and 7 observed
