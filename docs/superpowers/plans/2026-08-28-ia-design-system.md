# IA + Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the app shell, role-aware routing and component layer that the product never had, and replace per-page Tailwind with a real visual language — without changing a single URL or behaviour of the live payment/video loop.

**Architecture:** Three Next.js route groups (`(marketing)`, `(app)`, `(fullscreen)`) so a page is protected by *where it lives* rather than by a check someone remembered to write. Identity and role resolve once per request in a layout via `React.cache`. shadcn/ui supplies accessible primitives; product composites sit on top; brand tokens live in `globals.css`.

**Tech Stack:** Next.js 16.3.2 (App Router) · React 19.2.8 · Tailwind v4 · shadcn/ui (Radix) · Supabase (`@supabase/ssr`) · Vitest 4 + Testing Library

**Spec:** `docs/superpowers/specs/2026-08-28-ia-design-system-design.md`

## Global Constraints

- **This is not the Next.js in your training data.** Read the relevant guide in `node_modules/next/dist/docs/` before writing app code. Known gotchas that already cost this project sessions: `middleware.ts` is deprecated in favour of `src/proxy.ts` exporting `proxy()`; `searchParams` is a `Promise`; a `"use server"` file may only export async functions; a Supabase `.select()` argument must be a single string literal or type inference collapses to `GenericStringError`.
- **No URL may change.** Route groups do not appear in paths. If any public path moves, the task is wrong.
- **No behaviour change to the M2/M3 loop.** Presence, requests, payments, refunds and the video call must work exactly as they do in production.
- **Green bar for every commit:** `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run build`. The suite starts at 113 tests / 3 skipped and only grows.
- **`.env.local` is the user's file.** Never write to it. Propose lines and let them paste.
- **Never print secrets.** Read env vars into shell variables; never `cat .env.local`.
- **`next-env.d.ts` churn is not a real edit.** `git checkout next-env.d.ts` after running dev or build.
- **Root-cause only.** If a step tempts you into a workaround, stop and say so rather than papering over it.

---

## File Structure

**Created:**
- `vitest.setup.ts` — Testing Library matchers
- `src/lib/contrast.ts` — WCAG contrast ratio, pure
- `src/lib/auth.ts` — `getIdentity` / `requireUser` / `requireRole`
- `src/lib/routes.ts` — `resolveHome`, `signInRedirect`, `canBecomeTeacher` (pure)
- `src/lib/nav.ts` — nav config per role (pure data)
- `src/components/app-shell.tsx` — the authenticated shell
- `src/components/marketing-header.tsx` — public header
- `src/components/status-pill.tsx`, `money.tsx`, `empty-state.tsx`, `page-header.tsx`
- `src/components/ui/*` — shadcn primitives
- `supabase/migrations/0006_roles_admin.sql`
- `scripts/probe-auth-providers.mjs`
- Route-group layouts, plus `loading.tsx` / `error.tsx` / `not-found.tsx` per group

**Moved (git mv, no content change in that step):** every page directory into its route group.

**Deleted:** `src/components/site-header.tsx`, `src/app/dev/`, `src/lib/payments/stub.ts` + its test.

**Not moved, and this is why the refactor is import-safe:** every cross-directory import in the app is `@/app/auth/*` or `@/app/session/*`. Both are action files with no pages, so neither moves. Verified 2026-08-28 — re-run `grep -rn 'from "@/app/' src` before starting and stop if anything else appears.

---

### Task 1: Component test infrastructure

Component tests are impossible today: `vitest.config.ts` sets `environment: "node"` and there is no JSX transform or DOM. Later tasks unit-test `StatusPill`, `Money` and the shell, so this comes first.

**Files:**
- Modify: `vitest.config.mts`
- Create: `vitest.setup.ts`, `src/test/harness.test.tsx`
- Modify: `package.json` (dev dependencies)

**Interfaces:**
- Consumes: nothing
- Produces: the ability to write `// @vitest-environment jsdom` component tests using `render` / `screen` from `@testing-library/react`

- [ ] **Step 1: Install the test dependencies**

```bash
npm install -D @testing-library/react@^16 @testing-library/jest-dom@^6 jsdom@^25 @vitejs/plugin-react@^5.2.0
```

`@testing-library/react` v16 is the first line that supports React 19; an older major will
fail against `react@19.2.8`.

**`@vitejs/plugin-react` must be v5.2.0 or newer, not v4.** v4 peers on vite `^4 || ^5`, which
forces npm to downgrade the installed `vite@8.2.2` to 7.x — a major-version downgrade of the
engine the test runner is built on, for no gain. v5.2.0 peers on vite `^4 || ^5 || ^6 || ^7 || ^8`
and dedupes onto the vite already present. After installing, confirm with `npm ls vite` that
8.2.2 is retained.

- [ ] **Step 2: Write the failing test**

Create `src/test/harness.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

describe("component test harness", () => {
  it("renders a component into a DOM and finds it by text", () => {
    render(<Greeting name="Asha" />);
    expect(screen.getByText("Hello Asha")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run src/test/harness.test.tsx`
Expected: FAIL — no JSX transform, and `toBeInTheDocument` is not a known matcher.

- [ ] **Step 4: Wire up the config**

Create `vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Replace the contents of `vitest.config.mts` with the following. **The `.mts` extension is
deliberate and must not be renamed:** `package.json` has no `"type"` field, so the package is
CommonJS, and this file uses `import.meta.dirname`, which is invalid in a CJS-interpreted
`.ts`. The extension is what unambiguously marks it ESM to any tool that loads it outside
Vite's own config bundler. `tsconfig.json`'s `**/*.mts` include glob exists for this file.

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// environment stays "node" so the existing library tests are untouched.
// Component tests opt in per file with `// @vitest-environment jsdom`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
});
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: the new harness test PASSES and all 113 existing tests still pass. If any existing test broke, the setup file is at fault — fix it here rather than carrying the breakage forward.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.mts vitest.setup.ts src/test/harness.test.tsx package.json package-lock.json
git commit -m "test: add component testing harness (jsdom + Testing Library)"
```

---

### Task 2: Design tokens and shadcn/ui primitives

**Files:**
- Create: `src/lib/contrast.ts`, `src/lib/contrast.test.ts`, `src/app/tokens.test.ts`, `components.json`, `src/components/ui/*`, `src/lib/utils.ts` (written by shadcn)
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: nothing
- Produces: `contrastRatio(hexA, hexB): number`; CSS custom properties `--primary`, `--primary-foreground`, `--destructive`, `--destructive-foreground` on `:root` in `src/app/globals.css`; shadcn primitives importable from `@/components/ui/<name>`

- [ ] **Step 1: Write the failing contrast test**

Colour choices are asserted, not eyeballed. Create `src/lib/contrast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { contrastRatio } from "./contrast";

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("is 1 for a colour against itself", () => {
    expect(contrastRatio("#0f766e", "#0f766e")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#0f766e", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#0f766e"),
      5
    );
  });

  it("accepts shorthand hex", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 1);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/contrast.test.ts`
Expected: FAIL — `Failed to resolve import "./contrast"`.

- [ ] **Step 3: Implement `contrastRatio`**

Create `src/lib/contrast.ts`:

```ts
// WCAG 2.1 relative luminance and contrast ratio. Used by the token test so a
// brand colour that fails AA fails the build instead of shipping.

function expand(hex: string): string {
  const h = hex.replace("#", "");
  return h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const h = expand(hex);
  const r = channel(parseInt(h.slice(0, 2), 16));
  const g = channel(parseInt(h.slice(2, 4), 16));
  const b = channel(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/contrast.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing token test**

Create `src/app/tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio } from "@/lib/contrast";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`));
  if (!match) throw new Error(`token --${name} not found as a hex value`);
  return match[1];
}

describe("brand tokens", () => {
  it("defines the primary pair", () => {
    expect(token("primary")).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(token("primary-foreground")).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("meets WCAG AA for normal text on the primary button", () => {
    expect(contrastRatio(token("primary"), token("primary-foreground"))).toBeGreaterThanOrEqual(4.5);
  });

  it("meets WCAG AA for destructive actions", () => {
    expect(contrastRatio(token("destructive"), token("destructive-foreground"))).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `npx vitest run src/app/tokens.test.ts`
Expected: FAIL — `token --primary not found as a hex value`.

- [ ] **Step 7: Initialise shadcn/ui**

```bash
npx shadcn@latest init
```

The CLI is v4.19.0 and no longer prompts for style/base-colour — it uses presets. Run it
non-interactively as `--preset nova --base radix --css-variables`, which is the accepted
baseline for this project (`components.json` records `"style": "radix-nova"`). It writes
`components.json`, `src/lib/utils.ts`, and a token block into `src/app/globals.css`.

**The nova preset renders `destructive` as a 10% tint** (`bg-destructive/10 text-destructive`)
rather than a solid fill. Override that in `button.tsx` and `badge.tsx` to
`bg-destructive text-destructive-foreground`: spec §9 makes actionable controls solid, a
tinted destructive button reads as low-affordance for a destructive action, and without the
override `--destructive-foreground` is a dead token whose AA test certifies a colour pair
that appears nowhere on screen. Editing generated primitives is expected — shadcn is copy-in
and you own the files.

**If this fails against Tailwind v4 / React 19 / Next 16.3.2** — the spec flags this as the cycle's main risk — stop, report the exact error, and fall back to hand-writing the same primitives directly on Radix packages. That changes effort, not architecture, and must not be silently worked around.

- [ ] **Step 8: Add the primitives**

```bash
npx shadcn@latest add button input label card badge dialog dropdown-menu select skeleton avatar separator tabs sonner
```

- [ ] **Step 9: Set the brand tokens**

In `src/app/globals.css`, inside the `:root` block shadcn wrote, set the brand pairs as **hex** (the token test parses hex):

```css
  --primary: #0f766e;              /* teal-700 — solid, not a gradient */
  --primary-foreground: #ffffff;
  --destructive: #b91c1c;          /* red-700 */
  --destructive-foreground: #ffffff;
