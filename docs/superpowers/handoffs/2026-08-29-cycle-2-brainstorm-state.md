# Cycle 2 — Durable Availability — BRAINSTORM IN PROGRESS

**Paused 2026-08-29, mid-brainstorm, by the user's request to resume in a fresh session.**

**Nothing is implemented. No spec file exists yet.** This document is the entire state of the
design conversation. Cycle 1 lost its ledger to git-ignored scratch and had to reconstruct it;
this file exists so that does not happen twice.

---

## 0. How to resume

1. Read this file end to end.
2. Invoke `superpowers:brainstorming` — **architectural path**, already classified. Do not
   re-classify and do not re-litigate Sections 1–3 below; they are approved.
3. Resume at **Section 4 of 5** (PWA + onboarding), then Section 5 (testing).
4. Then, and only then: write the spec to
   `docs/superpowers/specs/2026-08-29-durable-availability-design.md`, self-review it, get the
   user's approval on the written file, and invoke `superpowers:writing-plans`.
   **`writing-plans` is the only skill that follows. Not `ui-ux-pro-max`, not any implementation skill.**

**Execution model, confirmed with the user 2026-08-29:** brainstorm and spec are done in the main
conversation with no subagents. Implementation uses `superpowers:subagent-driven-development` —
one implementer per plan task, each independently reviewed — which is how cycle 1 ran.

---

## 1. BLOCKER — this machine is a fresh clone

The repo was cloned ~2026-08-28. **`node_modules` is absent and `.env.local` does not exist.**
Nothing can be installed, built, tested, run, or probed until that is fixed.

Before any implementation task is dispatched:
- `npm install`
- Rebuild `.env.local` from the Vercel project env vars. **`.env.local` is the user's file
  (ruling of 2026-08-27): propose the lines, let them paste. Never write it.**
  Needs at least: `DAILY_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMENT_PROVIDER=razorpay`.
- This cycle will add VAPID keys (see §6).

Everything the old `project_state.md` claims is "verified green" was verified on the *previous*
machine. Re-establish the baseline before trusting it.

---

## 2. Standing instruction from the user (2026-08-29)

> "this is a legit business being developed for scale. So choose accordingly"

Saved to project memory as `build-for-scale`. It means: do not default to the cheapest thing
that works today; put the **seams** where later scale moves will happen, so they become swaps
behind a boundary rather than rewrites. Apply YAGNI to implementation, never to boundaries.
State scale ceilings out loud, with numbers.

Also confirmed by the user this session:
- **All devices are first-class.** Not phone-first, not desktop-first. This is the answer to the
  primary-device question that `project_state.md` had flagged as "asked and withdrawn — re-ask
  it first." It is now answered; do not ask again.
- **Teachers will onboard via a PWA**, and an App Store presence is anticipated later.

---

## 3. Scope, decided

**Cycle 2 is durable availability ONLY.** The user chose this over bundling the student
dashboard.

