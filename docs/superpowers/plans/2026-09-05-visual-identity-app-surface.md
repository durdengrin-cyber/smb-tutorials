# Visual Identity: The App Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the product screens onto the token system so the dark theme actually reaches them,
and close the responsive debt the audit left behind.

**Architecture:** Plan 1 built the tokens and mounted `next-themes`; plan 2 repainted the
marketing surface. The app screens were never touched, so they still carry **100 literal colour
classes** — and because shadcn's `Card` already reads `--card`, dark theme currently renders
**near-black text inside a dark card**. This plan adds the one missing token the app needs
(`--success`), repaints screen group by screen group, and grows a guard test whose pending-list
shrinks to empty as the work lands.

**Tech Stack:** Next.js 16 App Router · Tailwind v4 (`@theme inline`) · shadcn/ui · Vitest +
Testing Library · `next-themes`.

**Spec:** `docs/superpowers/specs/2026-09-05-visual-identity-design.md` — §5.2 (tokens),
§5.5 (layout, no emoji), §5.6 (responsive), §9 (scope).

## Global Constraints

- **The name is `SMB Tutorials`.** Never abbreviate it in prose, never re-spell it. It stands for
  Syedna Mohammed Burhanuddin and is not up for renaming (`CLAUDE.md`).
- **No emoji anywhere** (spec §5.5). Replace with structure and mono labels — not an icon set.
- **Both themes are first class** (spec §5.1). Every screen must be checked in light *and* dark.
- **No layout changes.** Cycle 1 settled the app's information architecture; spec §9 puts
  re-laying-out the app screens explicitly **out** of scope. Colour, type and responsive padding
  only.
- **Mono (`font-mono`, IBM Plex Mono) marks live or factual values** — counts, rates, timers, step
  numbers — against Archivo's editorial voice (spec §5.3). Do not use it decoratively.
- **Migration files carry no `begin;`/`commit;`** and this plan adds none — it touches no
  `supabase/` or `scripts/` file at all.

---

## Scope: this is plan 3 of 3, minus the assets

Spec §9 defines plan 3 as *"the app surface, the responsive pass, and the share card"*. **The
share card and the icons are not in this plan**, and the reason is not preference:

| Deferred item | Blocked by | Spec |
|---|---|---|
| `opengraph-image` (the share card) | **The domain.** The card must render a real hostname, and neither `smbtutorials.com` nor `smbtutorial.com` is confirmed owned | §7, §12.1 |
| `apple-touch-icon`, app icons 192/512/maskable | **The wordmark.** The icons should carry the mark, and whether Archivo 900 "SMB" is sufficient is undecided | §8, §12.2 |

Both were re-confirmed open by the owner on 2026-09-05. They become **plan 4**, a small
assets-only plan, the moment either unblocks. Nothing in this plan depends on them, and nothing in
them depends on this plan — so the split costs nothing.

**Also already done, ahead of schedule.** The QA round after plan 2 (`e6c4474`) did most of §5.6:
`/find` and the tutor subject picker's `grid-cols-3`, the marketing page's padding, and the hero's
middle breakpoint. Verified still true at HEAD — the only unqualified multi-column grid left in
the codebase is `flow-demo.tsx:294`, which is the two video tiles in a call and is **correct** on
a phone. What remains of the responsive pass is padding only, and it is Task 7.

---

## The problem, stated precisely

Run this at HEAD and it reproduces:

```bash
grep -rcoE '\b(bg|text|border|ring)-(gray|slate|teal|zinc|cyan|neutral|emerald|red|amber)-[0-9]{2,3}\b' \
  "src/app/(app)" "src/app/(gate)" src/components --include='*.tsx' | awk -F: '{s+=$2} END {print s}'
# 100
```

Two distinct failures hide in that number, and they need different fixes:

**1. The dark theme does not reach the app — and where it does, it breaks.** Five screens pin a
light ground with `min-h-screen bg-gray-50`, so in dark theme the page stays pale under a dark
header. Worse, `src/components/ui/card.tsx:15` already renders `bg-card text-card-foreground`,
which *is* token-driven — so a `Card` goes dark while `teacher-card.tsx:29`'s
`text-gray-900` inside it stays near-black. **Dark text on a dark card. Unreadable, today, on the
student's browse screen.**

