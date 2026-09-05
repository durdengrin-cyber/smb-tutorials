# Visual Identity: The Token System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inherited demo palette and default font with the chosen identity, and switch on the two-theme system that has been scaffolded but never activated.

**Architecture:** Everything is tokens. The 13 shadcn components already read shadcn's token names, so repainting those names repaints every component at once. `next-themes` toggles a `.dark` class on `<html>`, which the existing `@custom-variant dark (&:is(.dark *))` already understands. No component is rewritten.

**Tech Stack:** Next.js App Router, Tailwind v4 (`@theme inline`), shadcn/ui, next-themes, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-visual-identity-design.md`

## Global Constraints

- **This is plan 1 of 3.** Plan 2 is the marketing surface, plan 3 is the app surface and share card. **Do not repaint any page here.** This plan changes tokens, fonts and the theme switch — nothing else. Pages still carrying hardcoded colours keep them until plan 2; that is expected, not a bug.
- **Nothing visible should change except colour and type.** No layout, spacing, or copy changes. If a screen's structure shifts, something is wrong.
- **The accent maps to `--primary`, NOT to `--accent`.** shadcn's `--accent` is a subtle hover background, not a brand colour. Putting gold there turns every hover state gold and leaves buttons grey. This is the single easiest thing to get wrong in this plan.
- **Light is `:root`, dark is `.dark`.** That matches the existing file and shadcn's convention. Do not invert it.
- Both themes must be checked for every change. A token correct in one theme and wrong in the other is a defect.
- **Gates before every commit:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .` (0 problems, warnings included), `npm run build`. Baseline is **300 passing / 3 skipped**.
- The build prints pre-existing `DYNAMIC_SERVER_USAGE` console noise from the marketing layout. Exit 0 is what matters.
- Do not push. Commit locally; the human decides when production deploys.

---

## The token mapping

The spec names tokens semantically; shadcn names them by role. This table is the translation, and every task below depends on it.

| Spec token | Light | Dark | shadcn token(s) it fills |
|---|---|---|---|
| `ground` | `#f6f2ee` | `#231a28` | `--background` |
| `text` | `#2e1f33` | `#f1ebe8` | `--foreground`, `--card-foreground`, `--popover-foreground` |
| `raised` | `#ffffff` | `#2b2031` | `--card`, `--popover` |
| `muted` | `#6f5c75` | `#a293a8` | `--muted-foreground` |
| `accent` | `#8f5f2b` | `#d9a05b` | **`--primary`**, `--ring` |
| `on-accent` | `#fbf8f5` | `#231a28` | `--primary-foreground` |
| `rule` | `#e3d9dd` | `#3a2f40` | `--border`, `--input` |
| `hair` | `#ece4e6` | `#322739` | `--hair` (new — shadcn has no subtler border) |

Two shadcn tokens have no spec equivalent and are derived:
- `--muted` (a surface, not text) — light `#efe9ea`, dark `#2a2030`.
- `--accent` / `--accent-foreground` (hover background) — light `#efe9ea` / `#2e1f33`, dark `#332839` / `#f1ebe8`.

`--destructive` stays a red but is warmed to sit in this palette: light `#a33232`, dark `#e08585`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/layout.tsx` | Fonts, `suppressHydrationWarning`, mounts the provider |
| `src/app/globals.css` | The palette, both themes, font variable wiring |
| `src/components/theme-provider.tsx` | **New.** Thin `next-themes` wrapper |
| `src/components/theme-toggle.tsx` | **New.** The control |
| `src/components/theme-toggle.test.tsx` | **New.** Its test |
| `src/components/app-shell.tsx` | Hosts the toggle for signed-in users |
| `src/components/marketing-header.tsx` | Hosts the toggle for signed-out users |
| `src/lib/theme.test.ts` | **New.** Regression guard against the old palette |

---

### Task 1: Swap the typefaces

**Files:**
- Modify: `src/app/layout.tsx:1-13`, `src/app/globals.css:13-15`, `:55-57`

**Interfaces:**
- Produces: CSS variables `--font-archivo`, `--font-plex-mono`, consumed by `--font-sans` / `--font-mono`.

- [ ] **Step 1: Replace the font imports**

In `src/app/layout.tsx`, replace lines 1–13's font block:

```typescript
import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Archivo carries the identity: 900 tracked tight is the voice (spec §5.3).
// 400-600 do the ordinary work.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "900"],
});

// Mono is not decoration: it marks what is live or factual — the online count,
// step numbers, rates, timers — against Archivo's editorial voice.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});
```

- [ ] **Step 2: Update the `<html>` className**

```tsx
      className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}
