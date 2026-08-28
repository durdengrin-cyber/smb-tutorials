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

### 5.1 OAuth and role

**Google sign-in does not work today, and the cause is not code.** Verified 2026-08-28:
`/auth/v1/settings` reports `google: false`, and `/auth/v1/authorize?provider=google`
returns `400 Unsupported provider: provider is not enabled`. `GoogleButton` renders that
string in red and the user never leaves for Google. The client is correct — it uses
`createBrowserClient` from `@supabase/ssr`, so the PKCE verifier is stored in a cookie the
server callback can read, which is the subtle way this flow breaks in code. Enabling the
provider is dashboard work: a Google Cloud OAuth client whose authorized redirect URI is
`https://upggvzzzoxqgourjywtd.supabase.co/auth/v1/callback`, the client ID and secret in
Supabase, and both `/auth/callback` origins added to Supabase's redirect allowlist — an
un-allowlisted `redirect_to` does not error, it silently falls back to the Site URL.

**Enabling it exposes a gap that belongs to this cycle.** `handle_new_user()` seeds role
from `raw_user_meta_data ->> 'role'`, defaulting to `student`. Google sends no role, and
under OAuth a sign-in *is* a sign-up — so a teacher who has never registered and clicks
"Continue with Google" is silently created as a student with no phone and no hourly rate,
and cannot then use `/tutor-signup` because the account already exists.

**Decision: carry the signup intent through the OAuth round trip** rather than letting
Google be a student-only door.

- The entry point passes its intent via `redirectTo` (`/auth/callback?next=/tutor-signup`).
  The callback already reads `next`; only its default changes (§5).
- After exchanging the code, the callback routes a **newly created** profile by intent:
  teacher intent → `/tutor-signup` to complete the teacher profile; anything else → `/home`.
- `/tutor-signup` gains an authenticated path: with a session already present it updates the
  existing profile to `teacher` and writes phone, rate and subjects, instead of calling
  `signUp` and failing on a duplicate account.
- **An existing account arriving with teacher intent is not silently converted.** It goes to
  `/home`. Changing the role of an account that already has history is an admin action, and
  admin is cycle 3.

**On trust:** a client-supplied role hint is exactly as trustworthy as the current email
signup, which already takes role from a form and passes it in `signUp` metadata. Declaring
teacher intent only routes onboarding — it grants nothing, because teaching still requires
completing `/tutor-signup` and having subjects and a rate.

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

**A committed provider probe.** `scripts/probe-auth-providers.mjs`, in the style of the
existing probes: asserts that `/auth/v1/settings` reports the providers the product depends
on, and exits non-zero otherwise. Google being off was invisible until someone clicked the
button; this makes it a check rather than a discovery.

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
7. **Google intent is carried, not inferred** (§5.1) — chosen over making Google a
   student-only door, because the latter creates accounts that can never become teachers
   without an admin surface that does not exist yet.

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


---

## 17. Findings from the whole-branch review (2026-08-28) — READ BEFORE CYCLE 2

The whole-branch review found three defects that originated **in this spec**, not in any
implementation. Every task passed its own review because every task faithfully executed
instructions that were themselves incomplete. They are recorded here so the next cycle does
not inherit them silently.

### 17.1 SECURITY — `profiles.role` is writable by its own owner. Do NOT apply `0006`.

Migration `0001` declares:

```sql
create policy "update own profile" on public.profiles
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
```

No column restriction, and nothing in `0002`–`0005` adds one. Any authenticated user can run
`update({ role: "teacher", hourly_rate: 99999 })` against their own row from a browser holding
only the anon key.

**This policy is pre-existing. What this cycle changed is what it is worth.** Three things
compound:

1. §4 elevates `profiles.role` to *the* authority — so the one column any user can write is now
   the only thing `requireUser` and `requireRole` trust.
2. §5.1 declares that an account with history must not be silently converted to a teacher, and
   implements that as `canBecomeTeacher` in a **server action** — a control the client bypasses
   entirely by writing the row directly.
3. **`0006` widens the CHECK to include `'admin'`.** The moment it is applied,
   `update({ role: "admin" })` becomes a legal write, and cycle 3 builds the admin surface on
   `requireRole("admin")` reading this exact column.