**2. There is no semantic status token.** The palette has `--primary`, `--destructive` and the
neutrals — and nothing for "available". The dashboard expresses teacher status in raw
`emerald`/`amber`/`red` literals, which is why `status-pill.tsx` cannot be repainted by
substitution: the token it needs does not exist yet. Task 1 creates it.

### The design decision Task 1 makes, and why

The obvious move — add `--success` *and* `--warning` — is wrong here. **The brand accent is gold**
(`--primary: #d9a05b` in dark), so an amber warning token sits directly on top of the identity
colour; in dark theme "In a session" and "the brand" would be the same swatch. Shifting warning
toward orange only squeezes it between gold (hue ~33°) and `--destructive` (~0°).

So this plan adds **one** token pair and re-uses two that exist:

| Status | Token | Reasoning |
|---|---|---|
| Offline | `--muted` | Already correct. Not a state worth colour |
| Available now | **`--success`** (new) | Green is the only hue outside the warm family, deliberately. Availability is the product's core claim — *teachers online right now* — and must read instantly |
| In a session | `--primary` | The engaged state, not a warning. Using the brand colour says "you are working", and removes the collision entirely |
| Can't reach you | `--destructive` | Already exists, already correct |

**Cost if wrong:** "In a session" shares a colour with buttons. Mitigated by shape — a tinted pill
is not a button — and reversible in one file if it reads badly on the dashboard.

---

## File Structure

| File | Change | Literals |
|---|---|---|
| `src/app/globals.css` | Add `--success` / `--success-foreground` to `@theme inline`, `:root`, `.dark` | — |
| `src/lib/theme.test.ts` | Extend: assert every status token meets WCAG AA on both ground and card, in both themes | — |
| `src/app/app-surface.test.ts` | **Create.** The guard, with a `PENDING` list that shrinks to empty by Task 7 | — |
| `src/components/status-pill.tsx` | Tones onto tokens | 6 |
| `src/app/(app)/(student)/teachers/page.tsx` | Ground, padding | 3 |
| `src/app/(app)/(student)/teachers/teacher-card.tsx` | Literals, **emoji**, teal gradient | 12 |
| `src/app/(app)/(student)/teachers/online-list.tsx` | Literals, slate panel | 12 |
| `src/app/(app)/(teacher)/dashboard/page.tsx` | Ground | 2 |
| `src/app/(app)/(teacher)/dashboard/incoming-request.tsx` | Literals | 12 |
| `src/app/(app)/(teacher)/dashboard/session-history.tsx` | Literals | 13 |
| `src/app/(app)/(student)/find/page.tsx` | Literals, padding | 12 |
| `src/app/(app)/(student)/sessions/page.tsx` | Ground, padding | 4 |
| `src/app/(app)/(student)/waiting/[sessionId]/waiting-client.tsx` | Literals, padding | 13 |
| `src/app/(gate)/consent/page.tsx` | Ground | 2 |
| `src/app/(gate)/consent/consent-form.tsx` | Literals | 5 |
| `src/components/notification-setup.tsx` | Ground, literals | 4 |

**The substitution table**, used by every repaint task. Derived from the tally of what the app
surface actually uses (`text-gray-900` ×22, `text-gray-600` ×17, and so on):

| Literal | Token |
|---|---|
| `text-gray-900`, `text-slate-700` on a surface | `text-foreground` |
| `text-gray-600`, `text-gray-500`, `text-gray-700` | `text-muted-foreground` |
| `bg-gray-50`, `bg-slate-50` as a **page ground** | `bg-background` |
| `bg-gray-50`, `bg-slate-50` as an **inset panel** | `bg-muted` |
| `border-gray-200`, `border-slate-200` | `border-border` |
| `border-gray-100`, `border-gray-50` | `border-hair` |
| `text-teal-600`, `text-teal-700` | `text-primary` |
| `border-teal-500`, `border-teal-600`, `border-teal-100` | `border-primary` |
| `bg-emerald-100` + `text-emerald-900` | `bg-success/12` + `text-success` |
| `bg-amber-50`, `bg-amber-100` + `text-amber-900` | `bg-primary/12` + `text-primary` |
| `border-amber-200` | `border-primary/30` |
| `bg-red-50`, `bg-red-100` + `text-red-700`, `text-red-900` | `bg-destructive/12` + `text-destructive` |
| `border-red-200` | `border-destructive/30` |
| `from-teal-50 to-cyan-50` (gradient) | delete the gradient; use `bg-muted` |

