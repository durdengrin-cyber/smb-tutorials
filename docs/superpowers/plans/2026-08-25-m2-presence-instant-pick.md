# M2 — Presence + Instant Pick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teacher toggles "Available now", a student sees who is online for their subject, picks one, the teacher accepts within 30 seconds, and both land in a 60-minute video call.

**Architecture:** Presence lives on one Supabase Realtime channel (`teachers-online`); the database answers *what* a teacher teaches and presence answers *whether they are here now*. The request/accept handshake rides Postgres Changes on a durable `sessions` row, because nothing here is always-on — deadlines and completion are enforced opportunistically in three places rather than by a cron. On accept, a Server Action mints a private Daily room plus per-user meeting tokens.

**Tech Stack:** Next.js 16.3.2 (App Router, `src/proxy.ts` not `middleware.ts`), React 19, Tailwind v4, Supabase (Postgres + RLS + Realtime), `@daily-co/daily-js`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-m2-presence-instant-pick-design.md` (parent: `2026-08-24-smb-tutorials-design.md`)

## Global Constraints

- **Next.js 16 breaking changes** — read `node_modules/next/dist/docs/` before writing app code. Already learned the hard way in M1: `middleware.ts` → `proxy.ts`; page `searchParams`/`params` are **Promises**; a `"use server"` file may export **only async functions** (shared types live in `src/lib/form-state.ts`); Supabase `.select()` must be a **single string literal** or type inference collapses to `GenericStringError` (use `.returns<T[]>()`).
- **Serverless only** — no always-on process. No cron, no timers on a server. Anything time-based is enforced on read (see Task 1).
- **Secrets** in `.env.local` + Vercel env vars, never committed. `DAILY_API_KEY` is server-only — never referenced from a Client Component.
- **Vercel** — `vercel.json` pins `{"framework": "nextjs"}`. Do not remove it; without it Vercel serves platform 404s while reporting a successful build.
- Sync before every push: `git fetch origin main` then rebase. Confirm branch with `git branch --show-current`.
- **Visual language** (parent spec §13): teal→cyan gradients (`from-teal-500 to-cyan-600`), `₹{rate}/hr`, "One Student, One Teacher". Reuse `SiteHeader` from `src/components/site-header.tsx` — it is a plain component, renderable from Server *and* Client Components.
- **Copy, exact:** CTA is **"Start now →"** (never "Book Now"). Teacher prompt: **"New student request — {student} wants {subject} now, ₹{rate}/hr"**. Student waiting: **"Asking {teacher}…"**. Return-to-list highlight: **"{teacher} didn't respond — these teachers are free now"**.
- **Accept window 30s; session duration 60 min.** Both are constants in `src/lib/session.ts` — never inline the numbers.
- **No fabricated data.** Earnings are derived from completed sessions only, labelled *pending payout*; ₹0 when there are none. (M1 precedent: teacher cards show no invented rating or availability.)
- Every task ends with `npm run test` green and a commit.

## File Structure

```
supabase/migrations/0002_sessions.sql        -- sessions table, RLS, realtime publication
src/lib/session.ts                            -- pure: deadlines, transitions, remaining time (tested)
src/lib/session.test.ts
src/lib/presence.ts                           -- pure: roster shape + online∩eligible (tested)
src/lib/presence.test.ts
src/lib/daily.ts                              -- MODIFY: private rooms + meeting tokens
src/lib/daily.test.ts                         -- MODIFY: extend
src/app/teachers/page.tsx                     -- MODIFY: hand eligible teachers to the live list
src/app/teachers/online-list.tsx              -- client: presence roster + "Start now →"
src/app/teachers/actions.ts                   -- requestSession Server Action
src/app/waiting/[sessionId]/page.tsx          -- server shell
src/app/waiting/[sessionId]/waiting-client.tsx -- client: countdown + session subscription + Cancel
src/app/dashboard/page.tsx                    -- server shell: teacher-only
src/app/dashboard/availability-toggle.tsx     -- client: presence track/untrack
src/app/dashboard/incoming-request.tsx        -- client: subscribe to own sessions, Accept/Decline
src/app/dashboard/session-history.tsx         -- server: history table + pending-payout earnings
src/app/dashboard/actions.ts                  -- acceptSession / declineSession
src/app/call/[sessionId]/page.tsx             -- server: authorize participant, pass room + token
src/app/call/[sessionId]/call-frame.tsx       -- client: Daily frame + countdown + completion
src/app/session/actions.ts                    -- completeSession / cancelSession (shared)
DELETE (Task 11): src/app/call/page.tsx · src/app/api/rooms/route.ts · src/lib/share.ts · src/lib/share.test.ts
```

**Two rules that repeat from M1:** interactive screens are a Server Component page (awaits `params`, does the auth check) wrapping a Client Component; and `SiteHeader` is plain so either can render it.

---

### Task 0: Prerequisites — none

M2 needs **no manual dashboard steps**. Realtime is enabled by SQL in Task 3, and `DAILY_API_KEY` is already set locally and in Vercel across all three environments. Begin at Task 1.

*(Unrelated to M2 but still open from M1: Google OAuth is not enabled in Supabase, and `https://smb-tutorials.vercel.app/auth/callback` is not in its redirect list. Neither blocks anything here.)*

---

### Task 1: Session logic (pure, no I/O)

**Files:**
- Create: `src/lib/session.ts`
- Test: `src/lib/session.test.ts`

