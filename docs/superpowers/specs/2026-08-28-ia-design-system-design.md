# IA + Design System — Design

**Status:** proposed · 2026-08-28
**Cycle:** 1 of 4 in the post-M3 redesign (IA + design system → student dashboard → admin → polish)
**Parent spec:** `2026-08-24-smb-tutorials-design.md`

---

## 1. Why this exists

The product loop works and is in production: a student picks a subject, sees who is
available now, picks a teacher, pays, and has a 60-minute video lesson. What was never
built is the connective tissue between the screens. Verified against the code on
2026-08-28:

- **One layout file for the entire app** (`src/app/layout.tsx`). No route groups, and not
  a single `loading.tsx`, `error.tsx` or `not-found.tsx` anywhere.
- **No component layer.** No `components.json`, no `src/components/ui`, no UI dependency
  of any kind. Two ad-hoc components exist (`site-header`, `google-button`); every button,
  card and input is inline Tailwind duplicated per page, inherited from the CRA demo.
- **No authenticated shell.** `/` does not even use `SiteHeader` — it inlines its own
  header. Nothing in the app knows who is signed in or what role they hold.
- **Post-login routing does not exist.** `signIn`, `signUpStudent` and `tutorSignUp` all
  hardcode `redirect("/")`; `/auth/callback` defaults its `next` param to `/`. A signed-in
  teacher has no route to `/dashboard` but to type the URL.
- **Gating is per-page and ad hoc.** `/dashboard` re-implements
  `if (!profile || profile.role !== "teacher") redirect("/")`. A new page is protected only
  if whoever wrote it remembered.

This is the "airtight, never makeshift" rule (CLAUDE.md) applied to the layer of the
codebase that currently has the least of it.

## 2. Scope

The user's decision on 2026-08-28: build the hardened version, and do it in two sequenced
steps rather than at once.

**Step 1 — this spec.** The frame and the look: route structure, identity and role
resolution, post-login routing, the app shell, the component layer, the visual language,
page states, and removing marketing copy that describes features that do not exist.

**Step 2 — its own spec, next.** Fixing what "online" means: availability becomes
server-authoritative, with reachability proven rather than assumed. Approach C was
recommended and tentatively agreed — a durable declaration as the source of truth, with
push and websocket as two independent delivery roads — but the approach is settled in that
spec, not this one.

**This spec's dependency on step 2 is one thing only:** the vocabulary of teacher status.
§7 fixes it now so the frame has the right slots and step 2 changes mechanism, not markup.

**Explicitly out of scope:** the student dashboard's content (cycle 2), any admin surface
(cycle 3), dark mode (cycle 4), the scheduled tier, and the reachability mechanism itself.

## 3. Route structure

Route groups do not appear in URLs, so **every existing public path is unchanged.** The
groups exist to give each audience one layout, and therefore one gate.

```
src/app/
  (marketing)/
    layout.tsx                 public chrome: header + footer
    page.tsx                   /
    terms/                     /terms
    signin/                    /signin
    signup/                    /signup
    tutor-signup/              /tutor-signup
  (app)/
    layout.tsx                 requireUser() + <AppShell>
    home/                      /home        role resolver (§5)
    (teacher)/
      layout.tsx               requireRole("teacher")
      dashboard/               /dashboard
    (student)/
      layout.tsx               requireRole("student")
      find/                    /find
      teachers/                /teachers
      waiting/[sessionId]/     /waiting/:id
  (fullscreen)/
    layout.tsx                 requireUser(), deliberately no shell
    call/[sessionId]/          /call/:id
```

**Why `call` is chromeless and `waiting` is not.** The call needs the whole viewport, and
nav during a lesson is noise. The waiting screen keeps the shell on purpose: a student in
a 120-second payment window must be able to leave, not be trapped in a flow.

**No new surfaces are added in this cycle.** `/home` is a resolver, not a page (§5). The
student's post-lesson dead end is real but is cycle 2's job by the agreed decomposition;
widening cycle 1 to cover it would be scope creep.

**`/dev/checkout` and the development payment stub are deleted in this cycle.** M3 spec §13
requires it, and the route structure forces the question: `/dev/checkout` is a page, so it
would otherwise need a group and a permanent exception in §13's invariant test. Its purpose
— proving the payment plumbing before provider keys existed — has been served; the real
Razorpay adapter shipped and settled real refunds. If a keyless local path is still wanted
afterwards, it must be reintroduced as something that is not a route, so it cannot reach
production by accident.

## 4. Identity, role and gating

**`profiles.role` is authoritative.** Verified: profile rows are created by the
security-definer trigger `handle_new_user()` in migration `0001`, seeded from
`raw_user_meta_data ->> 'role'`. So `user_metadata.role` is a *seed at signup only* and
must never be read as authority by app code. This is currently implicit and gets written
down here because both values exist and they can diverge.

**Two server-only helpers in `src/lib/auth.ts`:**