---

### Task 1: The status token, and the pill that proves it

Nothing else can be repainted until `--success` exists — `status-pill.tsx` is the one file whose
literals have no token to move to.

**Files:**
- Modify: `src/app/globals.css` (`@theme inline`, `:root`, `.dark`)
- Modify: `src/lib/theme.test.ts`
- Modify: `src/components/status-pill.tsx:10-34`
- Create: `src/app/app-surface.test.ts`

**Interfaces:**
- Consumes: `contrastRatio` from `src/lib/contrast.ts` — already exists, already tested
  (`src/lib/contrast.test.ts`). Signature: `contrastRatio(a: string, b: string): number`, hex in,
  WCAG ratio out. **Do not write a new one.**
- Produces: the CSS custom properties `--success` / `--success-foreground`, the Tailwind utilities
  `bg-success`, `text-success`, `bg-success/12`; and `src/app/app-surface.test.ts` exporting
  nothing but owning the `PENDING` list every later task edits.

- [ ] **Step 1: Write the failing contrast test**

In `src/lib/theme.test.ts`, add the import **at the top** beside the existing ones, and the
`describe` block at the **end** of the file. `describe`/`it`/`expect` and the module-level `css`
constant are already there — do not re-declare them.

```ts
// top of the file, with the other imports
import { contrastRatio } from "@/lib/contrast";

// ...then, at the end of the file:

// Parses one theme block into { tokenName: hex }. Only hex values — the radius
// and font tokens are not colours and must not reach contrastRatio.
function palette(selector: string): Record<string, string> {
  const block = css.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

// Status colour is the one place where "it looks fine to me" is worth least:
// these are the pills a teacher reads at a glance to know whether students can
// see them. AA against BOTH the page ground and a card, because the pills
// appear on both. Tested against the strong colour rather than the /12 tint —
// the tint composites toward the ground, so this is the conservative check.
describe("status colour is legible in both themes", () => {
  const themes: Record<string, Record<string, string>> = {
    light: palette(":root"),
    dark: palette("\\.dark"),
  };

  for (const [theme, t] of Object.entries(themes)) {
    for (const key of ["success", "primary", "destructive"]) {
      it(`${theme}: --${key} meets AA on the ground and on a card`, () => {
        expect(t[key], `--${key} missing from ${theme}`).toBeTruthy();
        expect(contrastRatio(t[key], t.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t[key], t.card)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: the two `--success` cases FAIL with `--success missing from light` / `from dark`. The
`primary` and `destructive` cases should already PASS — if they do not, stop and report it, because
that means an existing token fails AA and this plan's substitution table would spread it.

- [ ] **Step 3: Add the token to all three places in `globals.css`**

These values were computed against `src/lib/contrast.ts` before being written here, so Step 4
passes on the first run. Light `#2f6b46`: 5.69 on the ground, 6.34 on a card. Dark `#7fc79b`:
8.44 and 7.79.

In `@theme inline` (beside the other `--color-*` lines):

```css
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
```

In `:root` (beside `--destructive`):

```css
  --success: #2f6b46;
  --success-foreground: #fbf8f5;
```

In `.dark` (beside `--destructive`):

```css
  --success: #7fc79b;
  --success-foreground: #231a28;
```

> The existing "defines the same tokens in both themes" test in `theme.test.ts` covers the classic
> mistake here — adding it to one block and forgetting the other. Do not skip running the whole
> file.

- [ ] **Step 4: Run the token tests**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: PASS, all cases.

> ⚠ `--primary` in light is `#8f5f2b` at **4.91** — it passes, with little headroom. If a future
> palette tweak drops it below 4.5 this test goes red. That is the intended behaviour, not a
> brittle test.

- [ ] **Step 5: Repaint the pill's tones**

In `src/components/status-pill.tsx`, replace the four `tone` values only. Leave every label and
description **byte-identical** — `status-pill.test.tsx` and
`availability-toggle.test.tsx:110` both assert on that copy, and one of them matches an exact
string.