**Interfaces:**
- Produces, used by Tasks 3, 5, 7, 8, 9, 10:
  - `ACCEPT_WINDOW_SECONDS = 30`, `SESSION_DURATION_MINUTES = 60`
  - `type SessionStatus = "pending" | "accepted" | "active" | "completed" | "declined" | "timed_out" | "cancelled"`
  - `acceptDeadlineFrom(createdAt: Date): Date`
  - `effectiveStatus(row: { status: SessionStatus; accept_deadline: string | null; started_at: string | null; duration_minutes: number }, now: Date): SessionStatus`
  - `secondsRemaining(deadline: string | Date, now: Date): number`
  - `canTransition(from: SessionStatus, to: SessionStatus): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/session.test.ts
import { describe, it, expect } from "vitest";
import {
  ACCEPT_WINDOW_SECONDS, SESSION_DURATION_MINUTES,
  acceptDeadlineFrom, effectiveStatus, secondsRemaining, canTransition,
} from "./session";

const iso = (d: Date) => d.toISOString();
const NOW = new Date("2026-08-25T12:00:00.000Z");

describe("constants", () => {
  it("matches the spec", () => {
    expect(ACCEPT_WINDOW_SECONDS).toBe(30);
    expect(SESSION_DURATION_MINUTES).toBe(60);
  });
});

describe("acceptDeadlineFrom", () => {
  it("is 30 seconds after creation", () => {
    expect(acceptDeadlineFrom(NOW).toISOString()).toBe("2026-08-25T12:00:30.000Z");
  });
});

describe("secondsRemaining", () => {
  it("counts down and never goes negative", () => {
    expect(secondsRemaining("2026-08-25T12:00:30.000Z", NOW)).toBe(30);
    expect(secondsRemaining("2026-08-25T11:59:00.000Z", NOW)).toBe(0);
  });
});

describe("effectiveStatus", () => {
  const base = { started_at: null, duration_minutes: 60 };

  it("leaves a live pending request pending", () => {
    expect(effectiveStatus(
      { ...base, status: "pending", accept_deadline: "2026-08-25T12:00:10.000Z" }, NOW
    )).toBe("pending");
  });

  it("treats an expired pending request as timed out", () => {
    expect(effectiveStatus(
      { ...base, status: "pending", accept_deadline: "2026-08-25T11:59:59.000Z" }, NOW
    )).toBe("timed_out");
  });

  it("treats an active session past its hour as completed", () => {
    expect(effectiveStatus(
      { status: "active", accept_deadline: null,
        started_at: "2026-08-25T10:59:00.000Z", duration_minutes: 60 }, NOW
    )).toBe("completed");
  });

  it("leaves an active session inside its hour active", () => {
    expect(effectiveStatus(
      { status: "active", accept_deadline: null,
        started_at: "2026-08-25T11:30:00.000Z", duration_minutes: 60 }, NOW
    )).toBe("active");
  });

  it("never rewrites a terminal status", () => {
    for (const s of ["completed", "declined", "timed_out", "cancelled"] as const) {
      expect(effectiveStatus(
        { ...base, status: s, accept_deadline: "2026-08-25T11:00:00.000Z" }, NOW
      )).toBe(s);
    }
  });
});

describe("canTransition", () => {
  it("allows the real paths", () => {
    expect(canTransition("pending", "active")).toBe(true);
    expect(canTransition("pending", "declined")).toBe(true);
    expect(canTransition("pending", "timed_out")).toBe(true);
    expect(canTransition("pending", "cancelled")).toBe(true);
    expect(canTransition("active", "completed")).toBe(true);
  });
  it("refuses resurrection and skipping", () => {
    expect(canTransition("completed", "active")).toBe(false);
    expect(canTransition("timed_out", "active")).toBe(false);
    expect(canTransition("declined", "active")).toBe(false);
    expect(canTransition("pending", "completed")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm run test -- src/lib/session.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement**

```ts
// src/lib/session.ts
// Pure session rules. Nothing here touches the network — the same functions
// run in Server Actions, Server Components and the browser, which is what
// lets a serverless stack enforce deadlines without a cron.

export const ACCEPT_WINDOW_SECONDS = 30;
export const SESSION_DURATION_MINUTES = 60;

export type SessionStatus =
  | "pending" | "accepted" | "active"
  | "completed" | "declined" | "timed_out" | "cancelled";

const TERMINAL: readonly SessionStatus[] = [
  "completed", "declined", "timed_out", "cancelled",
];

const ALLOWED: Record<SessionStatus, readonly SessionStatus[]> = {
  pending: ["active", "accepted", "declined", "timed_out", "cancelled"],
  accepted: ["active", "cancelled"], // reserved for M3, where payment sits here
  active: ["completed"],
  completed: [],
  declined: [],
  timed_out: [],
  cancelled: [],
};

export function acceptDeadlineFrom(createdAt: Date): Date {
  return new Date(createdAt.getTime() + ACCEPT_WINDOW_SECONDS * 1000);
}

export function secondsRemaining(deadline: string | Date, now: Date): number {
  const end = typeof deadline === "string" ? new Date(deadline) : deadline;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 1000));
}

// The single source of truth for "what is this row really?". A pending row
// past its deadline is timed out and an active row past its hour is complete,
// whatever the stored column says — this is what stops a stale row from being
// accepted later, or a teacher from being stuck out of the online list.
export function effectiveStatus(
  row: {
    status: SessionStatus;
    accept_deadline: string | null;
    started_at: string | null;
    duration_minutes: number;
  },
  now: Date
): SessionStatus {
  if (TERMINAL.includes(row.status)) return row.status;

  if (row.status === "pending" && row.accept_deadline) {
    if (secondsRemaining(row.accept_deadline, now) === 0) return "timed_out";
  }

  if (row.status === "active" && row.started_at) {
    const endsAt =
      new Date(row.started_at).getTime() + row.duration_minutes * 60_000;
    if (now.getTime() >= endsAt) return "completed";
  }

  return row.status;
}

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return ALLOWED[from].includes(to);
}
```

- [ ] **Step 4: Run to verify PASS** — `npm run test -- src/lib/session.test.ts` → PASS, then full `npm run test`.
- [ ] **Step 5: Commit** — `git add src/lib/session.ts src/lib/session.test.ts && git commit -m "feat: pure session rules — deadlines, effective status, transitions"`

---

### Task 2: Presence helpers (pure, no I/O)

**Files:**
- Create: `src/lib/presence.ts`
- Test: `src/lib/presence.test.ts`

**Interfaces:**
- Produces, used by Tasks 6 and 8:
  - `PRESENCE_CHANNEL = "teachers-online"`
  - `interface OnlineTeacher { teacher_id: string; full_name: string; hourly_rate: number }`
  - `rosterFromPresenceState(state: Record<string, OnlineTeacher[]>): OnlineTeacher[]`
  - `intersectOnline<T extends { id: string }>(eligible: T[], roster: OnlineTeacher[]): T[]`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/presence.test.ts
import { describe, it, expect } from "vitest";
import { PRESENCE_CHANNEL, rosterFromPresenceState, intersectOnline } from "./presence";

const a = { teacher_id: "t1", full_name: "Dr. Rao", hourly_rate: 500 };
const b = { teacher_id: "t2", full_name: "Ms. Iyer", hourly_rate: 400 };

describe("presence", () => {
  it("names the shared channel", () => {
    expect(PRESENCE_CHANNEL).toBe("teachers-online");
  });

  it("flattens Supabase's keyed presence state", () => {
    expect(rosterFromPresenceState({ t1: [a], t2: [b] })).toEqual([a, b]);
  });

  it("dedupes a teacher present from two tabs", () => {
    expect(rosterFromPresenceState({ t1: [a, a] })).toEqual([a]);
  });

  it("ignores malformed entries rather than crashing the list", () => {
    const state = { t1: [a], bad: [{ full_name: "no id" }] } as never;
    expect(rosterFromPresenceState(state)).toEqual([a]);
  });

  it("keeps only eligible teachers who are online, preserving eligible order", () => {
    const eligible = [{ id: "t2" }, { id: "t1" }, { id: "t3" }];
    expect(intersectOnline(eligible, [a, b])).toEqual([{ id: "t2" }, { id: "t1" }]);
  });

  it("returns nothing when nobody is online", () => {
    expect(intersectOnline([{ id: "t1" }], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm run test -- src/lib/presence.test.ts`.
- [ ] **Step 3: Implement**