```

- [ ] **Step 3: Re-point the CSS font variables**

`src/app/globals.css` lines 13–15 currently read `--font-sans: var(--font-geist-sans);` etc. Replace with:

```css
  --font-sans: var(--font-archivo);
  --font-mono: var(--font-plex-mono);
  --font-heading: var(--font-sans);
```

And line 55–57's `body` rule:

```css
body {
  font-family: var(--font-archivo), ui-sans-serif, system-ui, sans-serif;
}
```

- [ ] **Step 4: Confirm Geist is gone**

Run: `grep -rn "geist\|Geist" src/ --include="*.ts" --include="*.tsx" --include="*.css"`
Expected: **no output.** Any hit is a missed reference.

- [ ] **Step 5: Gates**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npm run build`
Expected: 300 passing / 3 skipped, tsc 0, eslint 0, build 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "feat(design): Archivo and IBM Plex Mono replace Next's default font"
```

---

### Task 2: Repaint both themes

**Files:**
- Modify: `src/app/globals.css:59-93` (`:root`), `:95-128` (`.dark`)

**Interfaces:**
- Produces: the palette every shadcn component reads. Adds `--hair`.

- [ ] **Step 1: Replace the `:root` block (light)**

Keep `--radius: 0.625rem` and the `--chart-*` and `--sidebar-*` families — nothing reads the charts yet, but leave them consistent rather than dangling.

```css
/* Light. The base theme: :root is light, .dark is the variant, matching
   shadcn's convention and the existing @custom-variant. Spec §5.2.
   Note --primary carries the brand accent. shadcn's --accent is a hover
   surface, not a brand colour — see the plan's mapping table. */
:root {
  --background: #f6f2ee;
  --foreground: #2e1f33;
  --card: #ffffff;
  --card-foreground: #2e1f33;
  --popover: #ffffff;
  --popover-foreground: #2e1f33;
  /* Bronze, not the gold used on dark: on a pale ground the lighter value
     fails as a link colour. Same hue, two jobs. */
  --primary: #8f5f2b;
  --primary-foreground: #fbf8f5;
  --secondary: #efe9ea;
  --secondary-foreground: #2e1f33;
  --muted: #efe9ea;
  --muted-foreground: #6f5c75;
  --accent: #efe9ea;
  --accent-foreground: #2e1f33;
  --destructive: #a33232;
  --destructive-foreground: #fbf8f5;
  --border: #e3d9dd;
  --hair: #ece4e6;
  --input: #e3d9dd;
  --ring: #8f5f2b;
  --chart-1: #8f5f2b;
  --chart-2: #6f5c75;
  --chart-3: #2e1f33;
  --chart-4: #b4884f;
  --chart-5: #a8909f;
  --radius: 0.625rem;
  --sidebar: #ffffff;
  --sidebar-foreground: #2e1f33;
  --sidebar-primary: #8f5f2b;
  --sidebar-primary-foreground: #fbf8f5;
  --sidebar-accent: #efe9ea;
  --sidebar-accent-foreground: #2e1f33;
  --sidebar-border: #e3d9dd;
  --sidebar-ring: #8f5f2b;
}
```

- [ ] **Step 2: Replace the `.dark` block**

The 34 lines there now are shadcn's stock inverted greys, never designed and never activated.

```css
/* Dark. Aubergine-black, not neutral black: warm, not clinical (spec §5.1). */
.dark {
  --background: #231a28;
  --foreground: #f1ebe8;
  --card: #2b2031;
  --card-foreground: #f1ebe8;
  --popover: #2b2031;
  --popover-foreground: #f1ebe8;
  --primary: #d9a05b;
  --primary-foreground: #231a28;
  --secondary: #2a2030;
  --secondary-foreground: #f1ebe8;
  --muted: #2a2030;
  --muted-foreground: #a293a8;
  --accent: #332839;
  --accent-foreground: #f1ebe8;
  --destructive: #e08585;
  --destructive-foreground: #231a28;
  --border: #3a2f40;
  --hair: #322739;
  --input: #3a2f40;
  --ring: #d9a05b;
  --chart-1: #d9a05b;
  --chart-2: #a293a8;
  --chart-3: #f1ebe8;
  --chart-4: #b4884f;
  --chart-5: #7d6f84;
  --radius: 0.625rem;
  --sidebar: #2b2031;
  --sidebar-foreground: #f1ebe8;
  --sidebar-primary: #d9a05b;
  --sidebar-primary-foreground: #231a28;
  --sidebar-accent: #332839;
  --sidebar-accent-foreground: #f1ebe8;
  --sidebar-border: #3a2f40;
  --sidebar-ring: #d9a05b;
}
```

- [ ] **Step 3: Expose `--hair` to Tailwind**

In the first `@theme inline` block (around line 10), beside the existing colour mappings, add:

```css
  --color-hair: var(--hair);