```ts
  offline: {
    label: "Offline",
    description: "You are not visible to students.",
    tone: "bg-muted text-muted-foreground",
  },
  available: {
    label: "Available now",
    description: "Students can see you and start a session.",
    tone: "bg-success/12 text-success",
  },
  in_session: {
    label: "In a session",
    description:
      "Hidden from students while you finish this session. You'll be visible again automatically.",
    // --primary, not a warning colour: the brand accent IS gold, so an amber
    // "warning" token would be the same swatch as the identity in dark theme.
    // This state is engagement, not alarm.
    tone: "bg-primary/12 text-primary",
  },
  unreachable: {
    label: "Can't reach you",
    description:
      "You're marked available, but we can't reach your device, so students aren't being shown to you.",
    tone: "bg-destructive/12 text-destructive",
  },
```

- [ ] **Step 6: Create the guard, with everything still pending**

Create `src/app/app-surface.test.ts`. It mirrors `src/app/(marketing)/marketing.test.ts`, with two
differences: a wider literal regex (the app surface also uses `emerald`/`amber`/`red`, which
marketing never did), and a `PENDING` list that shrinks task by task.

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Walk the product surface, plus the two shared components that carry literals.
const files: string[] = [
  "src/components/status-pill.tsx",
  "src/components/notification-setup.tsx",
];
for (const dir of ["src/app/(app)", "src/app/(gate)"]) {
  (function walk(d: string) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx")) files.push(p);
    }
  })(dir);
}

// Files not yet repainted. This list only ever SHRINKS — a task that cannot
// empty its own entries is not done. Task 7 asserts it reaches zero, after
// which this file becomes a plain regression guard like the marketing one.
const PENDING = new Set([
  "src/components/notification-setup.tsx",
  "src/app/(app)/(student)/teachers/page.tsx",
  "src/app/(app)/(student)/teachers/teacher-card.tsx",
  "src/app/(app)/(student)/teachers/online-list.tsx",
  "src/app/(app)/(teacher)/dashboard/page.tsx",
  "src/app/(app)/(teacher)/dashboard/incoming-request.tsx",
  "src/app/(app)/(teacher)/dashboard/session-history.tsx",
  "src/app/(app)/(student)/find/page.tsx",
  "src/app/(app)/(student)/sessions/page.tsx",
  "src/app/(app)/(student)/waiting/[sessionId]/waiting-client.tsx",
  "src/app/(gate)/consent/page.tsx",
  "src/app/(gate)/consent/consent-form.tsx",
]);

const checked = () => files.filter((f) => !PENDING.has(f));

describe("the app surface", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  // Wider than the marketing guard: the dashboard expressed teacher status in
  // raw emerald/amber/red before --success existed.
  it("takes its colour from tokens, not literals", () => {
    const literal =
      /\b(bg|text|border|ring|from|to|via)-(gray|slate|teal|zinc|cyan|neutral|emerald|red|amber|green|blue|indigo|purple|orange|yellow|rose|stone)-\d{2,3}\b/;
    for (const f of checked()) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(literal);
    }
  });

  it("uses no emoji as iconography", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const f of checked()) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(emoji);
    }
  });
});
```

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS. `status-pill.tsx` is not in `PENDING`, so the guard is already checking it — if it
fails, a literal survived Step 5.

- [ ] **Step 8: Commit**

```bash
git add src/app/globals.css src/lib/theme.test.ts src/components/status-pill.tsx src/app/app-surface.test.ts
git commit -m "feat(design): a token for 'available', because the brand accent is already gold"
```

---

### Task 2: The dark theme reaches the app

Five screens pin a **light** ground. Until this lands, flipping to dark gives a pale page under a
dark header, with dark cards on it.

**Files:**
- Modify: `src/app/(app)/(student)/teachers/page.tsx:113`
- Modify: `src/app/(app)/(student)/sessions/page.tsx:57`
- Modify: `src/app/(app)/(teacher)/dashboard/page.tsx:58`
- Modify: `src/app/(gate)/consent/page.tsx:16`
- Modify: `src/components/notification-setup.tsx:105`
- Modify: `src/app/app-surface.test.ts` (`PENDING`)

**Interfaces:**
- Consumes: `--background` / `bg-background`, which have existed since plan 1.
- Produces: nothing importable. The deliverable is that no product screen pins a ground.

- [ ] **Step 1: Remove the five files from `PENDING` — this is the failing test**

Delete these five lines from the `PENDING` set in `src/app/app-surface.test.ts`:

```ts
  "src/components/notification-setup.tsx",
  "src/app/(app)/(student)/teachers/page.tsx",
  "src/app/(app)/(teacher)/dashboard/page.tsx",
  "src/app/(app)/(student)/sessions/page.tsx",
  "src/app/(gate)/consent/page.tsx",
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/app-surface.test.ts`
Expected: FAIL on "takes its colour from tokens, not literals", with the assertion message naming
each of the five paths (the `, f` second argument to `expect` is what prints the filename).

- [ ] **Step 3: Replace the grounds**

Each is the same edit — `bg-gray-50` → `bg-background`:

```tsx
// teachers/page.tsx:113, sessions/page.tsx:57, dashboard/page.tsx:58
<div className="min-h-screen bg-background">