```ts
// src/lib/presence.ts
// Presence answers "who is here right now"; the database answers "who teaches
// this". Keeping them separate is why one channel serves every subject
// combination instead of one channel per taxonomy tuple.

export const PRESENCE_CHANNEL = "teachers-online";

export interface OnlineTeacher {
  teacher_id: string;
  full_name: string;
  hourly_rate: number;
}

const isOnlineTeacher = (v: unknown): v is OnlineTeacher =>
  !!v && typeof (v as OnlineTeacher).teacher_id === "string";

// Supabase keys presence state by presence key, with an array per key (one
// entry per open tab).
export function rosterFromPresenceState(
  state: Record<string, OnlineTeacher[]>
): OnlineTeacher[] {
  const seen = new Set<string>();
  const roster: OnlineTeacher[] = [];
  for (const entries of Object.values(state ?? {})) {
    for (const entry of entries ?? []) {
      if (!isOnlineTeacher(entry) || seen.has(entry.teacher_id)) continue;
      seen.add(entry.teacher_id);
      roster.push(entry);
    }
  }
  return roster;
}

export function intersectOnline<T extends { id: string }>(
  eligible: T[],
  roster: OnlineTeacher[]
): T[] {
  const online = new Set(roster.map((r) => r.teacher_id));
  return eligible.filter((e) => online.has(e.id));
}
```

- [ ] **Step 4: Run to verify PASS**, then full `npm run test`.
- [ ] **Step 5: Commit** — `git add src/lib/presence.ts src/lib/presence.test.ts && git commit -m "feat: presence roster helpers"`

---

### Task 3: `sessions` table, RLS, realtime publication

**Files:**
- Create: `supabase/migrations/0002_sessions.sql`

**Interfaces:**
- Produces the `public.sessions` table every later task reads and writes, and adds it to the `supabase_realtime` publication so Postgres Changes subscriptions work.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0002_sessions.sql
-- M2 sessions (design spec §4). Status values mirror src/lib/session.ts.

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  curriculum text not null check (curriculum in ('CBSE', 'State Board', 'ICSE')),
  grade text not null check (grade in ('6th','7th','8th','9th','10th','11th','12th')),
  stream text not null check (stream in ('Science', 'Commerce', 'Arts')),
  subject text not null,
  type text not null default 'instant' check (type in ('instant', 'request', 'scheduled')),
  status text not null default 'pending'
    check (status in ('pending','accepted','active','completed','declined','timed_out','cancelled')),
  accept_deadline timestamptz,
  duration_minutes int not null default 60 check (duration_minutes > 0),
  started_at timestamptz,
  -- Snapshot, not a join: a teacher changing their rate must not alter what a
  -- past session cost.
  hourly_rate int not null check (hourly_rate > 0),
  daily_room_url text,
  created_at timestamptz not null default now(),
  constraint different_parties check (student_id <> teacher_id),
  -- effectiveStatus() can only expire a pending row that carries a deadline.
  -- Without this, a null-deadline pending row would never time out and could
  -- be accepted arbitrarily later — the exact failure the read-time rule exists
  -- to prevent.
  constraint pending_has_deadline
    check (status <> 'pending' or accept_deadline is not null)
);

create index sessions_teacher_status_idx on public.sessions (teacher_id, status);
create index sessions_student_status_idx on public.sessions (student_id, status);

alter table public.sessions enable row level security;

-- A session is visible only to its two participants.
create policy "participants read own sessions" on public.sessions
  for select using (
    student_id = (select auth.uid()) or teacher_id = (select auth.uid())
  );

-- Only the student creates the request, only for themselves.
create policy "student creates own session" on public.sessions
  for insert with check (student_id = (select auth.uid()));

-- Either participant may update; which transitions are legal is enforced in
-- the Server Actions (they hold the state machine).
create policy "participants update own sessions" on public.sessions
  for update using (
    student_id = (select auth.uid()) or teacher_id = (select auth.uid())
  ) with check (
    student_id = (select auth.uid()) or teacher_id = (select auth.uid())
  );

-- Required for postgres_changes subscriptions on this table.
alter publication supabase_realtime add table public.sessions;
-- Realtime sends old-row data for UPDATE/DELETE only with a replica identity.
alter table public.sessions replica identity full;
```

- [ ] **Step 2: Apply it** — copy to clipboard with `pbcopy < supabase/migrations/0002_sessions.sql`, paste into the SQL Editor at `https://supabase.com/dashboard/project/upggvzzzoxqgourjywtd/sql/new`, Run.
- [ ] **Step 3: Verify against the live project** — in the SQL Editor:

```sql
select count(*) from public.sessions;                       -- expect 0, table exists
select polname from pg_policies where tablename = 'sessions';  -- expect 3
select 1 from pg_publication_tables
 where pubname = 'supabase_realtime' and tablename = 'sessions';  -- expect 1 row
-- invalid taxonomy is rejected
insert into public.sessions (student_id, teacher_id, curriculum, grade, stream, subject, hourly_rate)
 values (gen_random_uuid(), gen_random_uuid(), 'IB', '6th', 'Science', 'Physics', 500);
-- a pending row with no accept_deadline is rejected (pending_has_deadline)
insert into public.sessions (student_id, teacher_id, curriculum, grade, stream, subject, hourly_rate, status)
 values (gen_random_uuid(), gen_random_uuid(), 'CBSE', '6th', 'Science', 'Physics', 500, 'pending');
```
Both inserts must fail with a check-constraint violation.

- [ ] **Step 4: Commit** — `git add supabase/migrations/0002_sessions.sql && git commit -m "feat: sessions table, RLS, realtime publication (M2 spec §4)"`

---

### Task 4: Private Daily rooms + per-user meeting tokens

**Files:**
- Modify: `src/lib/daily.ts`
- Test: `src/lib/daily.test.ts` (extend — do not rewrite the existing `getOrCreateRoom` tests)

**Interfaces:**
- Consumes: existing `getOrCreateRoom(name, apiKey, fetchImpl?, ttlSeconds?)` and `interface Room { url: string; name: string }`.
- Produces, used by Task 7 and Task 9:
  - `createSessionRoom(sessionId: string, apiKey: string, fetchImpl?: typeof fetch, ttlSeconds?: number): Promise<Room>` — private room named `smb-{sessionId}`.
  - `createMeetingToken(roomName: string, userName: string, isOwner: boolean, apiKey: string, fetchImpl?: typeof fetch, ttlSeconds?: number): Promise<string>`

- [ ] **Step 1: Write the failing tests** (append to `src/lib/daily.test.ts`)

