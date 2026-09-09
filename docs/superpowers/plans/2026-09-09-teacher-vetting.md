# Teacher Vetting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No teacher meets a child until a person has checked them. A vetting state on `profiles`, `available_teachers` returning only cleared teachers, and a push to the operator's phone the moment someone applies.

**Architecture:** The gate is one column and one `where` clause. `available_teachers` (`0010`) is already the single published roster read, so filtering there closes every path at once — the student list, the push dispatch and the session guard all consume it. Everything else in this plan exists so the operator can act on the gate: an admin role, an alert when work arrives, and a page listing who is waiting.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS + security-definer RPCs), web-push behind `src/lib/notifications/port.ts`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-child-safety-and-consent-design.md` (§10 vetting, §12 escalation, §13 schema)

## Global Constraints

- **The ID document is never stored.** Record that the check happened, who did it, and when — never the document, never a scan, never a URL to one. Spec §10: storing them recreates for teachers the honeypot the spec rejects for students.
- **Vetting states are exactly four:** `unvetted`, `cleared`, `suspended`, `removed`. Default `unvetted`. Spec §13.
- **An unvetted teacher keeps their account.** They can sign in, complete their profile, declare availability — they simply cannot be picked. Spec §10: "A teacher who has not been vetted can hold an account and complete their profile; they cannot be picked."
- **Migration files carry NO `begin;`/`commit;`.** `supabase db push` wraps each file in its own transaction. `CLAUDE.md`.
- **Applying DDL is blocked inside Claude Code by the permission classifier, deliberately.** The agent writes and verifies migrations; a human runs `supabase db push`. Every task that needs schema stops and says so.
- **`supabase/migrations-deferred/` is not on the push path.** Activating a file there is `git mv` into `supabase/migrations/`, then `supabase migration list`, then `db push` — never a ledger edit.
- Gates before every commit: `npx vitest run`, `npx tsc --noEmit`, `npx eslint .` (0 problems, warnings included), `npm run build`. Baseline is **312 passing / 3 skipped**.
- Do not push to `main`. Commit locally; the human decides when production deploys.
- Branch: `feat/teacher-vetting`, cut from `main` — **not** from `feat/visual-identity`, which carries unrelated unshipped design work.

## What is deliberately NOT in this plan

- **The Tutor Agreement document.** Spec §10 makes a signed agreement one of the three gates, and the signup form already links to it. It does not exist and it is the owner's to write. This plan records *that* a teacher was cleared; it cannot enforce a document nobody has drafted.
- **`0021` — the conduct-report auto-suspend trigger and `report_reviews`.** Spec §12. Separate piece; this plan ships the state it will drive.
- **`0022` — recording.** Spec §11, separate piece.
- **WhatsApp delivery.** Business-initiated WhatsApp needs a provider account plus Meta verification and an approved template — days, not hours. The notification port (`src/lib/notifications/port.ts`) is the seam an adapter drops into later with no caller change. This plan alerts by web push, which is built and proven.
- **A third-party background check.** Spec §10 defers it explicitly; the state machine is shaped so adding one is a new value, not a new mechanism.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0006_roles_admin.sql` | **Activated** from `migrations-deferred/`. Widens the role CHECK to include `admin`. |
| `supabase/migrations/0020_teacher_vetting.sql` | **New.** Vetting columns, the `available_teachers` filter, and the clearing RPC. |
| `src/lib/vetting.ts` | **New.** Pure state rules: the four states, legal transitions, and what each means to a teacher. |
| `src/lib/vetting.test.ts` | **New.** Its tests. |
| `src/lib/auth.ts` | Extend `Identity` with `vettingState`. |
| `src/app/(marketing)/tutor-signup/actions.ts` | Notify the operator when an application lands. |
| `src/lib/notifications/dispatch.ts` | Add `notifyAdminsOfApplication`, beside the existing teacher dispatch. |
| `src/lib/notifications/payload.ts` | Add `applicationPayload` and its tag. |
| `src/components/vetting-banner.tsx` | **New.** Tells an unvetted teacher why they are not listed. |
| `src/app/(app)/(teacher)/dashboard/page.tsx` | Render the banner. |
| `src/app/(app)/admin/page.tsx` | **New.** The waiting list, with the video link and a WhatsApp deep link. |
| `src/app/(app)/admin/actions.ts` | **New.** Clear and suspend, through the RPC. |
| `scripts/probe-vetting.mjs` | **New.** Proves against production that an unvetted teacher is not returned. |