// consent/page.tsx:16
<div className="min-h-screen bg-background px-4 py-10 sm:px-8 sm:py-12">

// notification-setup.tsx:105
<div className="flex min-h-screen items-center justify-center bg-background px-4">
```

Then clear the remaining literals in the same five files, using the substitution table above.
`teachers/page.tsx` also has `text-gray-900` at `:126`; `sessions/page.tsx` has `text-gray-900`
at `:95`; `notification-setup.tsx` has three more.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run`
Expected: PASS. Both the guard and the existing `notification-setup.test.tsx` must be green.

- [ ] **Step 5: Look at it in both themes**

Run `npm run dev`, open `/sessions` signed in as a student, and toggle the theme in the header.
Expected: the page ground follows the theme; cards remain readable in both. **This is the step
that catches what the regex cannot** — a token used in the wrong role still passes the guard.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(design): the app screens pinned a light ground, so dark theme stopped at the header"
```

---

### Task 3: The student browse surface

The screen carrying the unreadable defect. `teacher-card.tsx` renders `text-gray-900` inside a
`Card` whose background is already `--card`.

**Files:**
- Modify: `src/app/(app)/(student)/teachers/teacher-card.tsx` (12 literals, 1 emoji, 1 gradient)
- Modify: `src/app/(app)/(student)/teachers/online-list.tsx` (12 literals)
- Modify: `src/app/app-surface.test.ts` (`PENDING`)

**Interfaces:**
- Consumes: `bg-success/12`, `text-success` from Task 1; `Card`/`CardContent` from
  `@/components/ui/card` (unchanged).
- Produces: nothing importable.

- [ ] **Step 1: Remove both files from `PENDING`**

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/app-surface.test.ts`
Expected: FAIL on **both** the literal test and the emoji test — `teacher-card.tsx:28` is
`<div className="text-6xl mb-3">🧑‍🏫</div>`, the last emoji left in the codebase outside
`(marketing)`.

- [ ] **Step 3: Replace the emoji with structure, not another icon**

Spec §5.5: emoji go, and are replaced by structure and mono labels — *nothing to commission,
nothing to maintain*. The card already has the teacher's name; the 6xl emoji was decoration
standing in for an avatar. Delete it and let the name lead, with the subject as a mono label:

```tsx
      <div className="bg-muted p-6 text-center">
        <h3 className="text-xl font-bold tracking-tight text-foreground">
          {teacher.full_name}
        </h3>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-primary">
          {teacher.subject}
        </p>
      </div>
```

That also removes `from-teal-50 to-cyan-50` — the demo's gradient, and the last teal on this
screen.

- [ ] **Step 4: Clear the remaining literals in both files**

Substitution table. Note `online-list.tsx:238`'s panel — `border-slate-200 bg-slate-50` — is an
**inset panel, not a page ground**, so it takes `border-border bg-muted`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run`
Expected: PASS, including the existing `online-list` tests.

- [ ] **Step 6: Look at `/teachers` in both themes**

Expected: teacher names are readable **inside** the cards in dark theme. That is the defect this
task exists to fix; confirm it by eye, not by the regex.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(design): dark text on a dark card — the browse screen was unreadable in dark theme"
```

---

### Task 4: The teacher dashboard

**Files:**
- Modify: `src/app/(app)/(teacher)/dashboard/incoming-request.tsx` (12 literals)
- Modify: `src/app/(app)/(teacher)/dashboard/session-history.tsx` (13 literals)
- Modify: `src/app/app-surface.test.ts` (`PENDING`)