Nothing is exploitable beyond the pre-existing student→teacher promotion **while `0006` stays
unapplied** — the live CHECK still rejects `'admin'` and no `/admin` route exists. That is not
a happy accident to rely on: **`0006` being unapplied is currently the only thing holding that
door shut.**

**Required before `0006` is applied, and therefore before cycle 3 begins:** a `BEFORE UPDATE`
trigger on `profiles` that raises when `new.role is distinct from old.role`, with the
legitimate teacher upgrade moved to a `security definer` RPC that re-checks
`canBecomeTeacher`'s conditions in SQL. Do not solve it by reaching for the service role in a
user-facing action — this project holds that key solely for the payment webhook.

**Note the trap in the plan that hid this:** Task 8's guidance read "`0001`'s update policy
allows a profile to update itself, so this write is permitted. If it is refused at runtime,
stop and report it." It treated RLS permitting the write as *confirmation* rather than as the
finding. When a plan says a permission check passed, ask what else that permission permits.

### 17.2 §3 relocated two publicly-browsable pages behind a sign-in wall

`/find` and `/teachers` had **no auth check at all** before this cycle, and `0001`'s SELECT
policy exists specifically to allow anonymous browsing of teacher profiles. §3's route table
placed both under `(app)/(student)` without noting they were public, so Task 5's instruction to
"delete the per-page gates" produced no signal that it was *adding* one.

Consequences: a signed-out visitor clicking the homepage's two primary CTAs now hits a sign-in
wall, and a signed-in **teacher** cannot view `/teachers` at all. §13's regression bar has no
anonymous-browse check, for the same reason.

**This is a product decision awaiting the owner.** If public browse should stay, `/teachers`
belongs in `(marketing)` and its criteria-recovery query must degrade when there is no
identity. If the wall is intended, the homepage CTAs should say so rather than silently
bouncing.

### 17.3 §5.1's callback branch was never carried into the plan

§5.1 requires the OAuth callback to route a **newly created** profile by intent and to send an
**existing** account with teacher intent to `/home` rather than converting it. The callback has
no new-vs-existing branch — it only honours `next`. The plan never asked for one, so the
requirement is simply unimplemented.

Compounding it, `/tutor-signup` was never made session-aware: it is not `async`, never calls
`getIdentity`, and still renders `email` and `password` as required with the label "you'll use
this to sign in" — which will never be true for a Google user, whose password the
`existingUser` branch discards. That is copy that lies, on the branch whose §11 exists to
delete copy that lies.

**Invisible today only because Google is disabled** — which is the one outstanding
configuration task the owner holds. It breaks the day they enable it.

### 17.4 §9's token system is only partly built

§9 requires a primary ramp, a neutral ramp, and semantic **success / warning / danger / info**
pairs, plus radius, shadow, **spacing** and type scales. What exists is a single `--primary`, a
single `--destructive`, radius (from shadcn) and a type scale. The plan's Task 2 only ever
asked for the two brand pairs, so the implementation matches the plan and the plan
under-delivers the spec.

Visible consequence: `status-pill.tsx` hardcodes `bg-emerald-100` / `bg-amber-100` /
`bg-red-100` — raw Tailwind palette in the one component built to be the shared vocabulary for
teacher status, with no contrast assertion. `contrastRatio` already exists; extending
`tokens.test.ts` to cover semantic pairs is cheap once the tokens are defined.

Sixteen gradients also survive across the marketing and app surfaces (the final verification
grep searched `bg-gradient-to-r` and missed every `bg-gradient-to-br`). Two CTA violations were
fixed; the rest is a design-consistency backlog.

### 17.5 The largest standing risk: no component tests on the payment surfaces

The five student-flow files and the three teacher-dashboard files carry the payment and video
loop and have **zero** component tests. Two task reviews and the whole-branch review all
flagged it. The test harness exists, and `Money` and `StatusPill` prove the pattern — there is
no longer a technical reason. A future markup change has no tripwire against exactly the
money-unit and race-navigation regressions those reviews had to catch by reading code.

**This should be the first item in cycle 2, not a rolling deferral.**