---

### Task 1: The schema

**Files:**
- Move: `supabase/migrations-deferred/0006_roles_admin.sql` → `supabase/migrations/`
- Create: `supabase/migrations/0020_teacher_vetting.sql`

**Interfaces:**
- Produces: `profiles.vetting_state`, `profiles.vetted_at`, `profiles.vetted_by`, `profiles.vetting_note`; `available_teachers` filtered to `cleared`; `set_vetting_state(uuid, text, text)` RPC executable by `authenticated` and authorised inside the function to admins only.

**Why `0006` is activated here.** It widens `profiles.role` to allow `admin`. It has sat deferred because there was no admin to use it (`project_state.md`); this plan creates one, so its precondition is now met.

- [ ] **Step 1: Activate the admin role migration**

```bash
git mv supabase/migrations-deferred/0006_roles_admin.sql supabase/migrations/
```

Do not edit the file. Its contents are already reviewed.

- [ ] **Step 2: Write `supabase/migrations/0020_teacher_vetting.sql`**

```sql
-- Spec §10, §13. Adults meeting children one to one on video is the highest-risk
-- configuration in this product, and until now canBecomeTeacher checked only
-- that an account had no history.
--
-- What is recorded: that a check happened, by whom, and when. NOT the document.
-- Keeping a library of teachers' ID scans creates for teachers exactly the
-- honeypot §5.1 refuses to create for students.

alter table public.profiles
  add column if not exists vetting_state text not null default 'unvetted',
  add column if not exists vetted_at     timestamptz,
  add column if not exists vetted_by     uuid references public.profiles (id),
  add column if not exists vetting_note  text;

alter table public.profiles drop constraint if exists profiles_vetting_state_check;
alter table public.profiles add constraint profiles_vetting_state_check
  check (vetting_state in ('unvetted', 'cleared', 'suspended', 'removed'));

-- The waiting list is read by state; every other read is by id.
create index if not exists profiles_vetting_state_idx
  on public.profiles (vetting_state) where role = 'teacher';

-- The gate. available_teachers is the ONE published roster read — the student
-- list, the push dispatch and the session guard all consume it — so one added
-- predicate closes every path at once.
--
-- The body below is 0010's, unchanged except for the vetting_state line. If you
-- are changing this function for another reason, change 0010's copy of the
-- reasoning too.
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
    and p.vetting_state = 'cleared'
    and a.declared
    and a.declared_until > now()
    and exists (
      select 1 from public.teacher_subjects s
      where s.teacher_id = p.id
        and (coalesce(p_curriculum, '') = '' or s.curriculum = p_curriculum)
        and (coalesce(p_grade, '')      = '' or s.grade      = p_grade)
        and (coalesce(p_stream, '')     = '' or s.stream     = p_stream)
        and (coalesce(p_subject, '')    = '' or s.subject    = p_subject)
    )
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

-- Clearing is a privileged write, so it goes through a function rather than a
-- policy: 0013's discipline — the rule lives in one place and cannot be
-- forgotten by a future write path. The caller's identity is taken from
-- auth.uid(), never from an argument, so an admin cannot be impersonated by
-- passing someone else's id.
create or replace function public.set_vetting_state(
  p_teacher_id uuid,
  p_state      text,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_actor and role = 'admin'
  ) then
    raise exception 'not an admin';
  end if;

  if p_state not in ('unvetted', 'cleared', 'suspended', 'removed') then
    raise exception 'invalid vetting state: %', p_state;
  end if;

  update public.profiles
     set vetting_state = p_state,
         -- vetted_at records when the CHECK happened, so it is stamped only on
         -- the transition that means "a person looked": clearing.
         vetted_at    = case when p_state = 'cleared' then now() else vetted_at end,
         vetted_by    = v_actor,
         vetting_note = p_note
   where id = p_teacher_id
     and role = 'teacher';

  if not found then
    raise exception 'no teacher with id %', p_teacher_id;
  end if;
end;
$$;

revoke all on function public.set_vetting_state(uuid, text, text) from public;
grant execute on function public.set_vetting_state(uuid, text, text) to authenticated;
```

- [ ] **Step 3: Confirm what will be applied — do not apply it**

```bash
supabase migration list
```

Expected: `0006` and `0020` show in the LOCAL column with an empty REMOTE. Every other row shows LOCAL == REMOTE.