**Interfaces:**
- Consumes: Task 1's `--success`; `StatusPill` and `STATUS_COPY` from
  `@/components/status-pill`, already repainted in Task 1 — **do not restyle the pill again here.**
- Produces: nothing importable.

- [ ] **Step 1: Remove both files from `PENDING`**

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/app-surface.test.ts`
Expected: FAIL naming both paths.

- [ ] **Step 3: Repaint, using the substitution table**

The amber and emerald here are the same status vocabulary the pill uses, so keep them consistent
with Task 1's decision: engagement/urgency takes `--primary`, success takes `--success`, failure
takes `--destructive`.

**Earnings figures in `session-history.tsx` are factual data** — spec §5.3 puts those in mono:

```tsx
<span className="font-mono text-sm tabular-nums text-foreground">
```

`tabular-nums` so a column of amounts aligns. Use the existing `Money` component
(`src/components/money.tsx`) wherever it already renders the value — do **not** reimplement
formatting.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run`
Expected: PASS, including `availability-toggle.test.tsx`, whose exact-string assertion on
`STATUS_COPY.unreachable.description` must still hold.

- [ ] **Step 5: Look at `/dashboard` in both themes**

Expected: the four availability states are distinguishable from each other at a glance, in both
themes. **If "In a session" reads as a button rather than a status, say so** — that is the one
decision in Task 1 flagged as reversible.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(design): the dashboard's status vocabulary moves onto tokens"
```

---

### Task 5: `/find`

`/sessions` is **not** in this task — Task 2 removed it from `PENDING`, which means Task 2 had to
clear all four of its literals, not just its ground. If `sessions/page.tsx` still carries any, Task 2
was not finished and the guard would already be red.

**Files:**
- Modify: `src/app/(app)/(student)/find/page.tsx` (12 literals)
- Modify: `src/app/app-surface.test.ts` (`PENDING`)

**Interfaces:**
- Consumes: the substitution table. `find/page.tsx`'s responsive grid was already fixed in
  `e6c4474` — **do not re-touch the `grid-cols-2 sm:grid-cols-3`**, only its colours.
- Produces: nothing importable.

- [ ] **Step 1: Remove `find/page.tsx` from `PENDING`**

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/app-surface.test.ts`
Expected: FAIL naming `find/page.tsx`.

- [ ] **Step 3: Repaint**

Substitution table throughout. The curriculum/stream option buttons use `border-teal-500` for the
selected state — that becomes `border-primary`, and the selected option should also carry
`bg-primary/12 text-primary` so selection survives in both themes without relying on border alone.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Look at `/find` in both themes, at phone width**

Expected: the selected curriculum is obvious in both themes. Use the browser's device toolbar at
360px — this screen is the one §5.6 named.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(design): /find onto the tokens"
```

---

### Task 6: The waiting screen and the consent gate

**Files:**
- Modify: `src/app/(app)/(student)/waiting/[sessionId]/waiting-client.tsx` (13 literals)
- Modify: `src/app/(gate)/consent/consent-form.tsx` (5 literals)
- Modify: `src/app/app-surface.test.ts` (`PENDING`)

**Interfaces:**
- Consumes: the substitution table; `--destructive` for the cancel/error surfaces.
- Produces: nothing importable.

- [ ] **Step 1: Remove both files from `PENDING`**

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/app-surface.test.ts`
Expected: FAIL naming both paths.

- [ ] **Step 3: Repaint**

`waiting-client.tsx` carries the **60-second accept countdown**, which is live factual data —
spec §5.3 puts it in mono, and it is the clearest example on the product surface:

```tsx
<span className="font-mono text-2xl tabular-nums text-foreground">
```

`tabular-nums` matters here specifically: without it the digits jitter as the countdown ticks.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run`
Expected: PASS, including the existing waiting-screen tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(design): the waiting screen and the consent gate onto the tokens"
```

---

### Task 7: The responsive remainder, and the guard closes

What is left of spec §5.6 after `e6c4474`: padding only. At 360px, `p-12` is 48px each side —
**96px of a 360px screen**, over a quarter of it, spent on nothing.

**Files:**
- Modify: `src/app/(app)/(student)/teachers/page.tsx:114,125`
- Modify: `src/app/(app)/(student)/sessions/page.tsx:58`
- Modify: `src/app/(app)/(student)/find/page.tsx:52,166`
- Modify: `src/app/(app)/(teacher)/dashboard/page.tsx:59`
- Modify: `src/app/(app)/(student)/waiting/[sessionId]/waiting-client.tsx:28`
- Modify: `src/app/app-surface.test.ts` (assert `PENDING` is empty)