- `requireUser()` — returns the authenticated user and their profile, or redirects to
  `/signin?next=<current path>`.
- `requireRole(role)` — builds on it; on mismatch redirects to `/home` rather than 404ing,
  so a student who lands on a teacher URL is helped rather than stonewalled. Data is
  protected by RLS regardless; this is a UX choice, not a security boundary.

Both are wrapped in React `cache()` so the layout, its nested layout and the page share one
profile fetch per request instead of three.

**Pages stop gating themselves.** After this cycle, a route is protected because of the
group it lives in. The existing per-page checks are deleted, not left as belt-and-braces —
two gates that can disagree is exactly the makeshift pattern this cycle exists to remove.

**`proxy.ts` keeps its current job** (refreshing the Supabase token — removing that call
signs everyone out at expiry) and gains nothing else. Role lookups belong in layouts where
a DB read is cheap and cacheable, not in a proxy that runs on every asset request.

**Admin enters the role enum now, with no admin surface.** Cycle 3 needs it; adding a value
to a CHECK constraint against live data later is a migration either way, and doing it now
means `requireRole`, the nav config and the `/home` resolver are written once for three
roles rather than rewritten for a third. No admin user is created and no admin route
exists. See §12.

## 5. Post-login routing

**One destination, one decision.** `signIn`, `signUpStudent`, `tutorSignUp` and
`/auth/callback`'s default `next` all point at `/home` instead of `/`. `signOut` keeps
redirecting to `/` — that is correct.

`/home` is a server component that resolves the role and redirects: teacher → `/dashboard`,
student → `/find`, admin → `/admin` (cycle 3). It renders nothing. Cycle 2 replaces the
student branch with the real student dashboard, and that is the only file that changes.

Where `next` is present (a signed-out user who was bounced from a deep link), it wins over
the role default, so people return to what they were trying to reach.

**`/` is not force-redirected for signed-in users.** They keep access to the marketing
page; it simply offers "Go to your dashboard" instead of "Sign in".

## 6. The shell and navigation

`AppShell` is a server component rendered by `(app)/layout.tsx`, taking the resolved
profile. It holds:

- **Brand** — links to `/home` for signed-in users.
- **Role-aware nav**, data-driven from a single `NAV: Record<Role, NavItem[]>` config, so
  adding a surface in cycles 2–3 is a config entry, not a nav rewrite.
- **The teacher status slot** (§7).
- **Account menu** — name, role, sign out.

**Responsive by construction, not as an afterthought.** Bottom tab bar plus compact top bar
on small screens; a single top bar on desktop. This follows directly from the decision to
build for any device rather than a chosen one.

**Nav is thin in this cycle, and that is correct.** The only surfaces that exist are
`/dashboard` for teachers and `/find` for students. The deliverable is the shell and the
config that drives it; entries appear as cycles 2 and 3 build the surfaces they point at.
A nav full of links to pages that do not exist would repeat the exact defect §11 fixes.

## 7. Teacher status — vocabulary now, mechanism in step 2

Four states, fixed here so both steps agree:

| State | Meaning | Exists in step 1? |
|---|---|---|
| **Offline** | Has not declared availability | Yes |
| **Available** | Declared, and we can reach them | Yes |
| **In a session** | Declared, but committed to a student right now | Yes |
| **Unreachable** | Declared, but we cannot reach their device | **No — step 2** |

`StatusPill` is built in this cycle as a pure presentational component covering all four,
unit-tested against each. `/dashboard` uses it immediately for the three states that exist.

**The control does not move into the shell in this cycle, deliberately.** Promoting the
availability toggle out of `/dashboard` would mean re-plumbing its `inSession` coupling
with `IncomingRequest` — and that coupling exists only because availability is client-side
state shared between two sibling components. Step 2 makes availability server-known and the
coupling dissolves on its own. The shell defines the slot; step 2 fills it. Building
client plumbing now that step 2 deletes would be makeshift work by definition.

## 8. Component layer

**shadcn/ui**, as CLAUDE.md locks. It is copy-in rather than a dependency, so the code is
owned and editable, and it brings Radix's keyboard and ARIA behaviour that hand-rolled
primitives reliably get wrong.

- **Primitives** (`src/components/ui/`): button, input, label, card, badge, dialog,
  dropdown-menu, select, skeleton, avatar, separator, tabs, sonner.
- **Product composites** (`src/components/`): `TeacherCard`, `SessionRow`, `StatusPill`,
  `EmptyState`, `PageHeader`, `Money`.
- **Convention, enforced in review:** after this cycle no page hand-rolls a button, input
  or card. Existing screens are migrated onto the primitives as part of the cycle — the
  point is to *remove* the duplicated Tailwind, not to add a second way of doing it.

`Money` exists because `₹` is currently hardcoded in eight separate UI sites. This is
housekeeping that belongs in a component layer, not a market decision — no
internationalisation is in scope.

## 9. Visual language

Brand identity is kept: the name, "One Student, One Teacher", and the teal/cyan family.
What changes is that it becomes a system instead of ad-hoc classes.