```

teal-700 rather than the teal-500/cyan-600 gradient the demo used: teal-500 on white text is roughly 2.5:1 and fails AA outright. The test in Step 5 is what enforces this.

Also update the light-only comment at the top of the file — dark mode is **deferred**, not rejected (spec §9):

```css
/* Light-only for now. Tokens are structured so enabling dark mode is a token
   block rather than a rewrite; that is a cycle-4 decision, not a rejection. */
```

- [ ] **Step 9b: Define the type scale and motion tokens**

Spec §9 also requires an explicit type scale and motion that honours
`prefers-reduced-motion`. Append to `src/app/globals.css`:

```css
@theme inline {
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;

  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}

/* Motion is a preference, not a decoration. Anyone who has asked their OS to
   reduce motion gets none of it. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

The existing `fadeIn` keyframe and `.animate-fadeIn` class stay — `incoming-request.tsx`
uses them — but they now sit under the reduced-motion guard above.

- [ ] **Step 10: Run the token test and the full suite**

Run: `npx vitest run src/app/tokens.test.ts && npm test`
Expected: token tests PASS; whole suite green.

- [ ] **Step 11: Verify the build**

Run: `npm run build && git checkout next-env.d.ts`
Expected: clean build.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: install shadcn/ui and define contrast-checked brand tokens"
```

---

### Task 3: Admin role migration and identity resolution

**Files:**
- Create: `supabase/migrations/0006_roles_admin.sql`, `src/lib/routes.ts`, `src/lib/routes.test.ts`, `src/lib/auth.ts`
- Modify: `src/lib/supabase/proxy-session.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`
- Produces:
  - `type Role = "student" | "teacher" | "admin"`
  - `interface Identity { userId: string; role: Role; fullName: string }`
  - `resolveHome(role: Role): string`
  - `signInRedirect(pathname: string): string`
  - `getIdentity(): Promise<Identity | null>` (React-cached)
  - `requireUser(): Promise<Identity>`
  - `requireRole(role: Role): Promise<Identity>`

- [ ] **Step 1: Write the failing routing tests**

Create `src/lib/routes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveHome, signInRedirect } from "./routes";

describe("resolveHome", () => {
  it("sends a teacher to their dashboard", () => {
    expect(resolveHome("teacher")).toBe("/dashboard");
  });

  it("sends a student to find a teacher", () => {
    expect(resolveHome("student")).toBe("/find");
  });

  it("sends an admin to the admin surface", () => {
    expect(resolveHome("admin")).toBe("/admin");
  });
});

describe("signInRedirect", () => {
  it("carries the attempted path so the user returns to it", () => {
    expect(signInRedirect("/dashboard")).toBe("/signin?next=%2Fdashboard");
  });

  it("encodes query strings in the attempted path", () => {
    expect(signInRedirect("/waiting/abc?paid=1")).toBe("/signin?next=%2Fwaiting%2Fabc%3Fpaid%3D1");
  });

  it("does not loop when the attempted path is already /signin", () => {
    expect(signInRedirect("/signin")).toBe("/signin");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/routes.test.ts`
Expected: FAIL — cannot resolve `./routes`.

- [ ] **Step 3: Implement the pure routing logic**

Create `src/lib/routes.ts`:

```ts
export type Role = "student" | "teacher" | "admin";

// One place decides where a signed-in person belongs. Cycle 2 replaces the
// student branch with a real dashboard and nothing else changes.
export function resolveHome(role: Role): string {
  switch (role) {
    case "teacher":
      return "/dashboard";
    case "admin":
      return "/admin";
    default:
      return "/find";
  }
}

export function signInRedirect(pathname: string): string {
  if (pathname === "/signin") return "/signin";
  return `/signin?next=${encodeURIComponent(pathname)}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/routes.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/0006_roles_admin.sql`:

```sql
-- Cycle 3 (admin) needs a third role, and widening a CHECK against live data is
-- a migration whenever it happens. Doing it now means requireRole, the nav
-- config and the /home resolver are written once for three roles rather than
-- rewritten for a third.
--
-- No admin user is created here, and no RLS policy changes: the existing
-- profiles select policy (role = 'teacher' or id = auth.uid()) is unaffected.

alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'teacher', 'admin'));
```

- [ ] **Step 6: Apply it and verify against the live database**

Paste into the Supabase SQL editor for project `upggvzzzoxqgourjywtd`, then verify the constraint actually widened:

```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'profiles_role_check';
```

Expected: the definition includes `'admin'`. If the constraint had a different auto-generated name in `0001`, find it with
`select conname from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'c';`
and correct the migration file before continuing — do not leave the file and the database disagreeing.

- [ ] **Step 7: Expose the request path to server components**

`requireUser()` needs the current path to build `?next=`, and a Server Component cannot read it. The proxy adds it as a request header.

**First read the proxy/middleware guide in `node_modules/next/dist/docs/` for the request-header API in 16.3.2** — this project has already lost a session to assuming a Next convention. Then modify `src/lib/supabase/proxy-session.ts` so both `NextResponse.next(...)` calls carry a forwarded header:

```ts
export async function updateSession(request: NextRequest) {
  // Server Components cannot see the current path. The proxy forwards it so
  // requireUser() can build /signin?next=<attempted path>.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refreshes an expired auth token and writes the new cookies onto the
  // response. Removing this call logs users out at token expiry.
  await supabase.auth.getUser();

  return response;
}
```

- [ ] **Step 8: Implement the identity helpers**

Create `src/lib/auth.ts`:

```ts
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveHome, signInRedirect, type Role } from "@/lib/routes";

export interface Identity {
  userId: string;
  role: Role;
  fullName: string;
}

// Cached for the lifetime of one request, so a layout, a nested layout and the
// page it wraps share a single profile read instead of three.
export const getIdentity = cache(async (): Promise<Identity | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // profiles.role is authoritative. user_metadata.role is only the seed that
  // handle_new_user() reads at signup (migration 0001) — never read it here.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", user.id)
    .single();

  if (!profile) return null;
  return {
    userId: profile.id,
    role: profile.role as Role,
    fullName: profile.full_name,
  };
});

async function currentPath(): Promise<string> {
  const h = await headers();
  return h.get("x-pathname") ?? "/";
}

export async function requireUser(): Promise<Identity> {
  const identity = await getIdentity();
  if (!identity) redirect(signInRedirect(await currentPath()));
  return identity;
}

// Redirects rather than 404s: a student who lands on a teacher URL is helped,
// not stonewalled. This is a UX choice — RLS is what protects the data.
export async function requireRole(role: Role): Promise<Identity> {
  const identity = await requireUser();
  if (identity.role !== role) redirect(resolveHome(identity.role));
  return identity;
}
```

- [ ] **Step 9: Verify everything still compiles and passes**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green, 122 tests.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/0006_roles_admin.sql src/lib/routes.ts src/lib/routes.test.ts src/lib/auth.ts src/lib/supabase/proxy-session.ts
git commit -m "feat: add admin role and single-source identity resolution"
```

---

### Task 4: The `(marketing)` route group

**Files:**
- Move: `src/app/page.tsx`, `src/app/terms/`, `src/app/signin/`, `src/app/signup/`, `src/app/tutor-signup/` → under `src/app/(marketing)/`
- Create: `src/app/(marketing)/layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `src/components/marketing-header.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `<MarketingHeader signedIn={boolean} />`

- [ ] **Step 1: Move the pages**

```bash
mkdir -p "src/app/(marketing)"
git mv src/app/page.tsx "src/app/(marketing)/page.tsx"
git mv src/app/terms "src/app/(marketing)/terms"
git mv src/app/signin "src/app/(marketing)/signin"
git mv src/app/signup "src/app/(marketing)/signup"
git mv src/app/tutor-signup "src/app/(marketing)/tutor-signup"
```

- [ ] **Step 2: Verify no URL changed**

Run: `npm run build && git checkout next-env.d.ts`
Expected: the build's route list still shows `/`, `/terms`, `/signin`, `/signup`, `/tutor-signup`. If any path gained `(marketing)`, stop — the group is malformed.

- [ ] **Step 3: Create the marketing header**

Create `src/components/marketing-header.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function MarketingHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <span className="text-sm font-bold text-primary-foreground">SMB</span>
          </div>
          <div>
            <span className="block font-bold leading-tight">SMB Tutorials</span>
            <span className="block text-xs font-medium text-primary">
              One Student, One Teacher
            </span>
          </div>
        </Link>
        <Button asChild>
          <Link href={signedIn ? "/home" : "/signin"}>
            {signedIn ? "Go to your dashboard" : "Sign in"}
          </Link>
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Create the group layout and boundaries**

Create `src/app/(marketing)/layout.tsx`:

```tsx
import { getIdentity } from "@/lib/auth";
import { MarketingHeader } from "@/components/marketing-header";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getIdentity();
  return (
    <>
      <MarketingHeader signedIn={identity !== null} />
      {children}
    </>
  );
}
```

Create `src/app/(marketing)/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-16">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-5/6" />
    </div>
  );
}
```

Create `src/app/(marketing)/error.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-muted-foreground">
        That page failed to load. Trying again usually works.
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
```

Create `src/app/(marketing)/not-found.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">
        That link doesn&apos;t lead anywhere.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Back to home</Link>
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Remove every duplicate header in this group**

`src/app/(marketing)/page.tsx` inlines its own `<header>` with a duplicate logo and a
Sign In / Sign Out control (roughly lines 74–113). Delete that whole `<header>` block — the
group layout now provides it. Leave the rest of the page alone; its copy is Task 13's job.

`terms/page.tsx` and `tutor-signup/page.tsx` render `<SiteHeader />`. Delete those usages
and their imports too. **Do this here, not later:** the group layout added in Step 4 renders
a header on every page in the group, so leaving these in place would ship a visible double
header on two pages for the next five tasks. `src/components/site-header.tsx` itself stays
for now — the `(app)` pages still use it until Task 9.

- [ ] **Step 6: Verify**

Run: `npm run build && npx tsc --noEmit && npm run lint && git checkout next-env.d.ts`
Expected: clean. Then `npm run dev` and confirm `/`, `/signin`, `/signup`, `/tutor-signup`, `/terms` all render with exactly one header.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: move public pages into a (marketing) route group with one header"
```

---

### Task 5: The `(app)` and `(fullscreen)` route groups

This is the highest-churn task in the plan. It ends with **no page performing its own auth check**.

**Files:**
- Move: `src/app/dashboard/` → `src/app/(app)/(teacher)/dashboard/`; `src/app/find/`, `src/app/teachers/`, `src/app/waiting/` → `src/app/(app)/(student)/`; `src/app/call/` → `src/app/(fullscreen)/call/`
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/(teacher)/layout.tsx`, `src/app/(app)/(student)/layout.tsx`, `src/app/(fullscreen)/layout.tsx`, plus `loading.tsx` / `error.tsx` for `(app)`
- Modify: every moved `page.tsx` to drop its own gate

**Interfaces:**
- Consumes: `requireUser`, `requireRole`, `getIdentity` from `@/lib/auth`
- Produces: the guarantee that any page under `(app)` has an authenticated user, and any page under `(app)/(teacher)` has a teacher

- [ ] **Step 1: Confirm the refactor is still import-safe**

Run: `grep -rn 'from "@/app/' src`
Expected: only `@/app/auth/*` and `@/app/session/*`, neither of which moves. **If anything else appears, stop and fix those imports first** — they will break silently on the move.

- [ ] **Step 2: Move the pages**

```bash
mkdir -p "src/app/(app)/(teacher)" "src/app/(app)/(student)" "src/app/(fullscreen)"
git mv src/app/dashboard "src/app/(app)/(teacher)/dashboard"
git mv src/app/find "src/app/(app)/(student)/find"
git mv src/app/teachers "src/app/(app)/(student)/teachers"
git mv src/app/waiting "src/app/(app)/(student)/waiting"
git mv src/app/call "src/app/(fullscreen)/call"
```

- [ ] **Step 3: Verify no URL changed**

Run: `npm run build && git checkout next-env.d.ts`
Expected: `/dashboard`, `/find`, `/teachers`, `/waiting/[sessionId]`, `/call/[sessionId]` all still listed unchanged.

- [ ] **Step 4: Create the group layouts**

`src/app/(app)/layout.tsx` — the shell arrives in Task 9; for now it only gates:

```tsx
import { requireUser } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return <>{children}</>;
}
```

`src/app/(app)/(teacher)/layout.tsx`:

```tsx
import { requireRole } from "@/lib/auth";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("teacher");
  return <>{children}</>;
}
```

`src/app/(app)/(student)/layout.tsx`:

```tsx
import { requireRole } from "@/lib/auth";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("student");
  return <>{children}</>;
}
```

`src/app/(fullscreen)/layout.tsx` — authenticated, but deliberately no shell so the call owns the viewport:

```tsx
import { requireUser } from "@/lib/auth";

// No shell on purpose: the video call takes the whole viewport and navigation
// during a lesson is noise. Spec §3.
export default async function FullscreenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return <>{children}</>;
}
```

- [ ] **Step 5: Delete the per-page gates**

In `src/app/(app)/(teacher)/dashboard/page.tsx`, delete these lines:

```tsx
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  ...
  if (!profile || profile.role !== "teacher") redirect("/");
```

and take the identity from the layer above instead:

```tsx
import { requireRole } from "@/lib/auth";
// ...
const identity = await requireRole("teacher");
```

The page still needs `hourly_rate`, which `getIdentity` does not carry, so keep a scoped query for it:

```tsx
const { data: profile } = await supabase
  .from("profiles")
  .select("id, full_name, hourly_rate")
  .eq("id", identity.userId)
  .single();
```

**Two gates that can disagree is the pattern this cycle exists to remove** — delete the old checks, do not leave them as belt-and-braces. Repeat for every moved page that performs its own `auth.getUser()` redirect: `find/page.tsx`, `teachers/page.tsx`, `waiting/[sessionId]/page.tsx`, `call/[sessionId]/page.tsx`. Grep for the pattern with `grep -rn "redirect(\"/signin\")\|auth.getUser()" "src/app/(app)" "src/app/(fullscreen)"` and resolve every hit.

**Leave ownership checks alone.** A gate proving *this* student owns *this* session (in `waiting` and `call`) is not an auth gate and must stay.

- [ ] **Step 6: Add `(app)` boundaries**

Create `src/app/(app)/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-12 sm:px-8">
      <Skeleton className="h-9 w-1/3" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
```

Create `src/app/(app)/error.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-muted-foreground">
        We couldn&apos;t load that. Your session and any payment are unaffected.
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
```

Create `src/app/(app)/not-found.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-muted-foreground">
        That page doesn&apos;t exist, or it isn&apos;t yours to see.
      </p>
      <Button asChild className="mt-6">
        <Link href="/home">Back to your home</Link>
      </Button>
    </div>
  );
}
```

- [ ] **Step 7: Verify by hand, not just by build**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && git checkout next-env.d.ts`

Then `npm run dev` and confirm:
- Signed out, `/dashboard` → `/signin?next=%2Fdashboard`. **Only the bounce is verifiable in
  this task.** `signIn` still hardcodes `redirect("/")` and does not read `next` until Task 7,
  so the return trip cannot work yet — Task 7's Step 5 is where that half is verified. Do not
  fix `signIn` here; it is out of this task's file list.
- A student visiting `/dashboard` → `/find`.
- A teacher visiting `/find` → `/dashboard`.
- `/call/<id>` renders with no navigation chrome.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: gate authenticated pages by route group instead of per page"
```

---

### Task 6: Route-group invariant test, and deleting the payment spike

**Files:**
- Create: `src/app/route-groups.test.ts`
- Delete: `src/app/dev/`, `src/lib/payments/stub.ts`, `src/lib/payments/stub.test.ts`
- Modify: `src/lib/payments/index.ts`

**Interfaces:**
- Consumes: the group structure from Tasks 4 and 5
- Produces: a test that fails if any page is added outside a group

- [ ] **Step 1: Write the failing invariant test**

Create `src/app/route-groups.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const APP = join(process.cwd(), "src", "app");
const GROUPS = ["(marketing)", "(app)", "(fullscreen)"];

function findPages(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findPages(full, found);
    else if (entry.name === "page.tsx") found.push(full);
  }
  return found;
}

describe("route groups", () => {
  // A page outside a group has no layout above it, therefore no auth gate.
  // This is what makes "protected because of where it lives" a guarantee
  // rather than a convention someone has to remember.
  it("puts every page inside a route group", () => {
    const offenders = findPages(APP)
      .map((p) => relative(APP, p))
      .filter((rel) => !GROUPS.includes(rel.split(sep)[0]));
    expect(offenders).toEqual([]);
  });

  it("finds the pages it is supposed to be checking", () => {
    expect(findPages(APP).length).toBeGreaterThan(5);
  });
});
```

- [ ] **Step 2: Run it — expect one real failure**

Run: `npx vitest run src/app/route-groups.test.ts`
Expected: FAIL, listing `dev/checkout/page.tsx`. That is the spike the spec requires gone (§3), and it is exactly what the invariant is for.

- [ ] **Step 3: Delete the spike**

```bash
git rm -r src/app/dev
git rm src/lib/payments/stub.ts src/lib/payments/stub.test.ts
```

`src/lib/payments/index.ts` is entangled with the stub in **five** places, not one. Remove
all of them:

1. Line 2 — `import { stubPort, type StubPaymentPort } from "./stub";`
2. Line 6 — `export type { StubPaymentPort } from "./stub";` (a public re-export)
3. Lines 13–22 — the `provider === "stub"` branch and its production refusal
4. Lines 39–46 — `getStubPort()`, whose only caller was `src/app/dev/checkout/actions.ts`,
   deleted above. Confirm with `grep -rn "getStubPort" src` before removing.
5. Line 48 — `paymentProviderName`'s `?? "stub"` default

**The fifth is the dangerous one and the reason this step is not cosmetic.**
`paymentProviderName()` is written into the `payment_provider` column on real money rows
(`settle.ts:126`, `settle.ts:248`, `payment-actions.ts:81`). Left as-is with the stub
deleted, an unset `PAYMENT_PROVIDER` would stamp live payments with the name of a provider
that no longer exists in the codebase.

Give both functions one shared source of truth, matching the "refuse loudly rather than
degrade quietly" stance already stated in this file's comments:

```ts
function requireProvider(): string {
  const provider = process.env.PAYMENT_PROVIDER;
  if (!provider) {
    throw new Error("PAYMENT_PROVIDER is unset — configure a real provider");
  }
  return provider;
}

export function getPaymentPort(): PaymentPort {
  const provider = requireProvider();

  if (provider === "razorpay") {
    // ...existing razorpay construction and its comment, unchanged...
  }

  throw new Error(`Unknown PAYMENT_PROVIDER: ${provider}`);
}

export const paymentProviderName = () => requireProvider();
```

Read the existing file and preserve the Razorpay branch and its comment exactly as
written — the comment about a missing webhook secret documents a real failure mode.

- [ ] **Step 4: Propose the env change (do not write it)**

`.env.local` is the user's file. Tell them: if it contains `PAYMENT_PROVIDER=stub`, it must become `PAYMENT_PROVIDER=razorpay`, and confirm the same variable is set for all three Vercel environments. **Do not edit `.env.local` yourself.**

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: the invariant test PASSES; the suite drops the stub tests and stays green otherwise. If a payments test depended on the stub, port it to the Razorpay adapter's existing test rather than restoring the stub.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: require every page to live in a route group; delete the payment spike"
```

---

### Task 7: `/home` and every post-login redirect

**Files:**
- Create: `src/app/(app)/home/page.tsx`
- Modify: `src/app/auth/actions.ts`, `src/app/(marketing)/tutor-signup/actions.ts`, `src/app/auth/callback/route.ts`, `src/app/(marketing)/signin/page.tsx`, `src/app/(marketing)/signin/signin-form.tsx`, `src/lib/routes.ts`, `src/lib/routes.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/auth`, `resolveHome` from `@/lib/routes`
- Produces: `/home` as the single post-login destination; `safeNext(next, fallback): string`

- [ ] **Step 1: Create the resolver**

Create `src/app/(app)/home/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { resolveHome } from "@/lib/routes";

// A resolver, not a page. Every sign-in path lands here and exactly one place
// decides where a role belongs. Cycle 2 replaces the student branch with the
// real student dashboard; nothing else changes.
export default async function HomePage() {
  const identity = await requireUser();
  redirect(resolveHome(identity.role));
}
```

- [ ] **Step 2: Repoint the three server actions**

In `src/app/auth/actions.ts`, change `signIn` and `signUpStudent` to `redirect("/home")`. **Leave `signOut` redirecting to `/`** — that one is already correct.

In `src/app/(marketing)/tutor-signup/actions.ts`, change its `redirect("/")` to `redirect("/home")`.

- [ ] **Step 3: Repoint the OAuth callback default**

In `src/app/auth/callback/route.ts`, change:

```ts
  const next = searchParams.get("next") ?? "/";
```

to:

```ts
  const next = searchParams.get("next") ?? "/home";
```

- [ ] **Step 3b: Write the failing test for `safeNext`**

`requireUser` sends a bounced visitor to `/signin?next=<attempted path>`, but **nothing reads
that parameter today** — `signIn` hardcodes `redirect("/")`. So the return trip does not work,
and the moment it is wired up, `next` becomes attacker-controllable input. `signInRedirect`
does not constrain its input either: `signInRedirect("//evil.example")` yields
`/signin?next=%2F%2Fevil.example`. Validate at the point of consumption.

Add to `src/lib/routes.test.ts`:

```ts
import { safeNext } from "./routes";

describe("safeNext", () => {
  it("passes through a same-origin path", () => {
    expect(safeNext("/dashboard", "/home")).toBe("/dashboard");
  });

  it("keeps the query string", () => {
    expect(safeNext("/waiting/abc?paid=1", "/home")).toBe("/waiting/abc?paid=1");
  });

  it("falls back when absent", () => {
    expect(safeNext(null, "/home")).toBe("/home");
    expect(safeNext("", "/home")).toBe("/home");
  });

  it("refuses an absolute URL", () => {
    expect(safeNext("https://evil.example/x", "/home")).toBe("/home");
  });

  it("refuses a protocol-relative URL", () => {
    expect(safeNext("//evil.example", "/home")).toBe("/home");
  });

  it("refuses a backslash-smuggled protocol-relative URL", () => {
    expect(safeNext("/\\evil.example", "/home")).toBe("/home");
  });
  // The URL parser strips ASCII tab/CR/LF from anywhere in the input before
  // parsing, so each of these collapses to "//evil.example" in a browser.
  it("refuses a tab-smuggled protocol-relative URL", () => {
    expect(safeNext("/\t/evil.example", "/home")).toBe("/home");
  });

  it("refuses CR- and LF-smuggled protocol-relative URLs", () => {
    expect(safeNext("/\r/evil.example", "/home")).toBe("/home");
    expect(safeNext("/\n/evil.example", "/home")).toBe("/home");
  });

  // Tab-stripping and backslash-normalisation compose: remove the tab and the
  // backslash becomes the second slash.
  it("refuses a tab-plus-backslash payload", () => {
    expect(safeNext("/\t\\evil.example", "/home")).toBe("/home");
  });

  it("refuses a non-string value such as an uploaded File part", () => {
    expect(safeNext(new File([""], "x"), "/home")).toBe("/home");
  });

});
```

- [ ] **Step 3c: Run it to verify it fails**

Run: `npx vitest run src/lib/routes.test.ts`
Expected: FAIL — `safeNext` is not exported.

- [ ] **Step 3d: Implement `safeNext`**

Add to `src/lib/routes.ts`:

```ts
// `next` reaches us from a query string, so it is attacker-controlled, and a
// redirect built from user input is an open redirect.
//
// Do NOT hand-roll this with prefix checks. An earlier version tested for "//"
// and "/\\" and was defeated four ways, because the WHATWG URL parser strips
// ASCII tab/CR/LF from ANYWHERE in the input before parsing, and then
// normalises backslashes to slashes. "/\t/evil.example" becomes
// "//evil.example" — protocol-relative, off-site — and "/\t\\evil.example"
// gets there by both routes at once. Enumerating bad characters is a losing
// game against a parser that rewrites its input.
//
// Instead resolve against a placeholder origin using the same parser the
// browser will use, and reject anything that escapes it. Returning the parsed
// components rather than the raw input also guarantees that no control
// character survives into a Location header.
const SAFE_NEXT_BASE = "https://smb.invalid";

export function safeNext(next: unknown, fallback: string): string {
  if (typeof next !== "string" || !next) return fallback;
  if (!next.startsWith("/")) return fallback;
  try {
    const url = new URL(next, SAFE_NEXT_BASE);
    if (url.origin !== SAFE_NEXT_BASE) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
```

`next` is typed `unknown` rather than `string | null` on purpose: `FormData.get()`
returns `FormDataEntryValue | null`, which can be a `File`. A raw POST naming `next`
as a file part would otherwise reach `.startsWith` and throw a 500. The `typeof`
guard closes that at the root, so no call site needs a cast.

- [ ] **Step 3e: Run it to verify it passes**

Run: `npx vitest run src/lib/routes.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 3f: Actually wire `next` through the password sign-in path**

Without this the bounce-and-return flow does not exist, and Step 5's manual check cannot pass.

In `src/app/(marketing)/signin/page.tsx`, read `next` alongside the existing `error`
(`searchParams` is a Promise in this Next version) and pass it to the form:

```tsx
const { error, next } = await searchParams;
```
```tsx
<SignInForm initialError={initialError} next={typeof next === "string" ? next : undefined} />
```

In `src/app/(marketing)/signin/signin-form.tsx`, accept the prop and carry it in the form so
it reaches the server action — the action receives `FormData`, not the URL:

```tsx
{next && <input type="hidden" name="next" value={next} />}
```

In `src/app/auth/actions.ts`, have `signIn` honour it, validated:

```ts
import { safeNext } from "@/lib/routes";
// ...
  const target = safeNext(formData.get("next"), "/home");
  redirect(target);
```

Also validate the OAuth callback's parameter in `src/app/auth/callback/route.ts` — it is the
same attacker-controlled input arriving by a different door:

```ts
const next = safeNext(searchParams.get("next"), "/home");
```

**Leave `signUpStudent` and `tutorSignUp` going to `/home` unconditionally.** A brand-new
account has no deep link it was bounced from, and giving them a `next` widens the attack
surface for no gain.

- [ ] **Step 4: Verify no `redirect("/")` survives on a sign-in path**

Run: `grep -rn 'redirect("/")' src/app`
Expected: exactly one hit — `signOut` in `src/app/auth/actions.ts`.

- [ ] **Step 5: Verify by hand**

Run `npm run dev`, then sign in as a teacher (lands on `/dashboard`) and as a student (lands on `/find`). Signed out, visit `/dashboard`, sign in when bounced, and confirm you return to `/dashboard` rather than `/find`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: land every sign-in path on /home and resolve by role"
```

---

### Task 8: Google OAuth intent, and a probe so provider config can't silently regress

Google is currently disabled on the Supabase project — verified 2026-08-28, `/auth/v1/authorize?provider=google` returns `400 "Unsupported provider: provider is not enabled"`. **The dashboard configuration is the user's to do** (spec §5.1). This task makes the code correct for when it is on, and adds the probe that proves it.

**Files:**
- Create: `scripts/probe-auth-providers.mjs`
- Modify: `src/lib/routes.ts`, `src/lib/routes.test.ts`, `src/components/google-button.tsx`, `src/app/(marketing)/signin/signin-form.tsx`, `src/app/(marketing)/signup/signup-form.tsx`, `src/app/(marketing)/tutor-signup/page.tsx`, `src/app/(marketing)/tutor-signup/tutor-form.tsx`, `src/app/(marketing)/tutor-signup/actions.ts`

**Interfaces:**
- Consumes: `Role` from `@/lib/routes`
- Produces: `canBecomeTeacher({ role, sessionCount, subjectCount }): boolean`; `<GoogleButton label next />`

- [ ] **Step 1: Write the failing test for the upgrade rule**

Add to `src/lib/routes.test.ts`:

```ts
import { canBecomeTeacher } from "./routes";

describe("canBecomeTeacher", () => {
  it("allows a brand-new Google account with no history", () => {
    expect(canBecomeTeacher({ role: "student", sessionCount: 0, subjectCount: 0 })).toBe(true);
  });

  it("refuses an account that has already taken sessions as a student", () => {
    expect(canBecomeTeacher({ role: "student", sessionCount: 1, subjectCount: 0 })).toBe(false);
  });

  it("refuses an account that is already a teacher", () => {
    expect(canBecomeTeacher({ role: "teacher", sessionCount: 0, subjectCount: 3 })).toBe(false);
  });

  it("refuses an admin outright", () => {
    expect(canBecomeTeacher({ role: "admin", sessionCount: 0, subjectCount: 0 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/routes.test.ts`
Expected: FAIL — `canBecomeTeacher` is not exported.

- [ ] **Step 3: Implement it**

Add to `src/lib/routes.ts`:

```ts
// Google sends no role, so handle_new_user() creates every OAuth account as a
// student (migration 0001). A brand-new account that arrived with teacher
// intent may complete teacher onboarding; an account with history may not —
// changing the role of an account that has already been used is an admin
// action, and admin is cycle 3. Spec §5.1.
export function canBecomeTeacher(account: {
  role: Role;
  sessionCount: number;
  subjectCount: number;
}): boolean {
  return account.role === "student" && account.sessionCount === 0 && account.subjectCount === 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/routes.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Let the Google button carry intent**

Replace the props and the call in `src/components/google-button.tsx`:

```tsx
export function GoogleButton({ label, next }: { label: string; next?: string }) {
```

```tsx
    const callback = new URL("/auth/callback", location.origin);
    if (next) callback.searchParams.set("next", next);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });
```

Leave the rest of the component — including its error rendering — untouched. Its markup becomes a `Button` in Task 13.

- [ ] **Step 6: Offer Google on the teacher path**

In `src/app/(marketing)/tutor-signup/page.tsx` (or `tutor-form.tsx`, wherever the form's header sits), add:

```tsx
<GoogleButton label="Sign up with Google" next="/tutor-signup" />
```

Leave `/signin` and `/signup` passing no `next`, so they default to `/home`.

- [ ] **Step 7: Let `/tutor-signup` upgrade an existing session**

`tutorSignUp` in `src/app/(marketing)/tutor-signup/actions.ts` currently always calls `supabase.auth.signUp`, which fails for a user Google already created. Branch on whether a session exists:

```ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();

if (user) {
  // Arrived via Google with teacher intent: the account exists and is a
  // student by default. Upgrade it only if it has no history.
  // Capture the whole response, not just `count`. Postgrest returns
  // `count: null` when a query FAILS as well as when it legitimately counts
  // zero — the error field is the only thing that tells them apart. Coercing
  // with `?? 0` would turn a transient failure into "this account has no
  // history" and permit exactly the silent role conversion §5.1 forbids.
  const [sessionRes, subjectRes] = await Promise.all([
    supabase.from("sessions").select("id", { count: "exact", head: true }).eq("student_id", user.id),
    supabase.from("teacher_subjects").select("teacher_id", { count: "exact", head: true }).eq("teacher_id", user.id),
  ]);

  if (sessionRes.error || subjectRes.error) {
    console.error("[tutorSignUp] history check failed", sessionRes.error ?? subjectRes.error);
    return { error: "Couldn't verify this account. Try again in a moment." };
  }

  const { data: existing } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!existing || !canBecomeTeacher({
    role: existing.role as Role,
    sessionCount: sessionRes.count ?? 0,
    subjectCount: subjectRes.count ?? 0,
  })) {
    return { error: "This account can't be converted to a teacher account. Sign out and register with a different email." };
  }

  await supabase.from("profiles")
    .update({ role: "teacher", full_name: v.fullName, phone: v.phone, hourly_rate: v.hourlyRate })
    .eq("id", user.id);
} else {
  // ...existing signUp path, unchanged...
}
```

This needs `import { canBecomeTeacher, type Role } from "@/lib/routes";` at the top of the
file. Read the existing action first and preserve its subject-writing and validation
exactly; only the account-creation branch is new.

**Note the RLS constraint:** `0001`'s update policy allows a profile to update itself (`id = auth.uid()`), so this write is permitted. If it is refused at runtime, stop and report it rather than reaching for the service role — the service role in a user-facing action would be a security regression.

- [ ] **Step 8: Write the provider probe**

Create `scripts/probe-auth-providers.mjs`, matching the existing probes' conventions — no arguments, no standing credential, non-zero exit on violation:

```js
#!/usr/bin/env node
// Asserts that the auth providers the product depends on are actually enabled
// on the live Supabase project. Google being off was invisible until someone
// clicked the button; this makes it a check rather than a discovery.
//
// Run: node scripts/probe-auth-providers.mjs
import { readFileSync } from "node:fs";

const REQUIRED = ["email", "google"];

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  process.exit(1);
}

const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
if (!res.ok) {
  console.error(`settings endpoint returned ${res.status}`);
  process.exit(1);
}

const { external = {} } = await res.json();
const missing = REQUIRED.filter((p) => !external[p]);

for (const p of REQUIRED) {
  console.log(`  ${external[p] ? "OK  " : "FAIL"} ${p}`);
}

if (missing.length) {
  console.error(`\nProviders not enabled: ${missing.join(", ")}`);
  console.error("Enable them in Supabase -> Authentication -> Providers.");
  process.exit(1);
}
console.log("\nAll required auth providers are enabled.");
```

- [ ] **Step 9: Run the probe**

Run: `node scripts/probe-auth-providers.mjs`
Expected **today**: exits 1 reporting `google` not enabled. That is correct and is the bug being tracked — it turns green once the user completes the dashboard steps. Do not weaken the probe to make it pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: carry signup intent through Google OAuth; probe provider config"
```

---

### Task 9: The app shell and role-aware navigation

**Files:**
- Create: `src/lib/nav.ts`, `src/lib/nav.test.ts`, `src/components/app-shell.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `Identity`, `Role`
- Produces: `NAV: Record<Role, NavItem[]>`, `<AppShell identity>`

- [ ] **Step 1: Write the failing nav test**

Create `src/lib/nav.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NAV } from "./nav";
import { resolveHome } from "./routes";

describe("nav config", () => {
  it("gives a teacher their dashboard", () => {
    expect(NAV.teacher.map((i) => i.href)).toContain("/dashboard");
  });

  it("gives a student the find flow", () => {
    expect(NAV.student.map((i) => i.href)).toContain("/find");
  });

  it("never shows a role a link it cannot reach", () => {
    expect(NAV.student.map((i) => i.href)).not.toContain("/dashboard");
    expect(NAV.teacher.map((i) => i.href)).not.toContain("/find");
  });

  it("starts each role at a link it actually has", () => {
    for (const role of ["student", "teacher"] as const) {
      expect(NAV[role].map((i) => i.href)).toContain(resolveHome(role));
    }
  });

  it("labels every item", () => {
    for (const items of Object.values(NAV)) {
      for (const item of items) expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/nav.test.ts`
Expected: FAIL — cannot resolve `./nav`.

- [ ] **Step 3: Implement the config**

Create `src/lib/nav.ts`:

```ts
import type { Role } from "@/lib/routes";

export interface NavItem {
  href: string;
  label: string;
}

// Data, not markup: cycles 2 and 3 add surfaces by adding entries here rather
// than by rewriting the shell. Thin today because only two surfaces exist —
// a nav pointing at pages that do not exist is the same defect as marketing
// copy advertising features that do not exist.
export const NAV: Record<Role, NavItem[]> = {
  student: [{ href: "/find", label: "Find a teacher" }],
  teacher: [{ href: "/dashboard", label: "Dashboard" }],
  admin: [{ href: "/admin", label: "Admin" }],
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/nav.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Build the shell**

Create `src/components/app-shell.tsx`:

```tsx
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { NAV } from "@/lib/nav";
import type { Identity } from "@/lib/auth";
import { Button } from "@/components/ui/button";

// Responsive by construction: a top bar everywhere, plus a bottom tab bar on
// small screens. The product is built for whatever device someone has, not for
// a device we assumed (spec §6).
export function AppShell({
  identity,
  children,
}: {
  identity: Identity;
  children: React.ReactNode;
}) {
  const items = NAV[identity.role];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <Link href="/home" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <span className="text-xs font-bold text-primary-foreground">SMB</span>
            </div>
            <span className="hidden font-bold sm:inline">SMB Tutorials</span>
          </Link>

          <nav className="hidden gap-1 sm:flex">
            {items.map((item) => (
              <Button key={item.href} asChild variant="ghost">
                <Link href={item.href}>{item.label}</Link>
              </Button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {identity.fullName}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-20 sm:pb-0">{children}</main>

      {/* Bottom tab bar: small screens only. */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t bg-background sm:hidden">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex-1 py-3 text-center text-sm font-medium"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
