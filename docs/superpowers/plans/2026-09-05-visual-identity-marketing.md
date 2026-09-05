# Visual Identity: The Marketing Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the identity visible. Repaint every marketing page onto the tokens, build the scroll-driven hero, delete the stock photos and emoji, and settle the spelling.

**Architecture:** Nothing new is invented. Plan 1 shipped the tokens; this plan replaces hardcoded colours with the semantic classes that read them. The one genuinely new build is the scroll-driven hero, whose behaviour is already prototyped and approved.

**Tech Stack:** Next.js App Router, Tailwind v4, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-visual-identity-design.md`

**Depends on:** plan 1 (`2026-09-05-visual-identity-system.md`), which must be merged first. Repainting against tokens that do not exist means doing it twice.

## Global Constraints

- **This is plan 2 of 3.** Plan 3 is the app surface, the responsive pass (§5.6) and the share card. **Do not touch app screens here** — `/find`, `/sessions`, `/dashboard`, `/teachers`, `/setup`, `/call`, `/waiting` all belong to plan 3.
- **The About page is BLOCKED** and is deliberately not a task below. It needs the owner's dedication copy (§2, §12). Task 7 creates the route with the footer link so plan 3 has somewhere to put the copy, and nothing more.
- **Colour comes from tokens, never from a literal.** No `text-gray-700`, no `bg-white`, no `border-gray-200`. The mapping table below is the whole job.
- **Do not change copy** except where a task says so. Repainting is not rewriting.
- **Do not touch `terms/page.tsx`'s "No Recording Without Consent" clause.** Recording is a later cycle and that clause moves with four other things.
- **Gates before every commit:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .` (0 problems, warnings included), `npm run build`. Baseline after plan 1 is **308 passing / 3 skipped**.
- Watch for unescaped apostrophes — `react/no-unescaped-entities` fails the lint gate and policy prose is full of them.
- Do not push. Commit locally.

---

## The colour mapping

Every hardcoded class on these pages maps to one of these. When in doubt, `text-muted-foreground` for secondary text and `border-border` for rules.

| Hardcoded | Replace with | Why |
|---|---|---|
| `bg-white`, `bg-gray-50` | `bg-background` or `bg-card` | `card` for raised panels, `background` for the page |
| `text-gray-900`, `text-black` | `text-foreground` | |
| `text-gray-700`, `text-gray-600`, `text-gray-500` | `text-muted-foreground` | All three collapse to one role |
| `border-gray-100/200/300` | `border-border`, or `border-hair` for a subtler rule | `--hair` was added in plan 1 |
| `text-teal-600`, `text-teal-700` | `text-primary` | |
| `bg-teal-500`, `bg-teal-600`, `bg-gradient-to-br from-teal-*` | `bg-primary` | **Gradients go.** The identity is flat |
| `text-white` on a teal ground | `text-primary-foreground` | |
| `bg-teal-50` | `bg-muted` | |
| `text-red-*` | `text-destructive` | |

---

### Task 1: The homepage — the scroll-driven hero

**Files:**
- Modify: `src/app/(marketing)/page.tsx`
- Create: `src/components/marketing/flow-demo.tsx`, `src/components/marketing/flow-demo.test.tsx`

**Interfaces:**
- Produces: `<FlowDemo />` — the sticky scene-stepper. Self-contained; the page supplies nothing.

The behaviour is prototyped and approved. **Read the prototype before writing anything:** the published artifact at `https://claude.ai/code/artifact/8291fceb-9225-4727-99e1-8b07b5fad483` is the visual source of truth for scenes, pacing and fallbacks.

- [ ] **Step 1: Write the failing test**

The interesting behaviour is the fallback, because that is what most visitors get — everyone on a phone, everyone with reduced motion, and anyone before JS loads. Test that, not the scroll maths.

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FlowDemo } from "./flow-demo";

const mql = (matches: boolean) => () =>
  ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList;

beforeEach(() => { vi.stubGlobal("matchMedia", mql(false)); });