- **Tokens** in `globals.css` via Tailwind v4 `@theme`: a primary ramp derived from the
  existing teal/cyan, a neutral ramp, and semantic success / warning / danger / info.
  Radius, shadow, spacing and type scales get defined values instead of per-page choices.
- **Gradients are demoted.** Every primary button is currently
  `bg-gradient-to-r from-teal-500 to-cyan-600`, which is the single biggest reason the UI
  reads as a template. Gradients are reserved for the brand mark and at most one hero
  surface; buttons become solid.
- **Typography:** keep Geist, already loaded; define an explicit scale rather than
  per-page `text-xl font-bold`.
- **Motion:** one `fadeIn` keyframe exists today. Define a small set of durations and
  easings, and honour `prefers-reduced-motion`.
- **Accessibility:** AA contrast on the token ramps, visible `focus-visible` rings from
  tokens, and Radix's behaviour left intact.
- **Dark mode is not enabled this cycle**, but tokens are structured so enabling it is a
  token file rather than a rewrite. `globals.css` currently declares light-only by design;
  that comment gets updated to say deferred rather than rejected.

## 10. Page states

Every route group gets `loading.tsx`, `error.tsx` and `not-found.tsx`; the app has none
today, so a slow query renders a white page and a thrown error renders the Next.js default.
Skeletons are built from the `Skeleton` primitive. `EmptyState` covers the cases that
already occur in production — most notably an empty `/teachers` list, which today is a bare
absence and is almost always "nobody has a tab open" rather than a fault.

## 11. Marketing truthfulness

Separate from the visual work, and worth doing regardless:

- **`/`** advertises "Your Schedule — Book sessions that fit your time." The scheduled tier
  is deferred and unbuilt. Remove it; the home page should describe the instant-pick loop
  that actually exists.
- **`/terms`** describes a messaging system, package purchases and ratings, none of which
  exist. Delete those claims. **It is not rewritten into new policy here** — no-show and
  refund policy is an open pre-launch item (parent spec §12) and inventing it in a design
  cycle would be worse than the current text. Sections that depend on undecided policy are
  cut, not fabricated.

## 12. Migration

`0006_roles_admin.sql` — drop and recreate the `profiles.role` CHECK constraint as
`check (role in ('student','teacher','admin'))`. Existing rows all validate, so this is
non-destructive and needs no backfill. No admin user is created; no RLS policy changes
(the existing `role = 'teacher' or id = auth.uid()` select policy is unaffected).

## 13. Testing and verification

**Unit (Vitest, alongside the existing 113):**
- The `/home` role resolver for each of the three roles.
- The nav config per role.
- `StatusPill` across all four states, including the one step 2 activates.
- `requireRole` redirect behaviour with a mocked client.

**A route-group invariant test.** Enumerate every `page.tsx` under `src/app` and assert
each lives inside `(marketing)`, `(app)` or `(fullscreen)`. This is what makes "protected
because of where it lives" a guarantee rather than a convention — an ungated page cannot be
added without failing the suite.

**Regression bar.** The full existing suite, `tsc --noEmit`, eslint and `npm run build` all
stay green. The route refactor changes no URLs, so the M2/M3 loop must still pass its manual
run: teacher signs in and lands on `/dashboard`, student signs in and lands on `/find`, a
signed-out visit to `/dashboard` bounces to `/signin?next=/dashboard` and returns after
sign-in, a student on `/dashboard` is sent to `/home`, and the call screen renders with no
shell.

## 14. Decisions and assumptions

Recorded so they are cheap to overturn:

1. **Both steps, sequenced** — frame and look first, "online" second (user, 2026-08-28).
2. **shadcn/ui over bespoke** — assumed from CLAUDE.md's locked stack.
3. **Brand kept, systematised** — assumed, not chosen. The teal/cyan came from the CRA
   demo rather than a brand decision; overturning it is cheapest now.
4. **Marketing pages in scope** — on the record already (user, 2026-08-26: full visual
   redesign, every screen).
5. **Admin role added now, admin surface not** — recommended for the reason in §4.
6. **No internationalisation** — an earlier tangent, explicitly dropped by the user.

## 15. Risks

- **shadcn/ui against Tailwind v4 + React 19 + Next 16.3.** Supported, but this stack is
  ahead of most documentation and the project has already lost a session to a Next 16
  convention change. Verify at install; if it fails, fall back to building the same
  primitives directly on Radix, which changes effort and not architecture.
- **The route refactor touches nearly every page.** URLs are unchanged and the test suite
  plus the manual loop are the safety net, but this is the highest-churn part of the cycle
  and should land as its own reviewable step rather than mixed with visual work.
- **Migrating existing screens onto the primitives is where the work actually is.**
  Installing shadcn is an afternoon; removing duplicated Tailwind from fourteen pages
  without regressing the verified M2/M3 flows is the real cost, and the plan should size it
  honestly.