```

- [ ] **Step 6: Render it from the `(app)` layout**

Replace `src/app/(app)/layout.tsx`:

```tsx
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await requireUser();
  return <AppShell identity={identity}>{children}</AppShell>;
}
```

- [ ] **Step 7: Remove the now-duplicated headers**

`SiteHeader` is rendered by `dashboard/page.tsx`, `teachers/page.tsx` and `find/page.tsx`,
which now sit inside the shell. Delete those `<SiteHeader ... />` usages and their imports.
The `(marketing)` usages were already removed in Task 4, so this leaves the component with
no callers:

```bash
grep -rn "SiteHeader" src   # expect no hits outside site-header.tsx itself
git rm src/components/site-header.tsx
```

- [ ] **Step 8: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && git checkout next-env.d.ts`

Then `npm run dev` and check at a narrow viewport that the bottom tab bar appears and does not cover page content, and that no screen shows two headers.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add the authenticated app shell with role-aware navigation"
```

---

### Task 10: StatusPill, Money, EmptyState, PageHeader

**Files:**
- Create: `src/components/status-pill.tsx`, `src/components/status-pill.test.tsx`, `src/components/money.tsx`, `src/components/money.test.tsx`, `src/components/empty-state.tsx`, `src/components/page-header.tsx`

**Interfaces:**
- Consumes: shadcn primitives
- Produces: `type TeacherStatus = "offline" | "available" | "in_session" | "unreachable"`; `<StatusPill status />`; `<Money paise />`; `<EmptyState title description action? />`; `<PageHeader title description? />`

- [ ] **Step 1: Write the failing StatusPill test**

Create `src/components/status-pill.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill, STATUS_COPY, type TeacherStatus } from "./status-pill";