describe("FlowDemo", () => {
  // Everyone on a phone, everyone with reduced motion, and everyone before JS
  // runs sees the fallback. All four scenes must be in the DOM and readable —
  // never an empty frame waiting for scroll that will not come.
  it("renders every scene so the fallback is never blank", () => {
    render(<FlowDemo />);
    expect(screen.getByText(/online right now/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for/i)).toBeInTheDocument();
  });

  it("starts in the no-js state so the fallback is the default", () => {
    const { container } = render(<FlowDemo />);
    expect(container.querySelector("[data-flow]")).toHaveAttribute("data-ready", "false");
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run src/components/marketing/flow-demo.test.tsx`
Expected: FAIL — cannot resolve `./flow-demo`.

- [ ] **Step 3: Build the component**

Port the prototype's markup and script. Non-negotiables, each of which the prototype gets right:

- **`"use client"`** — it listens to scroll.
- **`data-ready="false"` is the initial state**, flipped to `"true"` by an effect. The CSS keys the stacked fallback off `false`, so the fallback is what renders before JS and if JS never runs.
- **Scroll position drives scenes; scroll speed is never touched.** Compute progress from `getBoundingClientRect()` against `offsetHeight - innerHeight`.
- **Throttle with `requestAnimationFrame`**, and register the listener `{ passive: true }`.
- **Section height is derived**: `scenes.length * 70` vh, so adding a scene never needs a magic number retuned.
- **Collapse to stacked scenes** under `prefers-reduced-motion: reduce` and at `max-width: 880px`, **in CSS** so it holds before JS.
- Colours come from tokens. The prototype uses raw hex because it is standalone; here everything is `bg-card`, `text-muted-foreground`, `border-border`, `text-primary`.

- [ ] **Step 4: Replace the homepage hero and kill the stock photos**

In `src/app/(marketing)/page.tsx`:
- Replace the existing hero with `<FlowDemo />` plus the headline, sub and CTAs from the prototype.
- **Delete both `<img>` tags** pointing at `images.unsplash.com` (around lines 131 and 182) and the markup that framed them.
- **Delete the `FEATURES` and `TUTOR_BENEFITS` emoji** (📚 ⚡ 👨‍🏫 👥 💼). Replace with the prototype's structure: mono eyebrow labels and hairline-ruled cells. No icon set.
- Apply the colour mapping to everything that remains (42 hardcoded references).

- [ ] **Step 5: Verify no stock photos or emoji remain**

```
grep -n "unsplash\|images.unsplash" "src/app/(marketing)/page.tsx"
grep -nP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" "src/app/(marketing)/page.tsx"
```
Expected: no output from either.

- [ ] **Step 6: Gates and commit**

```bash
git add "src/app/(marketing)/page.tsx" src/components/marketing/
git commit -m "feat(design): the homepage performs the flow instead of describing it"
```

---

### Task 2: `/signup` and `/signin`

**Files:**
- Modify: `src/app/(marketing)/signup/page.tsx`, `signup/signup-form.tsx`, `signin/page.tsx`, `signin/signin-form.tsx`

- [ ] **Step 1: Delete the stock photo**

`signup/page.tsx:16` hotlinks an Unsplash photo captioned "Happy students learning". Remove the `<img>` and whatever column framed it. **Do not replace it with another image** — spec §6 forbids photographs of children, and a signup form does not need decoration.

- [ ] **Step 2: Apply the mapping to all four files**

13 hardcoded references in `signup-form.tsx`, 11 in `signin-form.tsx`, plus the page shells.

**Leave the consent checkbox markup exactly alone** — `name="consent"`, `value="yes"` and its comment. That input having no `name` was a real production bug; it is not a styling concern.

- [ ] **Step 3: Gates and commit**

```bash
git add "src/app/(marketing)/signup" "src/app/(marketing)/signin"
git commit -m "feat(design): repaint the signup and sign-in surfaces, drop the stock photo"
```

---

### Task 3: `/tutor-signup`

**Files:**
- Modify: `src/app/(marketing)/tutor-signup/page.tsx`, `tutor-form.tsx`

- [ ] **Step 1: Apply the mapping**

27 hardcoded references in `tutor-form.tsx`. **Do not touch `subject-picker.tsx`'s `grid-cols-3`** — that is plan 3's responsive pass (§5.6).

Leave the consent checkbox and the three policy links alone.

- [ ] **Step 2: Gates and commit**

```bash
git add "src/app/(marketing)/tutor-signup"
git commit -m "feat(design): repaint the tutor signup surface"
```

---

### Task 4: `/terms` and `/privacy`

**Files:**
- Modify: `src/app/(marketing)/terms/page.tsx`, `privacy/page.tsx`

Long documents, 40 and 37 references. Mechanical, but they are the pages a cautious parent actually reads, so typography matters more here than anywhere.

- [ ] **Step 1: Apply the mapping, and set the measure**

Beyond colour: constrain running text to roughly **65–75 characters** (`max-w-[68ch]`). Both pages currently run the full container width, which is punishing at 1120px, and worse in dark.

- [ ] **Step 2: Confirm the recording clause is untouched**

```
git diff -- "src/app/(marketing)/terms/page.tsx" | grep -i "recording"
```
Expected: only whitespace or class changes. **Any wording change is a defect** — that clause moves with four other things in a later cycle.

- [ ] **Step 3: Gates and commit**

```bash
git add "src/app/(marketing)/terms" "src/app/(marketing)/privacy"
git commit -m "feat(design): repaint the legal pages and give them a readable measure"
```

---

### Task 5: One spelling

**Files:** wherever the audit finds them.

The project spells itself five ways: `SMB Tutorial`, `SMB Tutorials`, `smb-tutorials`, `smbtutorial`, `smbtutorials`. Two appear on the published legal pages, which should name one entity consistently.

- [ ] **Step 1: Find every occurrence**

```
grep -rn "SMB Tutorial\b\|SMB Tutorials\|smbtutorial" --include="*.tsx" --include="*.ts" --include="*.json" --include="*.webmanifest" src public
```

- [ ] **Step 2: Settle on `SMB Tutorials`**

Prose and the manifest use **`SMB Tutorials`**. The visible wordmark in the nav stays **`SMB`**.

**Do not change email addresses or domains in this task.** `support@smbtutorial.com` is singular and may not resolve, but that is the domain question (§12) and changing it here would print an address that does not work yet. Leave it and let the owner settle the domain.

- [ ] **Step 3: Gates and commit**

```bash
git commit -m "feat(design): the project spells its own name one way"
```

---

### Task 6: Guard what this plan removed

**Files:**
- Create: `src/app/(marketing)/marketing.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/app/(marketing)";
const files: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".tsx")) files.push(p);
  }
})(DIR);