```ts
import { createSessionRoom, createMeetingToken } from "./daily";

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

describe("createSessionRoom", () => {
  it("creates a PRIVATE room named for the session, with an expiry", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = init;
      return okJson({ url: "https://smbtutorials.daily.co/smb-s1", name: "smb-s1" });
    }) as unknown as typeof fetch;

    const room = await createSessionRoom("s1", "key", fetchImpl, 7200);

    expect(room).toEqual({ url: "https://smbtutorials.daily.co/smb-s1", name: "smb-s1" });
    const body = JSON.parse(String(captured?.body));
    expect(body.name).toBe("smb-s1");
    expect(body.properties.privacy).toBe("private");
    expect(body.properties.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("throws without an API key", async () => {
    await expect(createSessionRoom("s1", "")).rejects.toThrow("DAILY_API_KEY");
  });
});

describe("createMeetingToken", () => {
  it("requests a token scoped to the room and user", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = init;
      return okJson({ token: "tok_abc" });
    }) as unknown as typeof fetch;

    const token = await createMeetingToken("smb-s1", "Asha", false, "key", fetchImpl, 3600);

    expect(token).toBe("tok_abc");
    const body = JSON.parse(String(captured?.body));
    expect(body.properties.room_name).toBe("smb-s1");
    expect(body.properties.user_name).toBe("Asha");
    expect(body.properties.is_owner).toBe(false);
  });

  it("surfaces a Daily failure", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 401, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    await expect(createMeetingToken("r", "u", false, "key", fetchImpl)).rejects.toThrow("401");
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm run test -- src/lib/daily.test.ts`.
- [ ] **Step 3: Implement** (append to `src/lib/daily.ts`, keeping `getOrCreateRoom` untouched)

```ts
export const roomNameForSession = (sessionId: string) => `smb-${sessionId}`;

// Production rooms are private and reached only with a per-user meeting token
// (spec §15). This is the replacement for the M0 spike's open, client-named rooms.
export async function createSessionRoom(
  sessionId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  ttlSeconds: number = 7200
): Promise<Room> {
  if (!apiKey) throw new Error("DAILY_API_KEY is not set");

  const res = await fetchImpl(`${DAILY_API}/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: roomNameForSession(sessionId),
      properties: {
        privacy: "private",
        enable_prejoin_ui: true,
        // Comfortably longer than a 60-minute session so a call cannot die
        // mid-lesson (design spec §9).
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
    }),
  });
  if (!res.ok) throw new Error(`Daily room create failed: ${res.status}`);
  const data = await res.json();
  return { url: data.url, name: data.name };
}