- [ ] **Step 4: STOP. Hand the migration to a human.**

Applying DDL is blocked inside Claude Code by the permission classifier, deliberately. Report to your human partner:

> `0006` and `0020` are staged and verified. Please run `supabase db push`, then tell me the result. I cannot apply DDL.

Do not continue to Task 2 until they confirm. Tasks 2 and 3 are pure TypeScript and do not need the schema, so they may proceed in parallel if the human prefers — but Task 6's probe cannot pass until this is live.

- [ ] **Step 5: After the human confirms, verify against production**

```bash
supabase db query --linked "select column_name from information_schema.columns where table_name='profiles' and column_name like 'vet%' order by column_name;"
supabase db query --linked "select conname from pg_constraint where conname in ('profiles_role_check','profiles_vetting_state_check');"
```

Expected: four `vet%` columns; both constraints present.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0006_roles_admin.sql supabase/migrations/0020_teacher_vetting.sql
git commit -m "feat(db): teacher vetting state, and available_teachers gates on it"
```

---

### Task 2: The vetting rules, as pure functions

**Files:**
- Create: `src/lib/vetting.ts`, `src/lib/vetting.test.ts`

**Interfaces:**
- Produces: `VETTING_STATES`, `type VettingState`, `isVettingState(x): x is VettingState`, `canBePicked(state): boolean`, `vettingMessage(state): { title: string; body: string } | null`. Tasks 4 and 5 consume all of them.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import {
  VETTING_STATES,
  isVettingState,
  canBePicked,
  vettingMessage,
} from "./vetting";

describe("VETTING_STATES", () => {
  // Spec §13 fixes these four. The DB CHECK constraint carries the same list —
  // if this test and 0020 disagree, one of them is wrong.
  it("is exactly the four states the migration allows", () => {
    expect([...VETTING_STATES]).toEqual(["unvetted", "cleared", "suspended", "removed"]);
  });
});

describe("isVettingState", () => {
  it("accepts every legal state", () => {
    for (const s of VETTING_STATES) expect(isVettingState(s)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isVettingState("approved")).toBe(false);
    expect(isVettingState("")).toBe(false);
    expect(isVettingState("CLEARED")).toBe(false);
  });
});

describe("canBePicked", () => {
  // The whole safety property in one line: only a cleared teacher meets a child.
  it("is true only for cleared", () => {
    expect(canBePicked("cleared")).toBe(true);
    expect(canBePicked("unvetted")).toBe(false);
    expect(canBePicked("suspended")).toBe(false);
    expect(canBePicked("removed")).toBe(false);
  });
});

describe("vettingMessage", () => {
  // A teacher who declared availability and sees no requests must be told why,
  // or they conclude the product is broken and leave.
  it("explains the wait to an unvetted teacher", () => {
    expect(vettingMessage("unvetted")).toMatchObject({
      title: expect.stringMatching(/review/i),
    });
  });

  it("tells a suspended teacher to expect contact", () => {
    expect(vettingMessage("suspended")?.body).toMatch(/contact/i);
  });

  it("says nothing to a cleared teacher", () => {
    expect(vettingMessage("cleared")).toBeNull();
  });

  it("has a message for every non-cleared state", () => {
    for (const s of VETTING_STATES) {
      if (s === "cleared") continue;
      expect(vettingMessage(s), s).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/vetting.test.ts`
Expected: FAIL — cannot resolve `./vetting`.

- [ ] **Step 3: Implement**

```typescript
// Spec §10. The states are duplicated in 0020's CHECK constraint, deliberately:
// the database must refuse a bad value even if a future write path forgets to
// ask this module. If you add a state, add it in both places.

export const VETTING_STATES = ["unvetted", "cleared", "suspended", "removed"] as const;

export type VettingState = (typeof VETTING_STATES)[number];

export function isVettingState(x: string): x is VettingState {
  return (VETTING_STATES as readonly string[]).includes(x);
}

/**
 * The safety property, in one place. available_teachers enforces the same rule
 * in SQL — this is for surfaces that hold a profile in hand and must not wait
 * for a round trip.
 */
export function canBePicked(state: VettingState): boolean {
  return state === "cleared";
}

/**
 * What a teacher is told. A teacher who has declared availability and receives
 * nothing must learn why here, or they conclude the product is broken.
 */
export function vettingMessage(
  state: VettingState
): { title: string; body: string } | null {
  switch (state) {
    case "cleared":
      return null;
    case "unvetted":
      return {
        title: "Your account is under review",
        body: "We check every teacher's ID against their account before they can take a lesson. You can finish your profile now — students will see you once the check is done.",
      };
    case "suspended":
      return {
        title: "Your account is paused",
        body: "You are not visible to students while we look into a report. Someone will contact you about it.",
      };
    case "removed":
      return {
        title: "Your account has been closed",
        body: "You cannot take lessons on SMB Tutorials. Contact us if you believe this is a mistake.",
      };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/vetting.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add src/lib/vetting.ts src/lib/vetting.test.ts
git commit -m "feat(vetting): the four states, and the one rule that gates a lesson"
```