const ALL: TeacherStatus[] = ["offline", "available", "in_session", "unreachable"];

describe("StatusPill", () => {
  it("renders a label for every status", () => {
    for (const status of ALL) {
      const { unmount } = render(<StatusPill status={status} />);
      expect(screen.getByText(STATUS_COPY[status].label)).toBeInTheDocument();
      unmount();
    }
  });

  it("distinguishes 'in a session' from 'offline'", () => {
    // The teacher is hidden from students but still intends to be available;
    // calling it Offline would invite them to toggle back on mid-session.
    expect(STATUS_COPY.in_session.label).not.toBe(STATUS_COPY.offline.label);
  });

  it("tells an unreachable teacher what is wrong", () => {
    // Step 2 activates this state. The copy must say the device cannot be
    // reached, not that the teacher is offline — the lie is the defect.
    expect(STATUS_COPY.unreachable.description.toLowerCase()).toContain("reach");
  });

  it("gives every status a distinct tone", () => {
    const tones = ALL.map((s) => STATUS_COPY[s].tone);
    expect(new Set(tones).size).toBe(tones.length);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/status-pill.test.tsx`
Expected: FAIL — cannot resolve `./status-pill`.

- [ ] **Step 3: Implement StatusPill**

Create `src/components/status-pill.tsx`:

```tsx
// The four states a teacher can be in, fixed here so the frame and the
// reachability work (step 2) agree. "unreachable" has no mechanism behind it
// yet — it is rendered by nothing until availability becomes server-known —
// but the vocabulary is settled now so step 2 changes mechanism, not markup.
// Spec §7.
export type TeacherStatus = "offline" | "available" | "in_session" | "unreachable";

export const STATUS_COPY: Record<
  TeacherStatus,
  { label: string; description: string; tone: string }
> = {
  offline: {
    label: "Offline",
    description: "You are not visible to students.",
    tone: "bg-muted text-muted-foreground",
  },
  available: {
    label: "Available now",
    description: "Students can see you and start a session.",
    tone: "bg-emerald-100 text-emerald-900",
  },
  in_session: {
    label: "In a session",
    description:
      "Hidden from students while you finish this session. You'll be visible again automatically.",
    tone: "bg-amber-100 text-amber-900",
  },
  unreachable: {
    label: "Can't reach you",
    description:
      "You're marked available, but we can't reach your device, so students aren't being shown to you.",
    tone: "bg-red-100 text-red-900",
  },
};

export function StatusPill({ status }: { status: TeacherStatus }) {
  const { label, tone } = STATUS_COPY[status];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${tone}`}
    >
      <span className="h-2 w-2 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/status-pill.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing Money test**

Create `src/components/money.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Money, formatPaise } from "./money";

describe("formatPaise", () => {
  it("renders whole rupees", () => {
    expect(formatPaise(50000)).toBe("₹500");
  });

  it("rounds to the nearest rupee", () => {
    expect(formatPaise(50049)).toBe("₹500");
    expect(formatPaise(50050)).toBe("₹501");
  });

  it("handles zero", () => {
    expect(formatPaise(0)).toBe("₹0");
  });
});

describe("Money", () => {
  it("renders the formatted amount", () => {
    render(<Money paise={50000} />);
    expect(screen.getByText("₹500")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/components/money.test.tsx`
Expected: FAIL — cannot resolve `./money`.

- [ ] **Step 7: Implement Money**

Create `src/components/money.tsx`:

```tsx
// One place renders money. The currency symbol was hardcoded in eight separate
// UI sites before this; that is housekeeping for the component layer, not an
// internationalisation decision (spec §8).
export function formatPaise(paise: number): string {
  return `₹${Math.round(paise / 100)}`;
}

export function Money({ paise }: { paise: number }) {
  return <span>{formatPaise(paise)}</span>;
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/components/money.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 9: Add the two layout composites**

Create `src/components/empty-state.tsx`:

```tsx
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <h3 className="font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
```

Create `src/components/page-header.tsx`:

```tsx
export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      {description && <p className="mt-2 text-muted-foreground">{description}</p>}
    </div>
  );
}
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add StatusPill, Money, EmptyState and PageHeader composites"
```

---

### Task 11: Migrate the student surfaces onto the component layer

**Files:**
- Modify: `src/app/(app)/(student)/find/page.tsx`, `teachers/page.tsx`, `teachers/teacher-card.tsx`, `teachers/online-list.tsx`, `waiting/[sessionId]/waiting-client.tsx`

**Interfaces:**
- Consumes: `Button`, `Card`, `Badge`, `Skeleton` from `@/components/ui/*`; `Money`, `EmptyState`, `PageHeader`
- Produces: no new interfaces

- [ ] **Step 1: Replace hand-rolled controls**

Across these files, swap every hand-rolled element for its primitive:

- `<button className="bg-gradient-to-r from-teal-500 to-cyan-600 ...">` → `<Button>`
- `<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">` → `<Card>` with `CardHeader` / `CardContent`
- `<input className="...">` → `<Input>`
- `₹{...}` → `<Money paise={...} />` (note: `teacher-card.tsx:58` renders `₹{teacher.hourly_rate}`, which is **rupees, not paise** — use `₹{rate}/hr` via a plain string there, or convert with `rate * 100`. Getting this wrong shows a teacher's rate 100× too small.)

**Do not change any behaviour.** No data fetching, no realtime subscription, no server action call, and no countdown logic may change in this task. If a swap seems to require a logic change, stop — that is a sign the swap is wrong.

- [ ] **Step 2: Give `/teachers` a real empty state**

The empty online list is currently a bare absence. Replace it with:

```tsx
<EmptyState
  title="No teachers available right now"
  description="Teachers appear here only while they're online and ready to start immediately. Try again in a few minutes, or pick a different subject."
  action={
    <Button asChild variant="outline">
      <Link href="/find">Change subject</Link>
    </Button>
  }
/>
```

- [ ] **Step 3: Add page headers**

Give `/find` and `/teachers` a `<PageHeader>` and delete the ad-hoc `<h2 className="text-3xl font-bold ...">` headings they use now.

- [ ] **Step 4: Verify the loop by hand — this is the important step**

Run `npm run dev` and walk the whole student path with a real teacher signed in on another browser: `/find` → pick criteria → `/teachers` shows the online teacher → **Start now** → `/waiting/<id>` → teacher accepts → **Pay** → payment completes → `/call/<id>` opens.

Also re-run the pay/cancel race: on `/waiting`, press **Cancel** at the moment payment clears, and confirm you are not walked off a session that just became payable.

- [ ] **Step 5: Verify the automated bar**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && git checkout next-env.d.ts`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: build the student surfaces from the component layer"
```

---

### Task 12: Migrate the teacher surfaces

**Files:**
- Modify: `src/app/(app)/(teacher)/dashboard/page.tsx`, `availability-toggle.tsx`, `incoming-request.tsx`, `session-history.tsx`

**Interfaces:**
- Consumes: `StatusPill`, `Money`, `PageHeader`, `EmptyState`, shadcn primitives
- Produces: no new interfaces

- [ ] **Step 1: Use StatusPill in the availability toggle**

`availability-toggle.tsx` currently renders its own dot and label with a nested ternary. Replace that with the shared component, deriving the status from the props it already has:

```tsx
import { StatusPill, STATUS_COPY, type TeacherStatus } from "@/components/status-pill";

const status: TeacherStatus = !online ? "offline" : inSession ? "in_session" : "available";
```

```tsx
<StatusPill status={status} />
<p className="mt-1 text-sm text-muted-foreground">{STATUS_COPY[status].description}</p>
```

**Keep `"unreachable"` unreachable.** No code path may produce it in this cycle — the mechanism that detects it is step 2, and rendering it without that mechanism would be a lie of exactly the kind this work exists to remove.

**Change no presence logic.** The channel handling, the `visibleRef` / `mountedRef` / `closingRef` guards and the `localStorage` intent all stay exactly as they are; every one of them fixes a bug that was found the hard way. This task is markup only.

- [ ] **Step 2: Append the tab-dependency sentence**

The "available" description in `STATUS_COPY` (Task 10) is deliberately shorter than the current copy, which ends "Keep this tab open — closing it takes you offline." That warning is still true until step 2 lands, so keep it visible here:

```tsx
{status === "available" && (
  <p className="mt-1 text-sm text-muted-foreground">
    Keep this tab open — closing it takes you offline.
  </p>
)}
```

Delete this in step 2, when it stops being true.

- [ ] **Step 3: Rebuild the dashboard's cards**

In `dashboard/page.tsx`, `incoming-request.tsx` and `session-history.tsx`: replace `<section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">` with `<Card>`, gradient buttons with `<Button>`, the subject chips with `<Badge>`, and `₹` renderings with `<Money>` (`session-history.tsx` uses `earnedPaise`, which really is paise; `incoming-request.tsx:356` and `session-history.tsx:100` use `hourly_rate`, which is rupees).

Add `<PageHeader title={`Welcome, ${profile.full_name}`} description="Go available to receive instant student requests." />` and remove the ad-hoc heading.

Give the empty subject list an `<EmptyState>` instead of the bare paragraph.

- [ ] **Step 4: Verify the teacher loop by hand**

`npm run dev`, then: sign in as the teacher, go available, have a student request, **accept**, watch the payment window, confirm the status reads "In a session" while it is open, and confirm the teacher becomes visible again by themselves when it resolves. Then complete a session and confirm it appears in history with the right earnings.

- [ ] **Step 5: Verify the automated bar**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && git checkout next-env.d.ts`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: build the teacher dashboard from the component layer"
```

---

### Task 13: Marketing surfaces, auth forms, and copy that tells the truth

**Files:**
- Modify: `src/app/(marketing)/page.tsx`, `terms/page.tsx`, `signin/signin-form.tsx`, `signup/signup-form.tsx`, `tutor-signup/tutor-form.tsx`, `tutor-signup/subject-picker.tsx`, `src/components/google-button.tsx`

**Interfaces:**
- Consumes: shadcn primitives, `PageHeader`
- Produces: no new interfaces

- [ ] **Step 1: Delete the false feature claim on the home page**

`src/app/(marketing)/page.tsx` defines a `FEATURES` array whose second entry is:

```tsx
  {
    icon: "⏰",
    title: "Your Schedule",
    body: "Book sessions that fit your time. Learn when it's convenient for you.",
  },
```

Scheduled booking is deferred and unbuilt. Replace that entry with the loop that does exist:

```tsx
  {
    icon: "⚡",
    title: "Start right now",
    body: "See which teachers are online this minute and start a one-to-one lesson immediately.",
  },
```

- [ ] **Step 2: Delete the false claims in `/terms`**

Remove every clause describing a messaging/chat system, package or bundle purchases, and ratings or reviews. None exist.

**Do not write replacement policy.** No-show and refund policy is an open pre-launch decision (parent spec §12) and inventing it here would be worse than the current text. Cut the sections; leave a single line saying the policy is not yet published, and leave the pre-launch rewrite tracked where it already is.

- [ ] **Step 3: Rebuild the auth forms on primitives**

In `signin-form.tsx`, `signup-form.tsx`, `tutor-form.tsx`, `subject-picker.tsx` and `google-button.tsx`: replace hand-rolled inputs with `<Input>` and `<Label>`, hand-rolled buttons with `<Button>`, and the error paragraphs with a consistent treatment using the `--destructive` token.

`tutor-form.tsx` has `LABEL` and similar shared class-name constants; delete them as their usages are replaced.

**Preserve every `useActionState` binding, form action, and `name` attribute exactly.** The server actions parse `FormData` by field name — renaming one silently breaks signup validation.

- [ ] **Step 4: Give the marketing pages headers**

Use `<PageHeader>` on `/terms`, `/signup` and `/tutor-signup` in place of ad-hoc headings.

- [ ] **Step 5: Verify by hand**

`npm run dev`: sign up as a new student, sign in and out, and walk `/tutor-signup` end to end including subject selection. Confirm validation errors still render, and read `/` and `/terms` to check nothing remains that the product cannot do.

- [ ] **Step 6: Verify the automated bar**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && git checkout next-env.d.ts`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: rebuild marketing and auth surfaces; delete copy for features that don't exist"
```

---

### Task 14: Full verification and deploy

**Files:**
- Modify: `project_state.md`

- [ ] **Step 1: Prove there is no hand-rolled control left**

Run:

```bash
grep -rn "bg-gradient-to-r from-teal" src/app src/components || echo "no gradient buttons remain"
grep -rn "<button" src/app | grep -v "components/ui" || echo "no raw buttons remain"
```

Expected: both report nothing left, apart from any gradient deliberately kept on the brand mark. Anything else is an unmigrated screen — fix it before continuing.

- [ ] **Step 2: Run the whole automated bar**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build && git checkout next-env.d.ts
```

Expected: all green, test count above the 113 the cycle started from.

- [ ] **Step 3: Run the database probes**

```bash
node scripts/probe-session-rls.mjs && node scripts/probe-happy-path.mjs && node scripts/reconcile-payments.mjs
```

Expected: all exit 0. Migration `0006` only widened a CHECK constraint, so nothing here should change — a failure means it did more than intended.

- [ ] **Step 4: Run the auth provider probe**

```bash
node scripts/probe-auth-providers.mjs
```

Expected: green **if** the user has completed the Google dashboard configuration; otherwise it exits 1 naming `google`. Report which, plainly. Do not weaken the probe.

- [ ] **Step 5: Two-browser manual run**

With a teacher in one browser and a student in another, walk the loop once more end to end: go available → request → accept → pay → call → leave → history shows the session and the earnings. This is the only check that covers client-side realtime, which no automated test in this repo reaches.

- [ ] **Step 6: Deploy**

```bash
git branch --show-current      # must be the working branch, not main
git fetch origin main
git rebase origin/main
npm run build && git checkout next-env.d.ts
```

Then push and open a PR. Preview URL must be checked with a real request — this project has shipped a "Ready" deployment that served 404s for every path:

```bash
curl -sI "<preview-url>/" | head -1
curl -sI "<preview-url>/dashboard" | head -1     # expect 307 to /signin
```

- [ ] **Step 7: Update `project_state.md`**

Record: cycle 1 complete; what shipped; that Google OAuth config is the user's outstanding dashboard task if still open; and that **step 2 — reachability — is the next spec to write**, with the four-state vocabulary already fixed by §7 of this cycle's spec.

- [ ] **Step 8: Commit**

```bash
git add project_state.md
git commit -m "docs: cycle 1 complete — IA and design system shipped"
```

---

## Notes for the executor

- **Tasks 4, 5 and 6 are the risky ones.** They move nearly every file in `src/app`. Land each as its own reviewable commit and never mix visual work into them.
- **Tasks 11, 12 and 13 are where the real hours are.** Installing shadcn is quick; removing duplicated Tailwind from fourteen pages without regressing a live payment loop is not. Manual verification in those tasks is not optional — the automated suite does not reach client-side realtime, which is precisely where this project's worst bugs have hidden.
- **If a step tempts you into a workaround, stop and say so.** This codebase's standard is root-cause fixes, and a shortcut that would cause a functional, security or cost problem in service must be recorded in the spec, not papered over.
