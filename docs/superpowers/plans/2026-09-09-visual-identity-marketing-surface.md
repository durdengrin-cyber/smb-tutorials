# Visual Identity: The Marketing Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the public pages onto the token system so the identity chosen in the spec becomes visible — the homepage the mockup shows, with a real online-teacher count, no stock photography and no emoji.

**Architecture:** Plan 1 shipped the tokens; this plan deletes the hardcoded colours that ignore them. The homepage is rebuilt from the approved mockup: a server component that fetches live counts, a sticky scroll-driven hero whose device walks the real flow, and hairline-ruled sections below it. The hero degrades to four stacked screenshots with no JS, on a phone, or under reduced-motion — the fallback is the default and JS opts out of it, not the other way round.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (`@theme inline`), shadcn/ui, next-themes, Supabase (service-role read), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-05-visual-identity-design.md`

**Mockup (visual source of truth):** `https://claude.ai/code/artifact/8291fceb-9225-4727-99e1-8b07b5fad483`

**Predecessor:** `docs/superpowers/plans/2026-09-05-visual-identity-system.md` (plan 1 of 3, complete — branch `feat/visual-identity-tokens`)

## Global Constraints

- **Baseline is 306 passing / 3 skipped.** Plan 1 added 6. Gates before every commit: `npx vitest run`, `npx tsc --noEmit`, `npx eslint .` (0 problems, warnings included), `npm run build`.
- **No emoji anywhere.** Spec §5.4. Replaced by structure and mono labels, not by an icon set.
- **No photographs of children — stock or real.** Spec §6. All four hotlinked Unsplash images are deleted in this plan, not replaced.
- **One spelling: `SMB Tutorials`.** Spec §2. The visible wordmark shortens to `SMB` in the nav. This applies to prose a person reads — **not** to package names, route paths, or email/DNS hostnames.
- **The name is not up for renaming.** SMB is Syedna Mohammed Burhanuddin. See `CLAUDE.md`.
- **The About page and the dedication are OUT of this plan.** The owner has shelved the dedication copy (decided 2026-09-09). The mockup's footer dedication block is not built. Nothing else in the footer changes shape.
- **Mono is semantic, not decorative.** IBM Plex Mono marks what is live or factual: the online count, step numbers, rates, timers. Archivo carries everything else.
- **`--primary` is the brand accent**, `--accent` is a hover surface. Same trap as plan 1.
- **Both themes for every change.** A screen correct in one and wrong in the other is a defect.
- **Recording copy and the recording feature ship together.** The safety section states recording as it will be at launch; the owner has confirmed recording is integrated before launch (2026-09-09). If that ordering ever changes, this copy changes with it — they must not diverge on a public page.
- Do not push. Commit locally; the human decides when production deploys.

## What is deliberately NOT in this plan

- **The About page and dedication copy.** Shelved by the owner.
- **The share card, `apple-touch-icon`, app icons, the wordmark decision.** Plan 3.
- **Any app-screen layout change.** `app-shell.tsx` has 0 hardcoded colours and `/sessions` has 4 — they already follow the tokens. Plan 3 finishes them.
- **Real product screenshots.** Spec §6 wanted staged screenshots; the mockup draws the device in CSS instead. That is cheaper, needs no placeholder teacher data, and cannot go stale against a UI change. Adopted deliberately — record it if the owner disagrees.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/online-count.ts` | **New.** Pure shaping: rows → total and per-subject counts. No network. |
| `src/lib/online-count.test.ts` | **New.** Its tests. |
| `src/lib/online-count.server.ts` | **New.** The service-role read plus a short TTL memo. |
| `src/lib/online-count.server.test.ts` | **New.** Memo and failure-path tests. |
| `src/components/marketing-header.tsx` | Rewritten to the mockup nav: wordmark, live count, links, toggle. |
| `src/components/marketing-footer.tsx` | **New.** Ruled footer. No dedication. |
| `src/lib/scene-urls.ts` | **New.** The scene URL strip and the domain constant. Shared by a server and a client component, so it lives alone. |
| `src/components/site-device.tsx` | **New.** The four flow scenes, server-rendered and stacked by default. |
| `src/components/hero-scroll.tsx` | **New.** Client. Promotes the stack to the sticky scroll-driven hero. |
| `src/components/hero-scroll.test.tsx` | **New.** Its tests. |
| `src/app/(marketing)/page.tsx` | Rewritten. Server component; fetches counts, composes the sections. |
| `src/app/(marketing)/signin/page.tsx` | Unsplash out, tokens in. |
| `src/app/(marketing)/signup/page.tsx` | Unsplash out, tokens in. |
| `src/app/(marketing)/tutor-signup/page.tsx` | Emoji out, tokens in. |
| `src/app/(marketing)/terms/page.tsx` | Tokens, one spelling. |
| `src/app/(marketing)/privacy/page.tsx` | Tokens, one spelling. |
| `src/lib/marketing-copy.test.ts` | **New.** Pins spelling, no-emoji and no-Unsplash across the surface. |

---

### Task 1: The online count, as pure functions

**Files:**
- Create: `src/lib/online-count.ts`, `src/lib/online-count.test.ts`

**Interfaces:**
- Produces: `AvailabilityRow`, `countBySubject(rows): SubjectCount[]`, `countTeachers(rows): number`. Task 2 calls both.

The homepage claims a number. That number has to be derived from one shape of row, in one place, so the nav count and the subject chips can never disagree.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { countBySubject, countTeachers, type AvailabilityRow } from "./online-count";

const rows: AvailabilityRow[] = [
  { teacher_id: "a", subject: "Mathematics" },
  { teacher_id: "a", subject: "Physics" },
  { teacher_id: "b", subject: "Mathematics" },
  { teacher_id: "c", subject: "Chemistry" },
];

describe("countTeachers", () => {
  // A teacher who teaches three subjects is one teacher. The nav says
  // "N teachers online", so counting rows would inflate the headline claim.
  it("counts distinct teachers, not rows", () => {
    expect(countTeachers(rows)).toBe(3);
  });

  it("is zero for no rows", () => {
    expect(countTeachers([])).toBe(0);
  });
});

describe("countBySubject", () => {
  it("counts teachers per subject, most first", () => {
    expect(countBySubject(rows)).toEqual([
      { subject: "Mathematics", count: 2 },
      { subject: "Chemistry", count: 1 },
      { subject: "Physics", count: 1 },
    ]);
  });

  // Ties break alphabetically so the strip does not reshuffle between
  // requests, which reads as flicker rather than as live data.
  it("breaks ties alphabetically", () => {
    expect(countBySubject(rows).map((s) => s.subject)).toEqual([
      "Mathematics",
      "Chemistry",
      "Physics",
    ]);
  });

  it("does not double-count one teacher listed twice for a subject", () => {
    const dupes: AvailabilityRow[] = [
      { teacher_id: "a", subject: "Mathematics" },
      { teacher_id: "a", subject: "Mathematics" },
    ];
    expect(countBySubject(dupes)).toEqual([{ subject: "Mathematics", count: 1 }]);
  });

  it("is empty for no rows", () => {
    expect(countBySubject([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/online-count.test.ts`