---

### Task 3: Alert the operator when an application lands

**Files:**
- Modify: `src/lib/notifications/payload.ts`, `src/lib/notifications/dispatch.ts`, `src/app/(marketing)/tutor-signup/actions.ts`

**Interfaces:**
- Consumes: `getNotificationPort`, `createDispatchClient`, and the `NotificationPayload` shape from `src/lib/notifications/port.ts`.
- Produces: `APPLICATION_TAG`, `applicationPayload(name, subjectCount)`, `notifyAdminsOfApplication(teacherId, name, subjectCount)`.

**Why push and not WhatsApp or email.** WhatsApp business-initiated messages need a provider plus Meta verification and an approved template. No email transport exists in this project at all. Web push is built, hardened and proven — a locked iPhone at three seconds — and `port.ts` is the seam a WhatsApp adapter drops into later with no caller change.

**An admin can hold a device with no migration.** `teacher_devices.teacher_id` references `profiles(id)` with no role constraint, and its RLS is `auth.uid() = teacher_id`. The column name is historical.

- [ ] **Step 1: Add the payload**

In `src/lib/notifications/payload.ts`, beside `REQUEST_TAG`:

```typescript
// A fixed tag per kind, so a second application replaces the first rather than
// stacking — the same rule REQUEST_TAG follows.
export const APPLICATION_TAG = "teacher-application";

export function applicationPayload(
  name: string,
  subjectCount: number
): NotificationPayload {
  return {
    title: "New teacher application",
    body: `${name} applied to teach ${subjectCount} subject${subjectCount === 1 ? "" : "s"}.`,
    url: "/admin",
    tag: APPLICATION_TAG,
  };
}
```

If `NotificationPayload` is not already imported in that file, add `import type { NotificationPayload } from "./port";`.

- [ ] **Step 2: Add the dispatch**

In `src/lib/notifications/dispatch.ts`, after `notifyTeacherOfRequest`:

```typescript
/**
 * Tell every admin that someone applied. Best-effort by design: a failure here
 * must never cost a teacher their signup, which is why the caller does not
 * await the result on the critical path.
 */
export async function notifyAdminsOfApplication(
  teacherId: string,
  name: string,
  subjectCount: number
): Promise<void> {
  const supabase = createDispatchClient();

  const { data: admins, error: adminError } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin");

  if (adminError || !admins?.length) {
    console.error("[notify-admins] no admin to notify", adminError);
    return;
  }

  const { data: devices, error: deviceError } = await supabase
    .from("teacher_devices")
    .select("id, endpoint, p256dh, auth")
    .in("teacher_id", admins.map((a) => a.id));

  if (deviceError || !devices?.length) {
    console.error("[notify-admins] no admin device registered", deviceError);
    return;
  }

  const port = getNotificationPort();
  const payload = applicationPayload(name, subjectCount);

  await Promise.all(
    devices.map(async (d) => {
      const result = await port.send(
        { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth },
        payload
      );
      if (!result.ok && result.gone) {
        await supabase.from("teacher_devices").delete().eq("id", d.id);
      }
    })
  );
}
```

Add `applicationPayload` to the existing `./index` import at the top of the file.

- [ ] **Step 3: Call it from signup**

In `src/app/(marketing)/tutor-signup/actions.ts`, immediately before the existing `redirect("/setup")` at line 168:

```typescript
  // Best effort, and deliberately not awaited into the failure path: an
  // operator who misses one alert can read /admin, but a teacher who cannot
  // sign up because a push service was down has lost something real.
  try {
    await notifyAdminsOfApplication(teacherId, v.fullName, v.subjects.length);
  } catch (e) {
    console.error("[tutor-signup] admin notification failed", e);
  }
```