**Interfaces:**
- Consumes: nothing new.
- Produces: a `PENDING`-free guard — from here on `app-surface.test.ts` is a plain regression test
  like `marketing.test.ts`.

- [ ] **Step 1: Add the closing assertion — the failing test**

Append to the `describe` in `src/app/app-surface.test.ts`:

```ts
  // The repaint is finished when nothing is exempt. Leaving an entry here
  // would let a whole file drift while the suite stayed green.
  it("has no files left unrepainted", () => {
    expect([...PENDING]).toEqual([]);
  });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/app/app-surface.test.ts`
Expected: PASS if Tasks 2–6 emptied the list. **If it fails, a previous task did not finish** —
report which paths remain rather than deleting them here.

- [ ] **Step 3: Make the four page containers responsive**

Same edit in `teachers/page.tsx:114`, `sessions/page.tsx:58`, `find/page.tsx:52`,
`dashboard/page.tsx:59` — phone first, full padding from `sm`:

```tsx
<div className="px-4 py-8 sm:px-8 sm:py-12">
```

- [ ] **Step 4: Make the three heavy cards responsive**

```tsx
// teachers/page.tsx:125
<CardContent className="p-6 text-center sm:p-12">

// waiting-client.tsx:28
<Card className="w-full max-w-md p-6 text-center shadow-xl sm:p-12">

// find/page.tsx:166
<CardContent className="p-5 text-center sm:p-8">
```

`find/page.tsx` uses `p-5` rather than `p-6` to match the card padding `e6c4474` already set on
that screen — keep the screen internally consistent.

- [ ] **Step 5: Run the full suite and the type/lint checks**

```bash
npx vitest run && npx tsc --noEmit && npx eslint .
```
Expected: all three exit 0.

- [ ] **Step 6: Check every touched screen at 360px, in both themes**

`/find`, `/teachers`, `/sessions`, `/dashboard`, `/waiting/[id]`, `/consent`. Expected: no
horizontal scroll, no content pinched into a column narrower than its text.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(design): a quarter of a 360px screen was padding"
```

---

## Done when

- [ ] `npx vitest run` — every existing test still green, plus the new guard and contrast cases.
- [ ] `npx tsc --noEmit` 0 · `npx eslint .` 0 · `npm run build` 0.
- [ ] The literal-colour count on the app surface is **0**. Use `-h -o | wc -l`, which counts
      *occurrences*; `grep -c` counts matching lines and silently undercounts two literals sharing
      one line:
      ```bash
      grep -rhoE '\b(bg|text|border|ring|from|to|via)-(gray|slate|teal|zinc|cyan|neutral|emerald|red|amber|green|blue|indigo|purple|orange|yellow|rose|stone)-[0-9]{2,3}\b' \
        "src/app/(app)" "src/app/(gate)" src/components --include='*.tsx' | wc -l
      ```
- [ ] No emoji anywhere outside `(marketing)`'s already-guarded set — the codebase total is 0.
- [ ] `PENDING` in `app-surface.test.ts` is empty, asserted by a test.
- [ ] **Every screen checked in both themes**, and at 360px.
- [ ] `--success` meets WCAG AA on both the ground and a card, in both themes, asserted by
      `theme.test.ts` using the existing `contrastRatio`.

## Not in this plan

- **The share card (`opengraph-image`).** Blocked on the domain. Spec §7. → plan 4.
- **`apple-touch-icon` and the real app icons.** Blocked on the wordmark. Spec §8, and owed since
  the iPhone walk. → plan 4.
- **The dedication copy.** The owner's, and the footer placeholder was deliberately removed on
  2026-09-05 — `marketing-footer.tsx` says so. Do not re-add it.
- **Any app screen's layout or information architecture.** Cycle 1 settled it; spec §9 puts it
  explicitly out.
- **`support@smbtutorial.com` → the plural domain.** Blocked on the same domain decision, and
  currently the site's one visible inconsistency (`project_state.md`).
- **Product screenshots for the marketing surface** (spec §6). They need staging with placeholder
  teacher data, and they date as the UI changes — so they come *after* this plan, not during it.