Expected: FAIL — cannot resolve `./online-count`.

- [ ] **Step 3: Implement**

```typescript
// The homepage's only claim about live supply. Kept pure and separate from
// the query so the shaping is testable without a database, and so the nav
// count and the subject strip are provably derived from the same rows.

export interface AvailabilityRow {
  teacher_id: string;
  subject: string;
}

export interface SubjectCount {
  subject: string;
  count: number;
}

export function countTeachers(rows: AvailabilityRow[]): number {
  return new Set(rows.map((r) => r.teacher_id)).size;
}

export function countBySubject(rows: AvailabilityRow[]): SubjectCount[] {
  const bySubject = new Map<string, Set<string>>();
  for (const row of rows) {
    const teachers = bySubject.get(row.subject) ?? new Set<string>();
    teachers.add(row.teacher_id);
    bySubject.set(row.subject, teachers);
  }

  return [...bySubject.entries()]
    .map(([subject, teachers]) => ({ subject, count: teachers.size }))
    .sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject));
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/online-count.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add src/lib/online-count.ts src/lib/online-count.test.ts
git commit -m "feat(marketing): derive the online count from one row shape"
```

---

### Task 2: The service-role read behind a short memo

**Files:**
- Create: `src/lib/online-count.server.ts`, `src/lib/online-count.server.test.ts`

**Interfaces:**
- Consumes: `AvailabilityRow`, `countBySubject`, `countTeachers` (Task 1); `createDispatchClient` from `@/lib/supabase/admin`.
- Produces: `getOnlineSnapshot(): Promise<OnlineSnapshot>` where `OnlineSnapshot = { teachers: number; subjects: SubjectCount[] }`. Task 5 and Task 7 render it.

**Why the service-role client and not the RPC.** `available_teachers` is `revoke all … from public` and granted only to `authenticated` (`supabase/migrations/0010_available_teachers.sql`). A signed-out visitor cannot call it. Decided 2026-09-09: read server-side with the admin client rather than add an anon-granted RPC, because that ships without a migration. Only aggregate counts leave the server — no teacher id, name or rate reaches the page.

**The honesty caveat, recorded not hidden.** `teacher_availability` is a 4-hour lease, and presence lives in the Realtime service where SQL cannot see it (see the comment block in `0010`). So this count is *declared available*, which can exceed *actually present*. Spec §7 rejects a count that lies at 3am. A lease-only count is the closest honest number available without a migration; if it proves overstated in the pilot, the fix is an anon RPC that ANDs presence, and it belongs in the spec's hardening section.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows = vi.hoisted(() => ({ data: null as unknown, error: null as unknown }));
const selectSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createDispatchClient: () => ({
    from: () => ({
      select: (...args: unknown[]) => {
        selectSpy(...args);
        return {
          eq: () => ({ gt: () => Promise.resolve({ data: rows.data, error: rows.error }) }),
        };
      },
    }),
  }),
}));

import { getOnlineSnapshot, __resetOnlineSnapshotCache } from "./online-count.server";

beforeEach(() => {
  rows.data = [
    { teacher_id: "a", teacher_subjects: [{ subject: "Mathematics" }, { subject: "Physics" }] },
    { teacher_id: "b", teacher_subjects: [{ subject: "Mathematics" }] },
  ];
  rows.error = null;
  selectSpy.mockClear();
  __resetOnlineSnapshotCache();
});