Add `import { notifyAdminsOfApplication } from "@/lib/notifications/dispatch";` at the top.

**`redirect()` throws by design in Next** — it signals navigation by throwing. The `try` above must wrap ONLY the notification call, never the redirect, or signup will appear to fail.

- [ ] **Step 4: Verify signup still completes when notification fails**

Run: `npx vitest run src/app/\(marketing\)/tutor-signup/actions.test.ts`
Expected: PASS. The existing tests do not mock the new import, so a resolution failure here means the import path is wrong.

- [ ] **Step 5: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add src/lib/notifications/payload.ts src/lib/notifications/dispatch.ts "src/app/(marketing)/tutor-signup/actions.ts"
git commit -m "feat(vetting): the operator is pushed the moment a teacher applies"
```

---

### Task 4: Tell the teacher why they are not listed

**Files:**
- Create: `src/components/vetting-banner.tsx`
- Modify: `src/lib/auth.ts`, `src/app/(app)/(teacher)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `vettingMessage`, `VettingState` (Task 2).
- Produces: `<VettingBanner state={…} />`; `Identity.vettingState`.

- [ ] **Step 1: Carry the state on `Identity`**

In `src/lib/auth.ts`, add `vettingState: VettingState` to the `Identity` interface, add `vetting_state` to the profile `select(...)` list, and map it through with a defensive default:

```typescript
    vettingState: isVettingState(row.vetting_state) ? row.vetting_state : "unvetted",
```

Defaulting to `unvetted` rather than `cleared` matters: an unreadable or unexpected value must fail closed, never open.

- [ ] **Step 2: Create the banner**

```tsx
import { vettingMessage, type VettingState } from "@/lib/vetting";

export function VettingBanner({ state }: { state: VettingState }) {
  const message = vettingMessage(state);
  if (!message) return null;

  return (
    <div className="mx-auto mb-6 max-w-3xl rounded-md border border-border bg-card p-4">
      <p className="mb-1 font-semibold">{message.title}</p>
      <p className="text-sm text-muted-foreground">{message.body}</p>
    </div>
  );
}
```

- [ ] **Step 3: Render it on the teacher dashboard**

Import `VettingBanner` in `src/app/(app)/(teacher)/dashboard/page.tsx` and render `<VettingBanner state={identity.vettingState} />` as the first child of the page's main content, above the availability control. Above, because a teacher toggling availability with no idea they are invisible is the exact confusion this banner exists to prevent.

- [ ] **Step 4: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add src/components/vetting-banner.tsx src/lib/auth.ts "src/app/(app)/(teacher)/dashboard/page.tsx"
git commit -m "feat(vetting): an unvetted teacher learns why no requests arrive"
```

---

### Task 5: The operator's page

**Files:**
- Create: `src/app/(app)/admin/page.tsx`, `src/app/(app)/admin/actions.ts`

**Interfaces:**
- Consumes: `set_vetting_state` RPC (Task 1), `VETTING_STATES` (Task 2), `getIdentity` (`src/lib/auth.ts`).

The minimum that makes the gate operable. Spec §12 says that until a real admin surface exists the operator acts in SQL — this replaces that with a list, because a same-day gate nobody can open is a gate that gets bypassed.

- [ ] **Step 1: The server actions**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/auth";
import { isVettingState } from "@/lib/vetting";

export async function setVettingState(formData: FormData) {
  // Checked here AND in the RPC. The RPC is the real boundary — this is the
  // fast, legible refusal, not the security control.
  const identity = await getIdentity();
  if (identity?.role !== "admin") throw new Error("not an admin");

  const teacherId = String(formData.get("teacherId") ?? "");
  const state = String(formData.get("state") ?? "");
  const note = String(formData.get("note") ?? "") || null;

  if (!isVettingState(state)) throw new Error(`invalid state: ${state}`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_vetting_state", {
    p_teacher_id: teacherId,
    p_state: state,
    p_note: note,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
}
```

Match the `createClient` import to whatever `src/lib/supabase/server.ts` actually exports — check it rather than assuming, and follow the pattern the other server actions in this repo use.

- [ ] **Step 2: The page**