export async function createMeetingToken(
  roomName: string,
  userName: string,
  isOwner: boolean,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  ttlSeconds: number = 7200
): Promise<string> {
  if (!apiKey) throw new Error("DAILY_API_KEY is not set");

  const res = await fetchImpl(`${DAILY_API}/meeting-tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName,
        is_owner: isOwner,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
    }),
  });
  if (!res.ok) throw new Error(`Daily token create failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}
```

- [ ] **Step 4: Run to verify PASS**, then full `npm run test`.
- [ ] **Step 5: Commit** — `git add src/lib/daily.ts src/lib/daily.test.ts && git commit -m "feat: private Daily rooms + per-user meeting tokens"`

---

### Task 5: Teacher dashboard shell + availability toggle

**Files:**
- Create: `src/app/dashboard/page.tsx`, `src/app/dashboard/availability-toggle.tsx`

**Interfaces:**
- Consumes: `PRESENCE_CHANNEL`, `OnlineTeacher` (Task 2); `createClient` from `@/lib/supabase/server` and `@/lib/supabase/client`; `SiteHeader`.
- Produces: `/dashboard`, teacher-only. The toggle publishes presence; Task 7 adds the request prompt to this page and Task 10 adds history.

- [ ] **Step 1: Page shell (server)** — redirects non-teachers, so the dashboard cannot be reached by a student:

```tsx
// src/app/dashboard/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { createClient } from "@/lib/supabase/server";
import { AvailabilityToggle } from "./availability-toggle";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name, hourly_rate")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "teacher") redirect("/");

  const { data: subjects } = await supabase
    .from("teacher_subjects")
    .select("curriculum, grade, stream, subject")
    .eq("teacher_id", user.id);

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader
        action={<Link href="/" className="text-teal-600 hover:text-teal-700 font-medium">← Home</Link>}
      />
      <main className="px-8 py-12">
        <div className="max-w-4xl mx-auto space-y-8">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome, {profile.full_name}
            </h2>
            <p className="text-gray-600">
              Go available to receive instant student requests.
            </p>
          </div>

          <AvailabilityToggle
            teacherId={profile.id}
            fullName={profile.full_name}
            hourlyRate={profile.hourly_rate ?? 0}
          />

          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-bold text-gray-900 mb-3">You&apos;re live for</h3>
            {subjects && subjects.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <li
                    key={`${s.curriculum}|${s.grade}|${s.stream}|${s.subject}`}
                    className="text-sm bg-teal-50 text-teal-700 border border-teal-200 rounded-lg px-3 py-1"
                  >
                    {s.subject} · {s.curriculum} · {s.grade}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-600 text-sm">
                No subjects yet — add them from your tutor application.
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Availability toggle (client)** — the presence publisher:

```tsx
// src/app/dashboard/availability-toggle.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { PRESENCE_CHANNEL } from "@/lib/presence";

export function AvailabilityToggle({
  teacherId, fullName, hourlyRate,
}: { teacherId: string; fullName: string; hourlyRate: number }) {
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Leaving the page must drop presence, or the list shows a ghost.
  useEffect(() => {
    return () => {
      channelRef.current?.unsubscribe();
      channelRef.current = null;
    };
  }, []);

  // Accepting a request navigates to the call, which unmounts this component
  // and drops presence — correct, since a busy teacher must not appear
  // startable. But without this, the teacher returns from the session silently
  // offline while believing they are still available (design spec §3.1: the
  // teacher re-tracks when the session ends). Remember the intent and restore it.
  useEffect(() => {
    let wanted = false;
    try {
      wanted = localStorage.getItem(`smb-available-${teacherId}`) === "1";
    } catch {
      // Private mode or blocked storage — start offline rather than crash.
    }
    if (wanted) void goOnline();
    // goOnline is stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId]);

  function rememberIntent(available: boolean) {
    try {
      localStorage.setItem(`smb-available-${teacherId}`, available ? "1" : "0");
    } catch {
      // Non-fatal: the toggle still works for this page view.
    }
  }

  async function goOnline() {
    setBusy(true);
    const supabase = createClient();
    const channel = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: teacherId } },
    });
    channelRef.current = channel;
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          teacher_id: teacherId,
          full_name: fullName,
          hourly_rate: hourlyRate,
        });
        setOnline(true);
        setBusy(false);
        rememberIntent(true);
      }
    });
  }

  async function goOffline() {
    setBusy(true);
    await channelRef.current?.untrack();
    await channelRef.current?.unsubscribe();
    channelRef.current = null;
    setOnline(false);
    setBusy(false);
    rememberIntent(false);
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${online ? "bg-green-500" : "bg-gray-300"}`}
            />
            <span className="font-bold text-gray-900">
              {online ? "Available now" : "Offline"}
            </span>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            {online
              ? "Students can see you and start a session. Keep this tab open — closing it takes you offline."
              : "You are not visible to students."}
          </p>
        </div>
        <button
          type="button"
          onClick={online ? goOffline : goOnline}
          disabled={busy}
          className={`font-semibold px-6 py-3 rounded-lg transition-all shadow-md disabled:opacity-50 ${
            online
              ? "bg-white border-2 border-gray-300 text-gray-700 hover:border-gray-400"
              : "bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white"
          }`}
        >
          {busy ? "…" : online ? "Go offline" : "Available now"}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Verify** — `npm run build`, then `npm run dev`: signed in as the M1 test teacher (`tutor-check@smbtutorials.in`), `/dashboard` renders with subjects listed and the toggle flips between states. Signed in as a student, `/dashboard` redirects to `/`. Signed out, it redirects to `/signin`. Go available, reload the page: the toggle comes back **online by itself** — that restore is what stops a teacher returning from a session silently offline (re-verified end-to-end in Task 12 Step 2.5).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: teacher dashboard shell + availability presence toggle"`

---

### Task 6: Student online-now list

**Files:**
- Modify: `src/app/teachers/page.tsx`
- Create: `src/app/teachers/online-list.tsx`

**Interfaces:**
- Consumes: `PRESENCE_CHANNEL`, `rosterFromPresenceState`, `intersectOnline`, `OnlineTeacher` (Task 2); `TeacherCardData` from `src/app/teachers/teacher-card.tsx`; `requestSession` (Task 7 — build that action first if executing strictly in order, or stub the import last).
- Produces: `<OnlineList eligible={TeacherCardData[]} filters={{...}} />`.

**Note:** this client needs `config: { presence: { enabled: true } }` **or** a `presence` listener. Attaching the listener enables it automatically, which is what the code below relies on — without either, `presenceState()` stays empty and the list is always blank.

- [ ] **Step 1: Online list (client)**

```tsx
// src/app/teachers/online-list.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PRESENCE_CHANNEL, rosterFromPresenceState, intersectOnline,
  type OnlineTeacher,
} from "@/lib/presence";
import { TeacherCard, type TeacherCardData } from "./teacher-card";
import { requestSession } from "./actions";

export function OnlineList({
  eligible, subject, curriculum, grade, stream, didNotRespond,
}: {
  eligible: TeacherCardData[];
  subject: string; curriculum: string; grade: string; stream: string;
  didNotRespond?: string;
}) {
  const [roster, setRoster] = useState<OnlineTeacher[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(PRESENCE_CHANNEL);
    // The presence listener also switches on receiving presence state.
    channel.on("presence", { event: "sync" }, () => {
      setRoster(rosterFromPresenceState(channel.presenceState<OnlineTeacher>()));
    });
    channel.subscribe();
    return () => { channel.unsubscribe(); };
  }, []);

  const online = intersectOnline(eligible, roster);

  async function start(teacherId: string) {
    setPendingId(teacherId);
    setError(null);
    const result = await requestSession({ teacherId, subject, curriculum, grade, stream });
    if (result?.error) {
      setError(result.error);
      setPendingId(null);
    }
    // On success the action redirects to /waiting/{id}.
  }

  if (online.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
        <div className="text-5xl mb-4">🌙</div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">
          No teachers online for {subject || "this subject"} right now
        </h3>
        <p className="text-gray-600 mb-6">
          Teachers come online through the day. You can ask a specific teacher
          to come online, or book a time — both arrive soon.
        </p>
        <div className="flex gap-3 justify-center">
          <button type="button" disabled title="Teacher requests arrive in M4"
            className="bg-white border-2 border-teal-600 text-teal-600 font-semibold px-6 py-3 rounded-lg opacity-50 cursor-not-allowed">
            Request a teacher
          </button>
          <button type="button" disabled title="Scheduling arrives after the instant tier"
            className="bg-white border-2 border-gray-300 text-gray-600 font-semibold px-6 py-3 rounded-lg opacity-50 cursor-not-allowed">
            Schedule for later
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {didNotRespond && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          {didNotRespond} didn&apos;t respond — these teachers are free now
        </div>
      )}
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {online.map((teacher) => (
          <TeacherCard
            key={teacher.id}
            teacher={teacher}
            onStart={() => start(teacher.id)}
            starting={pendingId === teacher.id}
          />
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Make `TeacherCard` startable** — in `src/app/teachers/teacher-card.tsx`, add `"use client";` at the top, extend the props to `{ teacher: TeacherCardData; onStart?: () => void; starting?: boolean }`, and replace the disabled "Book Now" button with:

```tsx
<button
  type="button"
  onClick={onStart}
  disabled={!onStart || starting}
  className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-semibold px-6 py-2 rounded-lg transition-all disabled:opacity-50"
>
  {starting ? "Asking…" : "Start now →"}
</button>
```

- [ ] **Step 3: Hand the query results to the list** — in `src/app/teachers/page.tsx`, keep the existing query and criteria header, then replace the card grid *and* the old empty state with `<OnlineList eligible={teachers} subject={subject} curriculum={curriculum} grade={grade} stream={stream} didNotRespond={one(params.didNotRespond) || undefined} />`. Delete the bottom "Didn't find what you're looking for?" panel — the empty state inside `OnlineList` now carries the fallback tiers.
- [ ] **Step 4: Verify** — `npm run build`; with the teacher's dashboard open and available in one browser, `/teachers?curriculum=CBSE&grade=11th&stream=Science&subject=Physics` in another shows their card within a second or two; toggling them offline removes it live without a refresh.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: online-now teacher list driven by presence"`

---

### Task 7: Request a session, accept and decline

**Files:**
- Create: `src/app/teachers/actions.ts`, `src/app/dashboard/actions.ts`, `src/app/dashboard/incoming-request.tsx`
- Modify: `src/app/dashboard/page.tsx` (render the prompt)

**Interfaces:**
- Consumes: `ACCEPT_WINDOW_SECONDS`, `acceptDeadlineFrom`, `effectiveStatus`, `canTransition`, `secondsRemaining` (Task 1); `createSessionRoom` (Task 4); server `createClient`.
- Produces:
  - `requestSession(input: { teacherId: string; subject: string; curriculum: string; grade: string; stream: string }): Promise<{ error: string } | void>` — inserts the row, redirects to `/waiting/{id}`.
  - `acceptSession(sessionId: string): Promise<{ error: string } | void>` — validates, mints the room, sets `active`, redirects to `/call/{id}`.
  - `declineSession(sessionId: string): Promise<{ error: string } | void>`

- [ ] **Step 1: requestSession**

```ts
// src/app/teachers/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { acceptDeadlineFrom } from "@/lib/session";
import { isCurriculum, isGrade, isSubjectOf } from "@/lib/taxonomy";

export async function requestSession(input: {
  teacherId: string; subject: string; curriculum: string; grade: string; stream: string;
}): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to start a session." };

  if (!isCurriculum(input.curriculum) || !isGrade(input.grade) ||
      !isSubjectOf(input.stream, input.subject)) {
    return { error: "Pick a subject before starting." };
  }
  if (input.teacherId === user.id) return { error: "You cannot tutor yourself." };

  // Rate is snapshotted from the teacher's profile at request time.
  const { data: teacher } = await supabase
    .from("profiles")
    .select("id, hourly_rate, role")
    .eq("id", input.teacherId)
    .single();
  if (!teacher || teacher.role !== "teacher" || !teacher.hourly_rate) {
    return { error: "That teacher is unavailable." };
  }

  const { data: session, error } = await supabase
    .from("sessions")
    .insert({
      student_id: user.id,
      teacher_id: input.teacherId,
      curriculum: input.curriculum,
      grade: input.grade,
      stream: input.stream,
      subject: input.subject,
      type: "instant",
      status: "pending",
      accept_deadline: acceptDeadlineFrom(new Date()).toISOString(),
      hourly_rate: teacher.hourly_rate,
    })
    .select("id")
    .single();

  if (error || !session) return { error: "Couldn't start the request — try again." };
  redirect(`/waiting/${session.id}`);
}
```

- [ ] **Step 2: acceptSession + declineSession**

```ts
// src/app/dashboard/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createSessionRoom } from "@/lib/daily";
import { canTransition, effectiveStatus, type SessionStatus } from "@/lib/session";

async function loadOwnSession(sessionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, session: null };
  const { data: session } = await supabase
    .from("sessions")
    .select("id, teacher_id, student_id, status, accept_deadline, started_at, duration_minutes")
    .eq("id", sessionId)
    .single();
  return { supabase, user, session };
}

export async function acceptSession(sessionId: string): Promise<{ error: string } | void> {
  const { supabase, user, session } = await loadOwnSession(sessionId);
  if (!user || !session) return { error: "Request not found." };
  if (session.teacher_id !== user.id) return { error: "Not your request." };

  // The deadline is authoritative here regardless of what the UI showed.
  const actual = effectiveStatus(
    { ...session, status: session.status as SessionStatus },
    new Date()
  );
  if (actual !== "pending") return { error: "That request has already expired." };
  if (!canTransition("pending", "active")) return { error: "Invalid transition." };

  // Refuse a second concurrent call for this teacher.
  const { count } = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("teacher_id", user.id)
    .eq("status", "active");
  if ((count ?? 0) > 0) return { error: "You are already in a session." };

  let roomUrl: string;
  try {
    const room = await createSessionRoom(sessionId, process.env.DAILY_API_KEY ?? "");
    roomUrl = room.url;
  } catch {
    return { error: "Couldn't start the call — try again." };
  }

  const { error } = await supabase
    .from("sessions")
    .update({ status: "active", started_at: new Date().toISOString(), daily_room_url: roomUrl })
    .eq("id", sessionId)
    .eq("status", "pending"); // lost race → 0 rows, student already cancelled
  if (error) return { error: "Couldn't start the call — try again." };

  redirect(`/call/${sessionId}`);
}

export async function declineSession(sessionId: string): Promise<{ error: string } | void> {
  const { supabase, user, session } = await loadOwnSession(sessionId);
  if (!user || !session) return { error: "Request not found." };
  if (session.teacher_id !== user.id) return { error: "Not your request." };

  await supabase
    .from("sessions")
    .update({ status: "declined" })
    .eq("id", sessionId)
    .eq("status", "pending");
}
```

- [ ] **Step 3: Incoming request prompt (client)**

```tsx
// src/app/dashboard/incoming-request.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { secondsRemaining } from "@/lib/session";
import { acceptSession, declineSession } from "./actions";

interface PendingRequest {
  id: string; subject: string; hourly_rate: number;
  accept_deadline: string; student_name: string;
}

export function IncomingRequest({ teacherId }: { teacherId: string }) {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`teacher-sessions-${teacherId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sessions", filter: `teacher_id=eq.${teacherId}` },
        async (payload) => {
          const row = payload.new as {
            id: string; subject: string; hourly_rate: number;
            accept_deadline: string; student_id: string; status: string;
          };
          if (row.status !== "pending") return;
          const { data: student } = await supabase
            .from("profiles").select("full_name").eq("id", row.student_id).single();
          setRequest({
            id: row.id, subject: row.subject, hourly_rate: row.hourly_rate,
            accept_deadline: row.accept_deadline,
            student_name: student?.full_name || "A student",
          });
        }
      )
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [teacherId]);

  // Local countdown; the server re-checks the deadline on accept anyway.
  useEffect(() => {
    if (!request) return;
    const tick = () => {
      const remaining = secondsRemaining(request.accept_deadline, new Date());
      setLeft(remaining);
      if (remaining === 0) setRequest(null);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [request]);

  if (!request) return null;

  return (
    <section className="bg-white rounded-2xl shadow-xl border-2 border-teal-500 p-6">
      <p className="text-lg font-bold text-gray-900 mb-1">
        New student request — {request.student_name} wants {request.subject} now, ₹
        {request.hourly_rate}/hr
      </p>
      <p className="text-sm text-gray-600 mb-4">{left}s to respond</p>
      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); await acceptSession(request.id); setBusy(false); }}
          className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-semibold px-6 py-3 rounded-lg disabled:opacity-50"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); await declineSession(request.id); setRequest(null); setBusy(false); }}
          className="bg-white border-2 border-gray-300 hover:border-gray-400 text-gray-700 font-semibold px-6 py-3 rounded-lg disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Render it** — in `src/app/dashboard/page.tsx`, add `import { IncomingRequest } from "./incoming-request";` and place `<IncomingRequest teacherId={profile.id} />` directly above `<AvailabilityToggle .../>`.