describe("getOnlineSnapshot", () => {
  it("flattens the joined rows into a snapshot", async () => {
    const snap = await getOnlineSnapshot();
    expect(snap.teachers).toBe(2);
    expect(snap.subjects).toEqual([
      { subject: "Mathematics", count: 2 },
      { subject: "Physics", count: 1 },
    ]);
  });

  // The homepage is public and uncached; without this every visitor is a
  // database read on a page whose number changes on a scale of minutes.
  it("serves a second call from the memo", async () => {
    await getOnlineSnapshot();
    await getOnlineSnapshot();
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  // The count is a nice-to-have on a page whose job is to explain the
  // product. A Supabase outage must not blank the homepage.
  it("degrades to an empty snapshot when the query fails", async () => {
    rows.data = null;
    rows.error = { message: "boom" };
    const snap = await getOnlineSnapshot();
    expect(snap).toEqual({ teachers: 0, subjects: [] });
  });

  it("does not memoise a failure", async () => {
    rows.data = null;
    rows.error = { message: "boom" };
    await getOnlineSnapshot();

    rows.data = [{ teacher_id: "a", teacher_subjects: [{ subject: "Biology" }] }];
    rows.error = null;
    const snap = await getOnlineSnapshot();
    expect(snap.teachers).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/online-count.server.test.ts`
Expected: FAIL — cannot resolve `./online-count.server`.

- [ ] **Step 3: Implement**

```typescript
import "server-only";
import { createDispatchClient } from "@/lib/supabase/admin";
import {
  countBySubject,
  countTeachers,
  type AvailabilityRow,
  type SubjectCount,
} from "./online-count";

export interface OnlineSnapshot {
  teachers: number;
  subjects: SubjectCount[];
}

const EMPTY: OnlineSnapshot = { teachers: 0, subjects: [] };

// Short enough that the number is honest, long enough that a burst of
// visitors is one read. A module-level memo rather than unstable_cache:
// no framework coupling, and a serverless instance that is cold simply
// misses, which is correct rather than merely acceptable.
const TTL_MS = 30_000;
let cached: { at: number; snapshot: OnlineSnapshot } | null = null;

/** Test seam. Never called in production code. */
export function __resetOnlineSnapshotCache(): void {
  cached = null;
}

interface JoinedRow {
  teacher_id: string;
  teacher_subjects: { subject: string }[] | null;
}

export async function getOnlineSnapshot(): Promise<OnlineSnapshot> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.snapshot;

  const supabase = createDispatchClient();
  const { data, error } = await supabase
    .from("teacher_availability")
    .select("teacher_id, teacher_subjects(subject)")
    .eq("declared", true)
    .gt("declared_until", new Date().toISOString());

  // Deliberately not memoised on failure: a transient outage would otherwise
  // pin an empty homepage for the whole TTL.
  if (error || !data) {
    console.error("[online-count] availability read failed", error);
    return EMPTY;
  }

  const rows: AvailabilityRow[] = (data as JoinedRow[]).flatMap((row) =>
    (row.teacher_subjects ?? []).map((s) => ({
      teacher_id: row.teacher_id,
      subject: s.subject,
    }))
  );

  const snapshot: OnlineSnapshot = {
    teachers: countTeachers(rows),
    subjects: countBySubject(rows),
  };
  cached = { at: Date.now(), snapshot };
  return snapshot;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/online-count.server.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify the join is real, not assumed**

The `teacher_subjects(subject)` embed relies on a foreign key Supabase can see. Confirm against production before trusting it:

```bash
supabase db query --linked "select a.teacher_id, s.subject from teacher_availability a join teacher_subjects s on s.teacher_id = a.teacher_id where a.declared and a.declared_until > now() limit 5;"
```

Expected: rows, or an empty result — but **not** a relation error. If PostgREST cannot infer the relationship, replace the embed with two selects and an in-JS join; the pure functions in Task 1 do not change.

- [ ] **Step 6: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add src/lib/online-count.server.ts src/lib/online-count.server.test.ts
git commit -m "feat(marketing): read declared availability server-side for the public count"
```

---

### Task 3: The nav

**Files:**
- Modify: `src/components/marketing-header.tsx`
- Modify: `src/app/(marketing)/layout.tsx`

**Interfaces:**
- Consumes: `OnlineSnapshot` (Task 2), `ThemeToggle` (plan 1).
- Produces: `<MarketingHeader signedIn teachersOnline />`.

The gradient square with "SMB" typed into it is the demo's placeholder and fights §5.4's hairline language. The wordmark becomes the letters themselves.

- [ ] **Step 1: Rewrite the header**

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export function MarketingHeader({
  signedIn,
  teachersOnline,
}: {
  signedIn: boolean;
  teachersOnline: number;
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6 sm:px-8">
        {/* The wordmark is the type, not a badge. Archivo 900 tracked tight
            is the identity (spec §5.3); a drawn mark is plan 3's question. */}
        <Link href="/" className="text-xl font-black tracking-[-0.05em]">
          SMB
        </Link>

        <div className="flex items-center gap-4 sm:gap-6">
          {/* Mono marks what is live. Hidden at zero rather than shown as
              "0 teachers online", which advertises an empty marketplace. */}
          {teachersOnline > 0 && (
            <span className="hidden items-center gap-2 font-mono text-xs text-primary sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
              {teachersOnline} online now
            </span>
          )}
          <Link href="/tutor-signup" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">
            For teachers
          </Link>
          <ThemeToggle />
          <Button asChild>
            <Link href={signedIn ? "/home" : "/signin"}>
              {signedIn ? "Go to your dashboard" : "Sign in"}
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Feed it from the layout**

In `src/app/(marketing)/layout.tsx`, add the import and the fetch. Keep the existing try/catch around `getIdentity` exactly as it is — the comment above it explains why it must be caught there, and that reasoning is unchanged.

```tsx
import { getOnlineSnapshot } from "@/lib/online-count.server";
```

Then, after the identity block:

```tsx
  const { teachers } = await getOnlineSnapshot();

  return (
    <>
      <MarketingHeader signedIn={signedIn} teachersOnline={teachers} />
      {children}
      <MarketingFooter />
    </>
  );
```

`MarketingFooter` arrives in Task 4 — until then, leave it out and add it there.

- [ ] **Step 3: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add src/components/marketing-header.tsx "src/app/(marketing)/layout.tsx"
git commit -m "feat(marketing): the wordmark is the type, and the nav carries the live count"
```

---

### Task 4: The footer

**Files:**
- Create: `src/components/marketing-footer.tsx`
- Modify: `src/app/(marketing)/layout.tsx`

**Interfaces:**
- Produces: `<MarketingFooter />`, rendered by the marketing layout.

**No dedication block.** The owner shelved the copy on 2026-09-09. The mockup's `.ded` element is not built, and nothing stands in its place — an empty bordered box is worse than no box.

- [ ] **Step 1: Create it**

```tsx
import Link from "next/link";

const LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/tutor-signup", label: "For teachers" },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground sm:px-8">
        <span>© {new Date().getFullYear()} SMB Tutorials</span>
        <nav className="flex flex-wrap gap-6">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Mount it**

Add `import { MarketingFooter } from "@/components/marketing-footer";` to `src/app/(marketing)/layout.tsx` and render `<MarketingFooter />` after `{children}` as shown in Task 3 Step 2.

- [ ] **Step 3: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add src/components/marketing-footer.tsx "src/app/(marketing)/layout.tsx"
git commit -m "feat(marketing): a ruled footer, one spelling, no dedication yet"
```

---

### Task 5: The device — four scenes, stacked

**Files:**
- Create: `src/components/site-device.tsx`

**Interfaces:**
- Produces: `src/lib/scene-urls.ts` exporting `SCENE_URLS`, and `<SiteDevice />` rendering four `[data-scene]` panels inside `[data-stage]`. Task 6's client component drives these by index and must not re-render them.

Server-rendered and **stacked by default**. This is the no-JS, reduced-motion and phone rendering, and it is the one that ships if Task 6 never runs. The scroll behaviour is an enhancement on top.

Rates and names are illustrative, not real teachers — that is the point of drawing the device rather than screenshotting production data.

- [ ] **Step 1: Create it**

First create `src/lib/scene-urls.ts`. It is imported by both this server
component and Task 6's client component; keeping it in `site-device.tsx`
would pull that whole component into the client bundle.

```typescript
// The URL strip carries the domain, which is unsettled (spec §12). One
// constant, one line to change.
const DOMAIN = "smbtutorials.com";

export const SCENE_URLS = [
  `${DOMAIN}/find`,
  `${DOMAIN}/find`,
  `${DOMAIN}/waiting`,
  `${DOMAIN}/call`,
] as const;
```

Then `src/components/site-device.tsx`:

```tsx
// The product is the imagery (spec §6). Drawn in CSS rather than
// screenshotted: no placeholder teacher data to stage, nothing to restage
// when the UI moves, and no photograph of a child anywhere near the page.
import { SCENE_URLS } from "@/lib/scene-urls";

const TEACHERS = [
  { initials: "RA", name: "R. Azad", credential: "M.Sc Mathematics · 8 yrs", rate: "₹450/hr" },
  { initials: "SK", name: "S. Kulkarni", credential: "B.Ed · 5 yrs", rate: "₹380/hr" },
  { initials: "FN", name: "F. Nasir", credential: "M.Sc Mathematics · 12 yrs", rate: "₹600/hr" },
];

function Roster({ askingIndex }: { askingIndex?: number }) {
  return (
    <>
      <div className="border-b border-[var(--hair)] px-4 pb-3 pt-4">
        <p className="mb-1.5 font-mono text-[10px] tracking-[0.06em] text-primary">
          CBSE · CLASS 10 · MATHEMATICS
        </p>
        <h3 className="text-base font-black tracking-[-0.03em]">Online right now</h3>
      </div>
      {TEACHERS.map((t, i) => (
        <div
          key={t.initials}
          className={`flex items-center justify-between gap-3 border-b border-[var(--hair)] px-4 py-3 ${
            i === askingIndex ? "bg-primary/10" : ""
          }`}
        >
          <span className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-primary/20 text-[10px] font-black">
              {t.initials}
            </span>
            <span>
              <span className="block text-sm font-semibold">{t.name}</span>
              <span className="block text-[11px] text-muted-foreground">{t.credential}</span>
            </span>
          </span>
          <span className="flex items-center gap-2.5">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{t.rate}</span>
            <span
              className={`rounded-sm bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground ${
                i === askingIndex ? "scale-90" : ""
              } transition-transform`}
            >
              Ask
            </span>
          </span>
        </div>
      ))}
    </>
  );
}

export function SiteDevice() {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center gap-1.5 border-b border-[var(--hair)] px-3 py-2.5">
        <span className="block h-2 w-2 rounded-full bg-border" />
        <span className="block h-2 w-2 rounded-full bg-border" />
        <span className="block h-2 w-2 rounded-full bg-border" />
        <span data-url className="ml-2 font-mono text-[10px] text-muted-foreground">
          {SCENE_URLS[0]}
        </span>
      </div>

      <div data-stage className="grid gap-0.5">
        <div data-scene="0">
          <Roster />
        </div>

        <div data-scene="1" className="border-t border-[var(--hair)]">
          <Roster askingIndex={0} />
        </div>

        <div data-scene="2" className="border-t border-[var(--hair)] px-5 py-11 text-center">
          <p className="mb-3 font-mono text-[11px] tracking-[0.07em] tabular-nums text-primary">
            ASKING · <span data-countdown>47</span>s LEFT
          </p>
          <h3 className="mb-1.5 text-lg font-black tracking-[-0.03em]">Waiting for R. Azad</h3>
          <p className="mb-4 text-xs text-muted-foreground">
            Mathematics · Class 10 · ₹450/hr · notified on 2 devices
          </p>
          <div className="mx-auto h-[3px] max-w-[230px] overflow-hidden rounded-sm bg-[var(--hair)]">
            <span data-progress className="block h-full w-[22%] bg-primary" />
          </div>
        </div>

        <div data-scene="3" className="border-t border-[var(--hair)]">
          <div className="grid grid-cols-2 gap-0.5 bg-foreground/10 p-0.5">
            {[
              { initials: "RA", name: "R. Azad" },
              { initials: "RV", name: "Ravi" },
            ].map((p) => (
              <div
                key={p.initials}
                className="relative grid min-h-[150px] place-items-center bg-foreground/5"
              >
                <b className="text-2xl font-black tracking-[-0.04em] opacity-50">{p.initials}</b>
                <span className="absolute bottom-2 left-2 font-mono text-[10px] text-muted-foreground">
                  {p.name}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-2 bg-foreground/10 p-3">
            <span className="block h-7 w-7 rounded-full bg-foreground/20" />
            <span className="block h-7 w-7 rounded-full bg-foreground/20" />
            <span className="block h-7 w-7 rounded-full bg-destructive" />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add src/lib/scene-urls.ts src/components/site-device.tsx
git commit -m "feat(marketing): the product drawn as the imagery, four scenes stacked"
```

---

### Task 6: Promote the stack to a scroll-driven hero

**Files:**
- Create: `src/components/hero-scroll.tsx`, `src/components/hero-scroll.test.tsx`

**Interfaces:**
- Consumes: `SCENE_URLS` from `@/lib/scene-urls` (Task 5), and the `[data-stage]` / `[data-scene]` / `[data-url]` DOM contract it renders.
- Produces: `<HeroScroll>{children}</HeroScroll>` — wraps the hero, returns children untouched when it must not enhance.

**The fallback is the default.** This component *adds* the sticky behaviour. If it never mounts — no JS, reduced motion, narrow viewport — the page is Task 5's stack, which reads correctly on its own. Scroll **position** drives the scene; scroll **speed** is never touched.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// @testing-library/user-event is not installed — see sign-out-button.test.tsx.
import { HeroScroll } from "./hero-scroll";

function mockMatchMedia(matches: Record<string, boolean>) {
  vi.stubGlobal(
    "matchMedia",
    (q: string) =>
      ({
        matches: matches[q] ?? false,
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList
  );
}

function Fixture() {
  return (
    <HeroScroll>
      <div data-stage>
        <div data-scene="0">one</div>
        <div data-scene="1">two</div>
      </div>
      <span data-url>start</span>
    </HeroScroll>
  );
}

beforeEach(() => {
  mockMatchMedia({ "(prefers-reduced-motion: reduce)": false, "(max-width: 880px)": false });
});
afterEach(() => vi.unstubAllGlobals());

describe("HeroScroll", () => {
  it("renders its children", () => {
    render(<Fixture />);
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
  });

  // The whole accessibility contract: someone who asked their OS for less
  // motion gets the stacked screenshots, not a sticky scroll performance.
  it("does not enhance under reduced motion", () => {
    mockMatchMedia({ "(prefers-reduced-motion: reduce)": true, "(max-width: 880px)": false });
    const { container } = render(<Fixture />);
    expect(container.querySelector("[data-enhanced]")).toBeNull();
  });

  it("does not enhance on a narrow viewport", () => {
    mockMatchMedia({ "(prefers-reduced-motion: reduce)": false, "(max-width: 880px)": true });
    const { container } = render(<Fixture />);
    expect(container.querySelector("[data-enhanced]")).toBeNull();
  });

  it("enhances on a wide viewport with motion allowed", () => {
    const { container } = render(<Fixture />);
    expect(container.querySelector("[data-enhanced]")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/hero-scroll.test.tsx`
Expected: FAIL — cannot resolve `./hero-scroll`.

- [ ] **Step 3: Implement**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { SCENE_URLS } from "@/lib/scene-urls";

// Which step in the track is lit for each scene. Scene 3 (the call) keeps
// step 3 lit — the lesson starting IS step three, not a fourth step.
const SCENE_TO_STEP = [0, 1, 2, 2];

export function HeroScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [enhanced, setEnhanced] = useState(false);

  useEffect(() => {
    // Read the preference at mount. Someone who asked for less motion, or is
    // on a phone, keeps the stacked screenshots — the page still teaches the
    // same flow, it just does not perform it.
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = matchMedia("(max-width: 880px)").matches;
    if (reduced || narrow) return;
    setEnhanced(true);
  }, []);

  useEffect(() => {
    const root = ref.current;
    if (!enhanced || !root) return;

    const scenes = [...root.querySelectorAll<HTMLElement>("[data-scene]")];
    const steps = [...root.querySelectorAll<HTMLElement>("[data-step]")];
    const urlEl = root.querySelector<HTMLElement>("[data-url]");
    const countdownEl = root.querySelector<HTMLElement>("[data-countdown]");
    const progressEl = root.querySelector<HTMLElement>("[data-progress]");
    if (scenes.length === 0) return;

    // Height is a function of scene count, so adding a scene never needs a
    // magic number retuned.
    root.style.height = `${scenes.length * 70}vh`;

    let current = -1;
    let ticking = false;

    const paint = (i: number) => {
      if (i === current) return;
      current = i;
      scenes.forEach((s, n) => s.setAttribute("data-on", String(n === i)));
      steps.forEach((s, n) => s.setAttribute("data-on", String(n === SCENE_TO_STEP[i])));
      if (urlEl) urlEl.textContent = SCENE_URLS[i] ?? SCENE_URLS[0];
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const rect = root.getBoundingClientRect();
        const total = root.offsetHeight - innerHeight;
        // Scroll POSITION drives the scene. Scroll SPEED is never touched —
        // hijacking it is what makes these things infuriating.
        const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
        const i = Math.min(scenes.length - 1, Math.floor(p * scenes.length));
        paint(i);

        if (i === 2 && countdownEl && progressEl) {
          const local = p * scenes.length - 2;
          countdownEl.textContent = String(Math.max(1, Math.round(47 - local * 40)));
          progressEl.style.width = `${22 + local * 66}%`;
        }
      });
    };

    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll, { passive: true });
    onScroll();
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      root.style.height = "";
    };
  }, [enhanced]);

  return (
    <div ref={ref} data-enhanced={enhanced ? "" : undefined} className="relative">
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/hero-scroll.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the enhanced-only CSS**

In `src/app/globals.css`, after the `@layer base` block:

```css
/* The stacked scenes are the default rendering — no JS, reduced motion and
   phones all keep them. HeroScroll sets data-enhanced only when it is safe
   to perform the flow instead of merely showing it. */
[data-enhanced] [data-stage] {
  display: block;
  position: relative;
  min-height: 292px;
}
[data-enhanced] [data-scene] {
  position: absolute;
  inset: 0;
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.45s ease, transform 0.45s ease;
  pointer-events: none;
  border-top: 0;
}
[data-enhanced] [data-scene][data-on="true"] {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
[data-enhanced] [data-sticky] {
  position: sticky;
  top: 4rem;
  min-height: calc(100vh - 4rem);
  display: flex;
  align-items: center;
}
[data-step] {
  opacity: 0.34;
  transition: opacity 0.4s ease;
}
[data-step][data-on="true"],
:where(:not([data-enhanced])) [data-step] {
  opacity: 1;
}
```

- [ ] **Step 6: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add src/components/hero-scroll.tsx src/components/hero-scroll.test.tsx src/app/globals.css
git commit -m "feat(marketing): the hero performs the flow, and degrades to showing it"
```

---

### Task 7: The homepage

**Files:**
- Modify: `src/app/(marketing)/page.tsx` (full rewrite — 261 lines out, 54 hardcoded colours with them)

**Interfaces:**
- Consumes: `getOnlineSnapshot` (Task 2), `SiteDevice` (Task 5), `HeroScroll` (Task 6).

Every emoji, the SVG teal grid, both Unsplash images and all 54 hardcoded colour classes leave in this task.

- [ ] **Step 1: Rewrite the page**

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HeroScroll } from "@/components/hero-scroll";
import { SiteDevice } from "@/components/site-device";
import { getOnlineSnapshot } from "@/lib/online-count.server";

const STEPS = [
  { n: "01", title: "Pick the subject", body: "Board, grade, and what they are stuck on." },
  { n: "02", title: "Ask a teacher who is online", body: "Rate shown before you choose." },
  { n: "03", title: "They accept, the lesson starts", body: "Sixty seconds to answer. You pay only then." },
];

// Spec §3: the marketing surface addresses the parent, about the child's
// moment. Only the parent can complete the action the page asks for.
const SAFETY = [
  {
    k: "VERIFIED",
    title: "Government ID, checked against the account",
    body: "Every teacher's ID is matched to the name on their account before they take a single lesson. No exceptions, including for people we know.",
  },
  {
    k: "GUARDIAN",
    title: "You hold the account, not your child",
    body: "Parents and guardians sign up. Your child is named so their teacher knows who they are teaching — they do not get a login of their own.",
  },
  {
    k: "RECORDED",
    title: "Every lesson is recorded, and kept for 30 days",
    body: "Recordings exist so a report can be checked, then they expire. Report a problem in one tap and a person reads it the same day — not a queue, not a bot.",
  },
];

const PRICING = [
  "Nothing charged until a teacher accepts.",
  "If the teacher does not join, you are refunded in full.",
  "No subscription, no minimum.",
];

export default async function HomePage() {
  const { subjects } = await getOnlineSnapshot();

  return (
    <div>
      <HeroScroll>
        <div data-sticky className="py-14">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 sm:px-8 lg:grid-cols-[1.02fr_.98fr]">
            <div>
              <h1 className="mb-5 text-balance text-4xl font-black leading-[0.94] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
                Your child is stuck. A teacher is <span className="text-primary">already online</span>.
              </h1>
              <p className="mb-7 max-w-[44ch] text-base leading-relaxed text-muted-foreground sm:text-[16.5px]">
                Qualified teachers, one to one on video, usually within a minute of asking.
                Grades 6–12 across CBSE, ICSE and State Boards.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/signup">Create your account</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/signin">See who&rsquo;s online now</Link>
                </Button>
              </div>

              <div className="mt-9 border-t border-[var(--hair)]">
                {STEPS.map((s, i) => (
                  <div
                    key={s.n}
                    data-step={i}
                    data-on={i === 0 ? "true" : "false"}
                    className="grid grid-cols-[44px_1fr] items-baseline gap-3.5 border-b border-[var(--hair)] py-3.5"
                  >
                    <span className="font-mono text-[11px] text-primary">{s.n}</span>
                    <span>
                      <b className="block text-sm font-semibold tracking-[-0.015em]">{s.title}</b>
                      <small className="text-[13px] text-muted-foreground">{s.body}</small>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <SiteDevice />
          </div>
        </div>
      </HeroScroll>

      {subjects.length > 0 && (
        <section className="relative z-[2] border-y border-border bg-card">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-6 sm:px-8">
            <span className="mr-1.5 font-mono text-[11px] tracking-[0.07em] text-primary">
              ONLINE RIGHT NOW
            </span>
            {subjects.map((s) => (
              <span
                key={s.subject}
                className="flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-[13px]"
              >
                {s.subject}
                <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
                  {s.count}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="relative z-[2] border-b border-[var(--hair)] bg-background py-16 sm:py-[70px]">
        <div className="mx-auto max-w-6xl px-6 sm:px-8">
          <p className="mb-3.5 font-mono text-[11px] tracking-[0.1em] text-primary">
            BEFORE ANYONE MEETS YOUR CHILD
          </p>
          <h2 className="mb-3 text-balance text-3xl font-black tracking-[-0.04em] sm:text-4xl">
            The part most tutoring sites leave vague.
          </h2>
          <p className="mb-10 max-w-[56ch] text-base text-muted-foreground sm:text-[16.5px]">
            You are handing a stranger a one-to-one video call with your child. Here is exactly
            what stands between them.
          </p>
          {/* 1px gaps over a ruled ground: structure carries the meaning,
              no cards and no shadows (spec §5.4). */}
          <div className="grid gap-px border border-border bg-border sm:grid-cols-[repeat(auto-fit,minmax(255px,1fr))]">
            {SAFETY.map((c) => (
              <div key={c.k} className="bg-background px-6 py-7">
                <span className="mb-3 block font-mono text-[11px] tracking-[0.07em] text-primary">
                  {c.k}
                </span>
                <h3 className="mb-2 text-base font-semibold tracking-[-0.02em]">{c.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-[2] border-b border-[var(--hair)] bg-background py-16 sm:py-[70px]">
        <div className="mx-auto grid max-w-6xl gap-14 px-6 sm:px-8 lg:grid-cols-[1.15fr_.85fr]">
          <div>
            <p className="mb-3.5 font-mono text-[11px] tracking-[0.1em] text-primary">
              WHAT IT COSTS
            </p>
            <h2 className="mb-3 text-balance text-3xl font-black tracking-[-0.04em] sm:text-4xl">
              You see the price before you commit.
            </h2>
            <p className="max-w-[56ch] text-base text-muted-foreground sm:text-[16.5px]">
              Teachers set their own hourly rate and it is shown next to their name. No
              membership, no package up front, and nothing charged until a teacher has accepted.
            </p>
          </div>
          <div className="border border-border bg-card p-6">
            <p className="mb-1.5 text-3xl font-black tracking-[-0.035em]">Per lesson</p>
            <p className="mb-4 text-sm text-muted-foreground">
              Set by the teacher, shown before you choose.
            </p>
            <ul className="grid gap-2.5">
              {PRICING.map((line, i) => (
                <li key={line} className="flex gap-2.5 text-sm text-muted-foreground">
                  <b className="pt-0.5 font-mono text-[11px] text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </b>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="relative z-[2] border-b border-border bg-card">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-14 sm:px-8 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="mb-3.5 font-mono text-[11px] tracking-[0.1em] text-primary">
              FOR TEACHERS
            </p>
            <h2 className="mb-2.5 text-balance text-3xl font-black tracking-[-0.04em] sm:text-4xl">
              Teach when you are free. Get paid per lesson.
            </h2>
            <p className="max-w-[52ch] text-base text-muted-foreground">
              Set your rate, go online when it suits you, take a lesson when a request comes in.
              Never a batch, a timetable or a target.
            </p>
          </div>
          <Button asChild size="lg" variant="outline">
            <Link href="/tutor-signup">Apply to teach</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Confirm the demo is gone**

```bash
grep -nE '(bg|text|border|from|to|via)-(teal|cyan|emerald|slate|gray)-[0-9]+' "src/app/(marketing)/page.tsx"
grep -n "unsplash" "src/app/(marketing)/page.tsx"
```

Expected: no output from either.

- [ ] **Step 3: Gates, then look at it in both themes**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
```

Then `npm run dev` and load `/`. Check: the hero performs on a wide window; narrow it under 880px and the scenes stack; the strip hides entirely when nobody is online.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(marketing)/page.tsx"
git commit -m "feat(marketing): the homepage the identity was chosen for"
```

---

### Task 8: The auth pages

**Files:**
- Modify: `src/app/(marketing)/signin/page.tsx:17`, `src/app/(marketing)/signup/page.tsx:17`, `src/app/(marketing)/tutor-signup/page.tsx`

Three of the four Unsplash hotlinks live here. Spec §6: they are removed, not replaced.

- [ ] **Step 1: Delete the image panels**

In `signin/page.tsx` and `signup/page.tsx`, delete the `<Image>`/`<img>` element hotlinking `images.unsplash.com` together with the split-panel wrapper that exists only to hold it. The form becomes a single centred column: wrap it in

```tsx
<div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-6 py-16">
```

Keep every form field, label, server action and error path exactly as it is. This task changes presentation only — if a field or a validation message moves, revert and redo.

- [ ] **Step 2: Replace hardcoded colours with tokens**

Across all three files, apply the same mapping used everywhere in this plan:

| Hardcoded | Token class |
|---|---|
| `bg-white` | `bg-card` |
| `text-gray-900` | `text-foreground` |
| `text-gray-600`, `text-gray-500` | `text-muted-foreground` |
| `border-gray-100`, `border-gray-200` | `border-border` |
| `text-teal-600`, `text-teal-700` | `text-primary` |
| `bg-teal-600`, `bg-teal-500` | `bg-primary` |
| `bg-teal-50`, `bg-teal-100` | `bg-primary/10` |
| any `from-*`/`to-*` gradient | delete — flat `bg-primary` (spec §5.4) |

- [ ] **Step 3: Remove the emoji**

`tutor-signup/page.tsx` carries emoji. Replace each with a mono eyebrow label in the same position:

```tsx
<span className="font-mono text-[11px] tracking-[0.07em] text-primary">STEP 01</span>
```

- [ ] **Step 4: Verify and commit**

```bash
grep -rn "unsplash" src/ ; echo "--- expect no output above ---"
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add "src/app/(marketing)/signin/page.tsx" "src/app/(marketing)/signup/page.tsx" "src/app/(marketing)/tutor-signup/page.tsx"
git commit -m "feat(marketing): auth pages lose the stock photography and the emoji"
```

---

### Task 9: Terms and privacy

**Files:**
- Modify: `src/app/(marketing)/terms/page.tsx` (41 hardcoded colours), `src/app/(marketing)/privacy/page.tsx` (38)

These are published legal documents. **Change presentation and the entity name only — never a clause.** If a sentence's meaning would shift, stop and raise it.

- [ ] **Step 1: Apply the token mapping**

Use the table from Task 8 Step 2. These pages are long-form prose: also set the body copy to `text-muted-foreground` and headings to `text-foreground`, and replace any `max-w-*` prose wrapper with `max-w-[70ch]` so line length is legible in both themes.

- [ ] **Step 2: One spelling**

```bash
grep -n "SMB Tutorial\b" "src/app/(marketing)/terms/page.tsx" "src/app/(marketing)/privacy/page.tsx"
```

Every hit becomes `SMB Tutorials`. Both documents name one entity when this task is done.

- [ ] **Step 3: Read the diff as prose, not as code**

```bash
git diff "src/app/(marketing)/terms/page.tsx" "src/app/(marketing)/privacy/page.tsx"
```

Confirm every change is a class name or the entity name. Any change to a clause is a defect in this task.

- [ ] **Step 4: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add "src/app/(marketing)/terms/page.tsx" "src/app/(marketing)/privacy/page.tsx"
git commit -m "feat(legal): terms and privacy on the token system, naming one entity"
```

---

### Task 10: Pin the surface against regression

**Files:**
- Create: `src/lib/marketing-copy.test.ts`

Plan 2's gains are all deletions, and deletions come back. This is the guard.

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? filesUnder(full)
      : /\.tsx?$/.test(full) && !full.endsWith(".test.ts") && !full.endsWith(".test.tsx")
        ? [full]
        : [];
  });
}

const MARKETING = filesUnder("src/app/(marketing)");
const source = (f: string) => readFileSync(f, "utf8");

describe("the marketing surface", () => {
  it("hotlinks no stock photography", () => {
    // Spec §6: no photographs of children, stock or real. Stock kids beside
    // "we verify every teacher's ID" undercuts the honesty of the claim.
    for (const f of MARKETING) expect(source(f), f).not.toMatch(/unsplash/i);
  });

  it("carries no emoji", () => {
    // Spec §5.4: replaced by structure and mono labels, not by an icon set.
    const emoji = /\p{Extended_Pictographic}/u;
    for (const f of MARKETING) expect(source(f), f).not.toMatch(emoji);
  });

  it("names the project one way", () => {
    // Spec §2. "SMB Tutorial" singular appeared on the published /privacy and
    // /terms; two legal documents naming two entities is the actual problem.
    for (const f of MARKETING) expect(source(f), f).not.toMatch(/SMB Tutorial(?!s)/);
  });

  it("has no teal left on the marketing surface", () => {
    for (const f of MARKETING) {
      expect(source(f), f).not.toMatch(/(bg|text|border|from|to|via)-(teal|cyan|emerald)-\d+/);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/marketing-copy.test.ts`
Expected: PASS, 4 tests. A failure names the offending file — fix the file, not the test.

- [ ] **Step 3: Full walk, both themes**

`npm run dev`, then walk `/`, `/signin`, `/signup`, `/tutor-signup`, `/terms`, `/privacy` in **both** themes, and once at a phone width. Check: nothing unreadable, no horizontal scroll, the hero stacks under 880px.

- [ ] **Step 4: Gates and commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
git add src/lib/marketing-copy.test.ts
git commit -m "test(marketing): pin no-emoji, no-stock-photos and one spelling"
```

---

## Done when

- [ ] `grep -rn "unsplash" src/` returns nothing.
- [ ] No emoji anywhere under `src/app/(marketing)`.
- [ ] `grep -rn "SMB Tutorial\b" src/` returns nothing — one spelling.
- [ ] The four marketing pages carry no `teal-*` / `gray-*` / `bg-white` classes.
- [ ] The homepage renders the live subject strip when teachers are declared, and hides it at zero.
- [ ] The hero performs on a wide window and stacks under reduced motion, no JS, and phone widths.
- [ ] `npx vitest run` (320+ passing), `tsc --noEmit` 0, `eslint .` 0, `npm run build` 0.
- [ ] Every screen checked in both themes.

## Not in this plan

- **The About page and the dedication.** Shelved by the owner, 2026-09-09.
- **The share card, `apple-touch-icon`, app icons, the wordmark decision.** Plan 3, gated on the domain.
- **The app screens.** Plan 3.
- **Presence-accurate counting.** This plan counts declared availability; see Task 2's caveat.