```

- [ ] **Step 4: Confirm the old teal is gone**

Run: `grep -rn "0f766e\|teal-" src/ --include="*.css"`
Expected: no output from `globals.css`. Hits in `.tsx` pages are expected and belong to plan 2.

- [ ] **Step 5: Gates, then look at it**

Run the four gates, then `npm run dev` and load `/dashboard` and `/sessions`. They should be recognisably the same screens in a new palette. **Structure must not move.** If anything shifted position, a token was mapped to the wrong role.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(design): the chosen palette replaces the demo's teal and stock greys"
```

---

### Task 3: Mount the theme provider

**Files:**
- Create: `src/components/theme-provider.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `<ThemeProvider>`, which adds `.dark` to `<html>`. Task 4's toggle depends on it.

`next-themes` is already a dependency and `sonner.tsx` already calls `useTheme()` — but no provider is mounted, so all of it is inert today.

- [ ] **Step 1: Create the provider**

```tsx
"use client";

import { ThemeProvider as NextThemes } from "next-themes";

// attribute="class" because globals.css keys dark off `.dark`
// (@custom-variant dark (&:is(.dark *))), which is shadcn's convention.
//
// defaultTheme="system": the device already knows the person's preference —
// usually because they set it by time of day. Spec §5.1 rejects switching on
// time ourselves; a page changing under someone mid-read guesses wrong
// constantly.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}
```

- [ ] **Step 2: Mount it, and silence the hydration warning**

`next-themes` writes the class before React hydrates, so the server and client markup differ by design. Without `suppressHydrationWarning` React logs an error on every load.

```tsx
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
```

- [ ] **Step 3: Verify it actually switches**

Run `npm run dev`, open any page, and in devtools set the OS/browser to dark. `<html>` should gain `class="… dark"`. Then check the console: **no hydration warning.** If one appears, `suppressHydrationWarning` is missing or misplaced.

- [ ] **Step 4: Gates and commit**

```bash
git add src/components/theme-provider.tsx src/app/layout.tsx
git commit -m "feat(design): mount next-themes, which shipped inert until now"
```

---

### Task 4: The toggle

**Files:**
- Create: `src/components/theme-toggle.tsx`, `src/components/theme-toggle.test.tsx`

**Interfaces:**
- Consumes: `ThemeProvider` (Task 3). Produces: `<ThemeToggle />` for Task 5.

- [ ] **Step 1: Write the failing test**

Read `src/components/sign-out-button.test.tsx` first and follow its rendering conventions.

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state = vi.hoisted(() => ({ theme: "dark", setTheme: vi.fn() }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: state.theme, setTheme: state.setTheme }),
}));

import { ThemeToggle } from "./theme-toggle";

beforeEach(() => {
  state.theme = "dark";
  state.setTheme = vi.fn();
});

describe("ThemeToggle", () => {
  it("offers the theme you are not in", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /light/i })).toBeInTheDocument();
  });

  it("switches to the other theme when pressed", async () => {
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button"));
    expect(state.setTheme).toHaveBeenCalledWith("light");
  });

  it("offers dark when the resolved theme is light", () => {
    state.theme = "light";
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/theme-toggle.test.tsx`
Expected: FAIL — cannot resolve `./theme-toggle`.

- [ ] **Step 3: Implement**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

// resolvedTheme, not theme: "system" is a real value of `theme`, and a control
// labelled "Switch to system" tells the person nothing about what they will
// see. resolvedTheme is always "light" or "dark".
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server cannot know the device preference, so the first client render
  // must match the server's. Rendering the label before mount produces a
  // hydration mismatch and, worse, a control that briefly names the wrong
  // theme.
  useEffect(() => setMounted(true), []);

  const next = resolvedTheme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={mounted ? `Switch to ${next} theme` : "Switch theme"}
      className="font-mono text-[11px] tracking-[0.05em] uppercase text-muted-foreground border border-border rounded-sm px-2.5 py-1.5 hover:text-foreground hover:border-primary transition-colors"
    >
      {mounted ? next : "     "}
    </button>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/theme-toggle.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Gates and commit**

```bash
git add src/components/theme-toggle.tsx src/components/theme-toggle.test.tsx
git commit -m "feat(design): a theme toggle that names the theme you will get"
```

---

### Task 5: Put the toggle where people are