```tsx
import { notFound } from "next/navigation";
import { getIdentity } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { setVettingState } from "./actions";

export default async function AdminPage() {
  const identity = await getIdentity();
  // notFound rather than a redirect: a non-admin should not learn this route
  // exists.
  if (identity?.role !== "admin") notFound();

  const supabase = await createClient();
  const { data: teachers } = await supabase
    .from("profiles")
    .select("id, full_name, phone, demo_video_url, vetting_state, created_at")
    .eq("role", "teacher")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-black tracking-tight">Teachers</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Check the ID against the name on the account, watch the demo, then clear them.
        Never save the document.
      </p>

      <ul className="divide-y divide-border border-y border-border">
        {(teachers ?? []).map((t) => (
          <li key={t.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="font-semibold">
                {t.full_name}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  {t.vetting_state}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                {t.demo_video_url ? (
                  <a href={t.demo_video_url} target="_blank" rel="noopener noreferrer" className="underline">
                    Demo video
                  </a>
                ) : (
                  "No demo video"
                )}
                {t.phone ? (
                  <>
                    {" · "}
                    {/* Opens a chat so the operator can ask for the ID. Ask for
                        it as view-once, and delete it after checking: WhatsApp
                        history and phone backups are the same honeypot §10
                        refuses to build in the database. */}
                    <a
                      href={`https://wa.me/91${t.phone.replace(/\D/g, "").slice(-10)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      WhatsApp
                    </a>
                  </>
                ) : null}
              </p>
            </div>

            <form action={setVettingState} className="flex gap-2">
              <input type="hidden" name="teacherId" value={t.id} />
              <button
                name="state"
                value="cleared"
                className="rounded-sm bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
              >
                Clear
              </button>
              <button
                name="state"
                value="suspended"
                className="rounded-sm border border-border px-3 py-1.5 text-sm"
              >
                Suspend
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Confirm the route is not reachable by a non-admin**

Run `npm run dev`, sign in as a teacher or student, and load `/admin`.
Expected: 404. If the page renders, stop — the guard is the whole point of the task.

- [ ] **Step 4: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add "src/app/(app)/admin/page.tsx" "src/app/(app)/admin/actions.ts"
git commit -m "feat(vetting): the operator can see who is waiting and clear them"
```

---

### Task 6: Prove the gate against production

**Files:**
- Create: `scripts/probe-vetting.mjs`

Follow the conventions of the existing probes in `scripts/` — read `scripts/probe-role-guard.mjs` first and match how it loads env, mints throwaway accounts, and reports. The existing probes exit 0 on success and print each assertion.

- [ ] **Step 1: Write the probe**

It must assert, against the live database:

1. A freshly created teacher has `vetting_state = 'unvetted'`.
2. That teacher, with a declared availability lease and a matching subject, is **NOT** returned by `available_teachers` — the assertion the whole plan exists for.
3. After `set_vetting_state(id, 'cleared')` is applied by an admin, the same teacher **IS** returned.
4. `set_vetting_state` called by a non-admin raises, and does not change the row.
5. `profiles.vetting_state` cannot be set directly by the teacher themselves — the same class of hole `0013` closed for `role`.

Clean up every account it mints, the way the existing probes do.

- [ ] **Step 2: Run it**

```bash
node scripts/probe-vetting.mjs
```

Expected: exit 0, every assertion printed green. **Assertion 2 is the one that matters** — if it fails, an unvetted teacher is reachable by a child, and nothing else in this plan is worth shipping.

- [ ] **Step 3: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add scripts/probe-vetting.mjs
git commit -m "test(vetting): prove an unvetted teacher is unreachable in production"
```

---

## Done when

- [ ] `0006` and `0020` show LOCAL == REMOTE in `supabase migration list`.
- [ ] A new teacher signup lands with `vetting_state = 'unvetted'`.
- [ ] `available_teachers` returns no unvetted, suspended or removed teacher — proven by `probe-vetting.mjs`, not assumed.
- [ ] An unvetted teacher sees the banner on their dashboard and can still complete their profile.
- [ ] The operator receives a push within seconds of an application, and `/admin` lists the applicant with their demo video.
- [ ] `/admin` 404s for a student and for a teacher.
- [ ] `npx vitest run` (321+ passing), `tsc --noEmit` 0, `eslint .` 0, `npm run build` 0.

## Owed after this ships

- **The Tutor Agreement.** Spec §10 makes it one of the three gates. It does not exist. Until it does, "cleared" means ID plus demo video only — record that honestly rather than implying a signature nobody collected.
- **`0021`** — conduct-report auto-suspend and `report_reviews`. Spec §12.
- **A WhatsApp adapter** behind `notifications/port.ts`, once a provider account and Meta template approval exist.