describe("the marketing surface", () => {
  it("hotlinks no stock photography", () => {
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/unsplash/i);
    }
  });

  // Emoji were the demo's icon set. Structure and mono labels replaced them —
  // nothing to commission, nothing to maintain, and no emoji rendering
  // differently on every device a parent might use.
  it("uses no emoji as iconography", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(emoji);
    }
  });

  it("takes its colour from tokens, not literals", () => {
    const literal = /\b(bg|text|border)-(gray|slate|teal|zinc|neutral)-\d{2,3}\b/;
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(literal);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run "src/app/(marketing)/marketing.test.ts"`
Expected: PASS. A failure names the file — go and finish it.

- [ ] **Step 3: Gates and commit**

```bash
git add "src/app/(marketing)/marketing.test.ts"
git commit -m "test(design): the marketing surface cannot regress to stock photos, emoji or literal colours"
```

---

### Task 7: The About route, empty and waiting

**Files:**
- Create: `src/app/(marketing)/about/page.tsx`
- Modify: the footer, wherever it lives

**The dedication copy is the owner's to write and does not exist yet (§2, §12).** This task creates the route and the link so plan 3 has somewhere to put it — nothing more.

- [ ] **Step 1: Create the page**

Match the repainted `/privacy` shell. One section, heading "About SMB Tutorials", and a single visible paragraph explaining what the product is — **no dedication text**. Add an HTML comment marking where it goes:

```tsx
{/* The dedication goes here. Owner's copy, spec §2: worded around the value
    Syedna Mohammed Burhanuddin championed — that every child should be given
    the means to learn — never around religious authority, which would read as
    a membership marker when the audience widens beyond the community. */}
```

- [ ] **Step 2: Link it from the footer**

Beside Privacy and Terms.

- [ ] **Step 3: Verify it builds and resolves**

Run `npm run build`; `/about` must appear in the route list.

- [ ] **Step 4: Gates and commit**

```bash
git add "src/app/(marketing)/about"
git commit -m "feat(design): the About route, awaiting its dedication"
```

---

## Done when

- [ ] No `unsplash` anywhere under `(marketing)`.
- [ ] No emoji anywhere under `(marketing)`.
- [ ] No literal colour classes anywhere under `(marketing)`.
- [ ] `/about` resolves and is linked from the footer.
- [ ] One spelling of the name in prose and the manifest.
- [ ] The recording clause in `/terms` is byte-identical.
- [ ] Every page checked in **both** themes.
- [ ] `npx vitest run` (313+), `tsc --noEmit` 0, `eslint .` 0, `npm run build` 0.

## Not in this plan

- **The dedication copy.** Owner's, blocking.
- **App screens** — `/find`, `/sessions`, `/dashboard`, `/teachers`, `/setup`, `/call`, `/waiting`. Plan 3.
- **The responsive pass** (§5.6), including `subject-picker.tsx`'s `grid-cols-3` and the hero's middle breakpoint. Plan 3.
- **The share card, icons, `apple-touch-icon`.** Plan 3, blocked on the domain and the wordmark.
- **Changing `support@smbtutorial.com`.** Blocked on the domain decision.