- [ ] **Step 5: Verify** — `npm run build`, then two browsers: teacher available on `/dashboard`, student clicks "Start now →". The prompt appears with a live countdown; Accept lands the teacher on `/call/{id}` (a 404 until Task 9 — that is expected at this point) and the `sessions` row reads `active` with a `daily_room_url` in the Supabase table editor. Decline sets `declined`. Waiting 30s without responding leaves it `pending` in the DB but the prompt disappears, and a later Accept is refused with "That request has already expired."
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: instant request + accept/decline handshake with server-side room minting"`

---

### Task 8: Student waiting screen

**Files:**
- Create: `src/app/waiting/[sessionId]/page.tsx`, `src/app/waiting/[sessionId]/waiting-client.tsx`
- Create: `src/app/session/actions.ts`

**Interfaces:**
- Consumes: `effectiveStatus`, `secondsRemaining`, `SessionStatus` (Task 1).
- Produces: `cancelSession(sessionId: string): Promise<void>` and `completeSession(sessionId: string): Promise<void>` in `src/app/session/actions.ts` — the latter is used by Task 9.

- [ ] **Step 1: Shared session actions**

```ts
// src/app/session/actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";

export async function cancelSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId)
    .eq("student_id", user.id)
    .eq("status", "pending");
}

// Called by whichever participant's client notices the call is over — the
// third enforcement point is the read-time rule in effectiveStatus.
export async function completeSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("sessions")
    .update({ status: "completed" })
    .eq("id", sessionId)
    .eq("status", "active");
}
```

- [ ] **Step 2: Waiting page (server)**