**Files:**
- Modify: `src/components/app-shell.tsx`, `src/components/marketing-header.tsx`

- [ ] **Step 1: `marketing-header.tsx` — group the toggle with the CTA**

The sign-in `Button` is currently a bare child of the flex row. Wrap it so the toggle sits beside it. Add `import { ThemeToggle } from "@/components/theme-toggle";` at the top, then replace lines 19–23:

```tsx
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button asChild>
            <Link href={signedIn ? "/home" : "/signin"}>
              {signedIn ? "Go to your dashboard" : "Sign in"}
            </Link>
          </Button>
        </div>
```

- [ ] **Step 2: `app-shell.tsx` — add to the existing right-hand group**

A group already exists here; the toggle goes between the name and sign-out, so the destructive action stays last. Add the same import, then:

```tsx
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {identity.fullName}
            </span>
            <ThemeToggle />
            <SignOutButton />
          </div>
```

Both headers are **server components** and must stay that way. `ThemeToggle` carries its own `"use client"`, so importing and rendering it is fine — do **not** add `"use client"` to either header. Doing so would drag the whole shell to the client.

Leave everything else in both files alone — the logo lockup and the "One Student, One Teacher" tagline are plan 2's business.

- [ ] **Step 3: Verify by hand, in both**

Run `npm run dev`. On a signed-out page and a signed-in page: the toggle appears, pressing it flips the whole page, and the choice survives a reload.

- [ ] **Step 4: Gates and commit**

```bash
git add src/components/app-shell.tsx src/components/marketing-header.tsx
git commit -m "feat(design): the toggle reaches signed-in and signed-out headers"
```

---

### Task 6: Guard the palette against regression

**Files:**
- Create: `src/lib/theme.test.ts`

A test, not a lint rule, because the thing worth preventing is a *specific* regression: someone reintroducing the demo's teal or Geist while plan 2 is still in flight and hardcoded colours are legitimately everywhere.

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/globals.css", "utf8");

describe("the token system", () => {
  // The demo's teal. Plans 2 and 3 remove the last page-level uses; this stops
  // it coming back into the tokens themselves.
  it("has no trace of the demo palette", () => {
    expect(css).not.toMatch(/0f766e/i);
  });

  it("has no trace of Geist", () => {
    expect(css).not.toMatch(/geist/i);
  });

  // Both themes must define every token. A token present in one and missing
  // from the other renders one theme's text on the other theme's ground.
  it("defines the same tokens in both themes", () => {
    const names = (block: string) =>
      new Set((block.match(/--[a-z0-9-]+(?=:)/g) ?? []).filter((n) => !n.startsWith("--color")));
    const root = css.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const dark = css.match(/\.dark \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(root.length).toBeGreaterThan(0);
    expect(dark.length).toBeGreaterThan(0);
    expect([...names(root)].sort()).toEqual([...names(dark)].sort());
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: PASS, 3 tests. If the third fails, a token was added to one theme and not the other — fix the palette, not the test.

- [ ] **Step 3: Full sweep, both themes**

Run `npm run dev` and walk every screen in **both** themes: `/`, `/signin`, `/signup`, `/tutor-signup`, `/terms`, `/privacy`, `/sessions`, `/find`, `/teachers`, `/dashboard`, `/setup`, `/consent`.

Pages still carrying hardcoded colours will look wrong in dark — **that is expected and is plan 2's job.** What you are checking is narrower: **nothing is unreadable because a shadcn component picked up a broken token.** Note anything that is.

- [ ] **Step 4: Gates and commit**

```bash
git add src/lib/theme.test.ts
git commit -m "test(design): pin the palette against the demo creeping back"
```

---

## Done when

- [ ] `grep -rn "geist\|Geist" src/` returns nothing.
- [ ] `globals.css` contains no `0f766e`.
- [ ] `<html>` gains `.dark` when the OS is dark, and no hydration warning appears.
- [ ] The toggle flips the page from both a signed-in and a signed-out header, and the choice survives a reload.
- [ ] Both themes define an identical token set.
- [ ] `npx vitest run` (306+ passing), `tsc --noEmit` 0, `eslint .` 0, `npm run build` 0.

## Not in this plan

- **Repainting pages.** `/` still has 42 hardcoded colour references, `/terms` 40, `/privacy` 37. Plan 2.
- **Removing the Unsplash images and emoji.** Plan 2.
- **The About page and the dedication.** Plan 2, and blocked on the owner's copy.
- **The share card, `apple-touch-icon`, app icons.** Plan 3, and blocked on the domain and the wordmark decision.
- **Any change to app screen layout.** Explicitly out — cycle 1 settled that IA.