- The payment-surface component tests (cycle-1 handoff §5's "first item") are a **separate
  bounded task** needing no spec. They protect code this cycle touches, so they run *first*,
  not inside this spec.
- Student dashboard gets its own spec afterwards.

---

## 4. The approach: B′ (approved)

Three approaches were put to the user. **B′ was chosen** — a refinement of the "Approach C"
that cycle 1's spec §2 had tentatively agreed.

### The problem

A teacher is "online" only while the dashboard tab is open and visible. Availability exists
nowhere but in one websocket plus a `localStorage` intent flag. Lock a phone → the tab suspends
→ the teacher vanishes from every student list **and is never told**. The dashboard currently
admits this in copy: *"Keep this tab open — closing it takes you offline."*

### Rejected approaches

- **A — durable declaration + heartbeat, no push.** Deletes the lie but not the limitation;
  teachers still tied to an open tab. Eliminated by "all devices first-class."
- **C — push-only, poll the list.** Loses the instant path and reintroduces a single point of
  failure.

### The two defects in the first draft of B, and the correction

The naive reading of "durable declaration as the source of truth" — move availability into
Postgres and subscribe students to it — is **the worst thing we could build.** Two findings,
both verified against vendor documentation this session:

1. **`postgres_changes` scales with subscriber count, not write rate**, performs one
   authorization check *per subscriber per change*, and is processed **on a single thread**, so
   a bigger instance does not help. Supabase advises abandoning it past ~3,000 subscribers.
   Combined with a 15-second heartbeat this collapses early:

   | Teachers online | Students watching | Auth checks/sec |
   |---|---|---|
   | 100 | 100 | ~670 |
   | 500 | 500 | ~16,600 |
   | 2,000 | 2,000 | ~267,000 |

2. **Push reachability cannot be silently proven.** Browsers mandate
   `userVisibleOnly: true`; there is no silent probe. A dead subscription is discovered only
   when the push service returns 404/410 **at send time** — after the student already picked
   that teacher.

### B′ — split the facts instead of merging them

| Fact | Lives in | Write rate | Why |
|---|---|---|---|
| **Declaration** ("I want work") | Postgres | Rare — a few toggles/day | Durable; survives tab death; is what push is authorised against |
| **Liveness** ("a device is live now") | Realtime **Presence** | **Zero DB writes** | Presence is built for this; diff-based; never touches Postgres |
| **Reach** ("we can wake a device") | Postgres `teacher_devices` | Rare | Inferred from a valid subscription; pruned on 404/410 |

**Key insight: presence is not the problem — presence being the *only* record is the problem.**
B′ **keeps** the existing presence channel and puts a durable declaration underneath it plus a
push road beside it. The student list stays *declaration ∩ presence*, which is very nearly
`intersectOnline()` as it exists today.

### Scale ceiling already present in the code (not fixed this cycle, seam must allow it)

`src/lib/presence.ts` uses **one global channel** for all teachers — its own comment flags this
as deliberate. Every student downloads every online teacher and filters client-side. At ~5,000
online teachers that is 5,000 entries per sync per student. The fix is sharding the channel by
taxonomy; keep it behind that module so it stays a swap.

### The four seams that must be right

| Seam | The later move it enables |
|---|---|
| Transport behind a port (mirror `src/lib/payments/port.ts`) | APNs/FCM adapter for the App Store build |
| Declaration separate from liveness | Neither one's scaling fix disturbs the other |
| List read behind one function | Shard presence by subject; or re-stream via Broadcast |
| Device registry with lifecycle | Prune, re-register, survive `pushsubscriptionchange` |

---

## 5. Section 1 — Data model — APPROVED

### `teacher_availability` — the durable declaration, with a LEASE not a heartbeat

A declaration that never expires re-creates the lie: a teacher declares available, vanishes for
a month, students keep picking a ghost. A heartbeat fixes that but is the write storm above.
**A lease gives the same honesty ~240× cheaper:**

| Model | Writes/sec at 10,000 teachers |
|---|---|
| 15s heartbeat | ~667 |
| Hourly lease renewal | **~2.8** |

```sql
create table public.teacher_availability (
  teacher_id     uuid primary key references public.profiles (id) on delete cascade,
  declared       boolean     not null default false,
  declared_at    timestamptz,
  declared_until timestamptz,          -- the lease; NULL when not declared
  updated_at     timestamptz not null default now()
);

create index teacher_availability_live_idx
  on public.teacher_availability (declared_until)
  where declared;
```

Declaring buys a fixed span ("available for the next 4 hours"); any live client renews it
lazily; accepting work renews it. **The lease is shown to the teacher when they declare**, so
lapsing is what they agreed to rather than a surprise. No nagging pre-expiry push.

### `teacher_devices` — the push subscription registry

```sql
create table public.teacher_devices (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references public.profiles (id) on delete cascade,
  transport      text not null check (transport in ('webpush')),  -- 'apns' | 'fcm' later
  endpoint       text not null,
  p256dh         text not null,
  auth           text not null,
  user_agent     text,
  created_at     timestamptz not null default now(),
  last_ok_at     timestamptz,
  last_failed_at timestamptz,
  failure_count  int not null default 0
);

create unique index teacher_devices_endpoint_idx on public.teacher_devices (endpoint);
create index teacher_devices_teacher_idx on public.teacher_devices (teacher_id);
```

`transport` is a column from day one though only one value is legal — that is the App Store
seam. Unique `endpoint` so re-subscribing updates rather than duplicates. Failure columns exist
because a 404/410 at send time is the *only* death signal there is.

### Why new tables and not columns on `profiles`

`profiles` has the **known-broken update policy** from cycle-1 spec §17.1 (no column
restriction — any signed-in user can rewrite their own row), which cycle 3 is blocked on.
Hanging a hot column off it entangles this cycle with that debt. Separate tables get correct
column-scoped RLS from day one and inherit nothing.

### DEFERRED DECISION — the dispatcher's credential

Sending a push needs a privileged read of `teacher_devices` (endpoints are capabilities — a
student must never read another user's). The cycle-1 handoff states the service role is
*"solely for the payment webhook."*

Options: **(a)** a dedicated `sb_secret_*` key for the dispatcher — honours the rule by
narrowing it, independently rotatable; **(b)** reuse the service role — nothing to set up, but
widens the blast radius of the all-powerful key into a student-triggerable path;
**(c)** DB trigger + `pg_net` → dispatch endpoint — most durable, materially more moving parts.

**Deliberately deferred and NOT blocking the spec.** Whether (a) is even available depends on
the Supabase project offering the newer key type, which could not be checked — there is no
`.env.local` on this machine. **Design the dispatcher so the credential is one line of config**,
and decide once the environment exists. Nothing else in the design changes either way.

---

## 6. Section 2 — Delivery — APPROVED

**The flow.** Student taps Start → the session row is inserted exactly as today
(`src/app/(app)/(student)/teachers/actions.ts`, `requestSession`) → immediately after, fan out
over **every road**, without making the student wait (Vercel `waitUntil`).

- **Road 1 — the live connection.** Existing realtime card in `incoming-request.tsx`. Untouched.
- **Road 2 — Web Push** to every registered device. Wakes a locked phone.

Independent by design: neither knows about the other, so one failing still leaves one landing.

**The catch-up query is already built.** `incoming-request.tsx` already queries for open
requests on mount (written so a teacher returning from a call misses nothing). A teacher
arriving by notification is the same situation, so the card is simply there. Plug in, don't add.

When a teacher has both a notification and an open tab, the dashboard **closes the stale
notification on open** (`registration.getNotifications()` → `.close()`). No dismissal push —
that would have to be user-visible.

### The accept window: 30s → 60s, for everyone

Today's 30s was sized for a teacher already staring at the screen; waking a sleeping phone does
not fit inside it (delivery, noticing, unlocking, tapping).

**Road-dependent deadlines were considered and REJECTED** — more machinery than the problem
needs, and the server cannot reliably tell whether a tab is live (presence lives in the Realtime
service, not Postgres).

**One longer window costs the fast path nothing**, because 30s is a *deadline*, not a *wait*: a
teacher who accepts in 2 seconds still resolves in 2 seconds. Lengthening it only changes the
failure case, where more time means more requests succeed. The only cost is that a student
whose teacher never answers waits 60s instead of 30s — and that is shrunk further because a
teacher we genuinely cannot reach is **not shown to the student at all**.

The waiting screen stops being silent: *"Asking Priya… this can take a moment if their phone is
asleep."*

---

## 7. Section 3 — Honest degradation — APPROVED

### The four states get a mechanism at last

Cycle 1 fixed the vocabulary (`StatusPill` knows all four; `unreachable` renders nowhere because
no mechanism existed). This supplies it:

| State | How we know | In the student list? |
|---|---|---|
| **Available** | Declared, lease valid, live connection | Yes |
| **Reachable** | Declared, lease valid, ≥1 working device, no open tab | Yes |
| **In a session** | Committed to a student right now | No — hidden |
| **Can't reach you** | Declared, lease valid, no open tab **and** no working device | **No — hidden, and the teacher is told** |

Hiding rather than greying follows the rule M2 already set: *every visible card is genuinely
startable.* Existing principle applied to a new case.

### Student side: RANK, DON'T LABEL

Badging push-only teachers ("Online now" vs "Usually responds in a minute") was considered and
**rejected**: a visible second tier means those teachers stop being picked, punishing exactly the
teachers who did what we asked, and **landing hardest on iPhone users** — a marketplace that
quietly discriminates by handset.

**Instead, sort:** live-connection teachers rank above push-only ones. The student naturally
picks the fastest, nobody is marked second-rate, and when nobody has a tab open the push-only
teachers still get the work. Honesty through ordering. The one honest sentence lives on the
waiting screen instead.

### Teacher side: delete the apology, tell the truth

`availability-toggle.tsx`'s *"Keep this tab open — closing it takes you offline"* is deleted
(cycle-1 spec anticipated exactly this) and replaced by one of three truths:

- ✅ **Available until 6:00 pm** — we'll notify you even with your phone locked.
- 🔴 **Can't reach you** — you're marked available, but students aren't being shown to you.
  **[Turn on notifications]**
- 🔴 **Can't reach you** — iPhone needs one extra step: tap Share, then *Add to Home Screen*.

A teacher can never again be silently invisible.

### On the record

**A denied notification permission is close to permanent** — browsers will not let us ask twice.
So the prompt does **not** fire on page load; it is asked during onboarding, after explaining
why. Getting this wrong once costs that teacher the push road forever and makes "Can't reach
you" their normal state.

---

## 8. STILL TO DO — resume here

### Section 4 of 5 — PWA and onboarding (NOT YET DISCUSSED)

Open questions to work through with the user:
- A **service worker and manifest are mandatory**, not optional — there is no Web Push without a
  service worker. Minimal PWA is in scope by necessity; full offline/app polish is not.
- **iOS requires Add to Home Screen** before push is possible at all (iOS 16.4+; iOS 26 opens
  every Home-Screen site as a web app; Safari 18.4 added Declarative Web Push). An iPhone
  teacher who skips the install can *never* be woken. Where does the install prompt go, and how
  hard do we push it?
- Where exactly in teacher onboarding does the permission prompt go (see §7's warning)?
- Does an existing signed-up teacher get retro-onboarded into notifications, and how?
- `pushsubscriptionchange` handling and re-registration on app launch.

### Section 5 of 5 — Testing and verification (NOT YET DISCUSSED)

- Unit tests for lease logic, roster derivation, device pruning.
- A committed probe against the live DB, in the established style of `scripts/probe-*.mjs`
  (no arguments, no standing credential, mints and deletes its own accounts, asserts row counts
  return to baseline).
- **The two-browser manual walk has never been performed on any cycle** — three agents could not
  drive a browser. This cycle adds a locked-phone case that no automated check can cover.
  Decide honestly who performs it.

### Then

Write the spec → self-review → user approves the written file → `superpowers:writing-plans`.

---

## 9. Facts verified this session (do not re-derive)

- Supabase `postgres_changes`: one auth check per subscriber per change, single-threaded,
  advised against past ~3,000 subscribers; use Broadcast at scale.
- Web Push `userVisibleOnly: true` is mandatory — **no silent push, therefore no silent
  reachability probe**. Subscriptions expire and fire `pushsubscriptionchange`.
- iOS: push only for Home-Screen-installed web apps; an open Safari tab has no `PushManager`.
- Android wakes the service worker outside the browser; Doze can delay delivery.
- `requestSession` inserts then `redirect()`s — the fan-out slots in between, via `waitUntil`.
- `incoming-request.tsx` already runs a catch-up query for open requests on mount.
- `presence.ts` uses one global channel for all teachers.