```tsx
// src/app/waiting/[sessionId]/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { effectiveStatus, type SessionStatus } from "@/lib/session";
import { WaitingClient } from "./waiting-client";

export default async function WaitingPage({ params }: PageProps<"/waiting/[sessionId]">) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: session } = await supabase
    .from("sessions")
    .select("id, student_id, teacher_id, subject, status, accept_deadline, started_at, duration_minutes")
    .eq("id", sessionId)
    .single();
  if (!session || session.student_id !== user.id) redirect("/teachers");

  const { data: teacher } = await supabase
    .from("profiles").select("full_name").eq("id", session.teacher_id).single();

  const status = effectiveStatus(
    { ...session, status: session.status as SessionStatus }, new Date()
  );
  if (status === "active") redirect(`/call/${sessionId}`);
  if (status !== "pending") {
    redirect(`/teachers?didNotRespond=${encodeURIComponent(teacher?.full_name ?? "The teacher")}`);
  }

  return (
    <WaitingClient
      sessionId={session.id}
      teacherName={teacher?.full_name ?? "your teacher"}
      deadline={session.accept_deadline!}
    />
  );
}
```

- [ ] **Step 3: Waiting client**

```tsx
// src/app/waiting/[sessionId]/waiting-client.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { secondsRemaining } from "@/lib/session";
import { cancelSession } from "@/app/session/actions";

export function WaitingClient({
  sessionId, teacherName, deadline,
}: { sessionId: string; teacherName: string; deadline: string }) {
  const router = useRouter();
  const [left, setLeft] = useState(() => secondsRemaining(deadline, new Date()));

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`session-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` },
        (payload) => {
          const status = (payload.new as { status: string }).status;
          if (status === "active") router.push(`/call/${sessionId}`);
          else if (status !== "pending") {
            router.push(`/teachers?didNotRespond=${encodeURIComponent(teacherName)}`);
          }
        }
      )
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [sessionId, teacherName, router]);

  useEffect(() => {
    const id = setInterval(() => {
      const remaining = secondsRemaining(deadline, new Date());
      setLeft(remaining);
      if (remaining === 0) {
        router.push(`/teachers?didNotRespond=${encodeURIComponent(teacherName)}`);
      }
    }, 250);
    return () => clearInterval(id);
  }, [deadline, teacherName, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-50 to-blue-50 flex items-center justify-center p-8">
      <div className="bg-white rounded-2xl shadow-xl p-12 max-w-md w-full text-center border border-gray-100">
        <div className="relative w-28 h-28 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full border-4 border-teal-100" />
          <div className="absolute inset-0 rounded-full border-4 border-teal-500 border-t-transparent animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-gray-900">
            {left}
          </div>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Asking {teacherName}…</h2>
        <p className="text-gray-600 mb-8">
          They have a few seconds to accept. Hold tight.
        </p>
        <button
          type="button"
          onClick={async () => {
            await cancelSession(sessionId);
            router.push("/teachers");
          }}
          className="bg-white border-2 border-gray-300 hover:border-gray-400 text-gray-700 font-semibold px-8 py-3 rounded-lg"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify** — two browsers: "Start now →" lands the student on the waiting screen with a live countdown; the teacher's Accept moves the student to `/call/{id}`; Decline and 30s-of-silence both return the student to `/teachers` with the "{teacher} didn't respond — these teachers are free now" banner; Cancel sets `cancelled` and the teacher's prompt disappears.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: student waiting screen with countdown, cancel and live handoff"`

---

### Task 9: In-call screen

**Files:**
- Create: `src/app/call/[sessionId]/page.tsx`, `src/app/call/[sessionId]/call-frame.tsx`

**Interfaces:**
- Consumes: `createMeetingToken`, `roomNameForSession` (Task 4); `effectiveStatus`, `SESSION_DURATION_MINUTES` (Task 1); `completeSession` (Task 8).

- [ ] **Step 1: Page (server)** — authorizes the viewer and mints *their* token:

```tsx
// src/app/call/[sessionId]/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createMeetingToken, roomNameForSession } from "@/lib/daily";
import { effectiveStatus, type SessionStatus } from "@/lib/session";
import { CallFrame } from "./call-frame";

export default async function CallPage({ params }: PageProps<"/call/[sessionId]">) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: session } = await supabase
    .from("sessions")
    .select("id, student_id, teacher_id, subject, status, accept_deadline, started_at, duration_minutes, daily_room_url")
    .eq("id", sessionId)
    .single();
  if (!session) redirect("/");

  const isTeacher = session.teacher_id === user.id;
  const isStudent = session.student_id === user.id;
  if (!isTeacher && !isStudent) redirect("/");

  const status = effectiveStatus(
    { ...session, status: session.status as SessionStatus }, new Date()
  );
  if (status !== "active" || !session.daily_room_url) redirect(isTeacher ? "/dashboard" : "/teachers");

  const otherId = isTeacher ? session.student_id : session.teacher_id;
  const { data: me } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).single();
  const { data: other } = await supabase
    .from("profiles").select("full_name").eq("id", otherId).single();

  // Per-user token: the student cannot join as the teacher (spec §15).
  const token = await createMeetingToken(
    roomNameForSession(sessionId),
    me?.full_name || "Participant",
    isTeacher,
    process.env.DAILY_API_KEY ?? ""
  );

  return (
    <CallFrame
      sessionId={session.id}
      roomUrl={session.daily_room_url}
      token={token}
      otherName={other?.full_name ?? "Your session"}
      subject={session.subject}
      startedAt={session.started_at!}
      durationMinutes={session.duration_minutes}
      returnTo={isTeacher ? "/dashboard" : "/teachers"}
    />
  );
}
```

- [ ] **Step 2: Call frame (client)**

```tsx
// src/app/call/[sessionId]/call-frame.tsx
"use client";

import DailyIframe, { type DailyCall } from "@daily-co/daily-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { completeSession } from "@/app/session/actions";

function mmss(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function CallFrame({
  sessionId, roomUrl, token, otherName, subject, startedAt, durationMinutes, returnTo,
}: {
  sessionId: string; roomUrl: string; token: string; otherName: string;
  subject: string; startedAt: string; durationMinutes: number; returnTo: string;
}) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState("");

  const endsAt = new Date(startedAt).getTime() + durationMinutes * 60_000;

  useEffect(() => {
    let frame: DailyCall | null = null;
    let cancelled = false;

    (async () => {
      if (cancelled || DailyIframe.getCallInstance() || !wrapRef.current) return;
      try {
        frame = DailyIframe.createFrame(wrapRef.current, {
          showLeaveButton: true,
          iframeStyle: { width: "100%", height: "100%", border: "0" },
        });
        frame.on("left-meeting", async () => {
          await completeSession(sessionId);
          router.push(returnTo);
        });
        await frame.join({ url: roomUrl, token });
      } catch (e) {
        setError((e as Error)?.message ?? "Could not join the call");
      }
    })();

    return () => { cancelled = true; frame?.destroy(); };
  }, [roomUrl, token, sessionId, returnTo, router]);

  useEffect(() => {
    const tick = async () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0) {
        await completeSession(sessionId);
        router.push(returnTo);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt, sessionId, returnTo, router]);

  return (
    <main className="flex h-screen flex-col bg-gray-900">
      <div className="flex items-center justify-between gap-4 px-6 py-3 bg-white border-b border-gray-200">
        <div>
          <p className="font-bold text-gray-900">{otherName}</p>
          <p className="text-sm text-teal-600 font-medium">{subject}</p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-bold tabular-nums ${left < 300 ? "text-amber-600" : "text-gray-900"}`}>
            {mmss(left)}
          </p>
          <p className="text-xs text-gray-500">remaining</p>
        </div>
      </div>
      {error && <p className="bg-red-50 text-red-700 px-6 py-2 text-sm">{error}</p>}
      <div ref={wrapRef} className="flex-1" />
    </main>
  );
}
```

- [ ] **Step 3: Verify** — two browsers through the full loop: accept lands both in the call, each sees the other's name and the subject, the countdown runs down from 60:00, and video/audio/screen-share work. Leaving marks the session `completed` and returns each party to their own page. Re-visiting `/call/{id}` after completion redirects away rather than rejoining. A third signed-in user visiting that URL is redirected to `/`.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: in-call screen with context bar, countdown and completion"`

---

### Task 10: Session history + pending-payout earnings

**Files:**
- Create: `src/app/dashboard/session-history.tsx`
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: History + earnings (server component)**

```tsx
// src/app/dashboard/session-history.tsx
import { createClient } from "@/lib/supabase/server";
import { effectiveStatus, type SessionStatus } from "@/lib/session";

export async function SessionHistory({ teacherId }: { teacherId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sessions")
    .select("id, subject, status, hourly_rate, duration_minutes, started_at, accept_deadline, created_at, student_id")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(25);

  const now = new Date();
  const rows = (data ?? []).map((s) => ({
    ...s,
    status: effectiveStatus({ ...s, status: s.status as SessionStatus }, now),
  }));

  // Earned = work actually completed. Not a balance, not a projection.
  const earned = rows
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + Math.round((r.hourly_rate * r.duration_minutes) / 60), 0);

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-bold text-gray-900">Your sessions</h3>
        <div className="text-right">
          <p className="text-2xl font-bold text-gray-900">₹{earned}</p>
          <p className="text-xs text-gray-500">earned · pending payout</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">
          No sessions yet. Go available and your first request will appear here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-2 font-semibold">Subject</th>
                <th className="py-2 font-semibold">When</th>
                <th className="py-2 font-semibold">Status</th>
                <th className="py-2 font-semibold text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50">
                  <td className="py-2 text-gray-900">{r.subject}</td>
                  <td className="py-2 text-gray-600">
                    {new Date(r.created_at).toLocaleString("en-IN")}
                  </td>
                  <td className="py-2 text-gray-600">{r.status}</td>
                  <td className="py-2 text-gray-900 text-right">₹{r.hourly_rate}/hr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500 mt-4">
        Payouts are made manually while payments are being set up.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Render it** — in `src/app/dashboard/page.tsx`, add `import { SessionHistory } from "./session-history";` and place `<SessionHistory teacherId={profile.id} />` as the last section.
- [ ] **Step 3: Verify** — after completing one session end to end, the dashboard lists it as `completed` and earnings read ₹500 for a ₹500/hr 60-minute session. A brand-new teacher sees ₹0 and the empty message, never a fabricated figure.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: teacher session history + pending-payout earnings"`

---

### Task 11: Delete the M0 spike

**Files:**
- Delete: `src/app/call/page.tsx`, `src/app/api/rooms/route.ts`, `src/lib/share.ts`, `src/lib/share.test.ts`
- Modify: `docs/superpowers/specs/2026-08-24-smb-tutorials-design.md` (§15)

The spike proved the Daily plumbing and has been fully replaced: rooms are now minted server-side on an authenticated accept, tied to a session row, private, with per-user tokens. Keeping it would leave a signed-in user able to mint arbitrary rooms.

- [ ] **Step 1: Confirm nothing still imports them**

```bash
grep -rn "api/rooms\|lib/share\|buildShareUrl" src/ --include="*.ts" --include="*.tsx"
```
Expected: no matches outside the files being deleted. `getOrCreateRoom` in `src/lib/daily.ts` **stays** — it is reusable core, and its tests stay green.

- [ ] **Step 2: Delete**

```bash
rm src/app/call/page.tsx src/app/api/rooms/route.ts src/lib/share.ts src/lib/share.test.ts
```

- [ ] **Step 3: Rewrite spec §15** — replace the M1 interim annotation with: *"**Closed in M2.** Rooms are minted server-side in `acceptSession` only, are private, carry an `exp`, and each party joins with its own Daily meeting token. The `/call` spike page and the `/api/rooms` route were deleted in M2 Task 11."*
- [ ] **Step 4: Verify** — `npm run test` (share tests gone, everything else green), `npm run build` clean, and `/call` now 404s while `/call/{sessionId}` works.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: delete M0 spike — rooms are now session-scoped and token-gated (closes spec §15)"`

---

### Task 12: Verify and deploy

- [ ] **Step 1: Automated** — `npm run test` (M1's 19 plus the new session and presence tests), `npx tsc --noEmit` (expect exit 0; then `rm -f tsconfig.tsbuildinfo`), `npm run build` clean.
- [ ] **Step 2: Full two-browser loop, locally** —
  1. Teacher signs in, opens `/dashboard`, goes **Available now**.
  2. Student picks CBSE / 11th / Science / Physics on `/find`, sees that teacher on `/teachers`, clicks **Start now →**.
  3. Teacher sees "New student request — {student} wants Physics now, ₹500/hr" with a countdown; clicks **Accept**.
  4. Both land in the call, see each other, and the countdown runs from 60:00.
  5. Either leaves → session `completed`, dashboard history shows it, earnings read ₹500. **The teacher lands back on `/dashboard` already available** — and a second student can immediately see and start with them, which is the real test that presence was restored rather than silently dropped.
  6. Repeat, but **Decline** → student returns to `/teachers` with the "didn't respond" banner. Repeat again ignoring it for 30s → same result.
  7. Teacher goes offline → their card disappears from the student's list without a refresh.
- [ ] **Step 3: Security checks** — signed in as an unrelated third user, `/call/{someone-elses-session}` redirects to `/`; `/dashboard` as a student redirects to `/`; in the Supabase SQL editor confirm a non-participant cannot select the row.
- [ ] **Step 4: Update `project_state.md`** — M2 complete; production URL; note that spec §15 is now closed and the spike is deleted; carry forward the still-open items (Google OAuth, email confirmation off, terms rewrite, delete the test teacher).
- [ ] **Step 5: Push** — `git branch --show-current` = `main`; `git fetch origin main && git rebase origin/main && git push origin main`.
- [ ] **Step 6: Verify production** — on `https://smb-tutorials.vercel.app`, run the two-browser loop again. Vercel deploys are fast but not instant; confirm the new deployment is Ready first (`vercel ls smb-tutorials --prod`). **"Deployment Ready" is not "site works"** — actually click through it.

## Verification (overall)

- Automated: `npm run test`, `npx tsc --noEmit`, `npm run build`.
- Manual: Task 12 Steps 2–3 locally, Step 6 in production. The two-browser handshake cannot be automated here, exactly as the video check couldn't in M0.
- Data: inspect `sessions` in the Supabase table editor after each run — statuses should be `completed`, `declined`, `timed_out` and `cancelled` respectively, never a stale `pending` or `active`.
