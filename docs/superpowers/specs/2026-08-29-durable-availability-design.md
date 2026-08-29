# Durable Availability — Design

**Status:** proposed · 2026-08-29
**Cycle:** 2 of 4 in the post-M3 redesign (IA + design system ✅ → **durable availability** → student dashboard → admin → polish)
**Parent spec:** `2026-08-24-smb-tutorials-design.md`
**Predecessor:** `2026-08-28-ia-design-system-design.md` (cycle 1, shipped)
**Brainstorm state:** `docs/superpowers/handoffs/2026-08-29-cycle-2-brainstorm-state.md`

---

## 1. Why this exists

A teacher is "online" only while the dashboard tab is open **and visible**. Availability
lives nowhere but in one websocket plus a `localStorage` intent flag. Lock the phone, the
tab suspends, the teacher vanishes from every student list — **and is never told**.

The dashboard currently admits this in copy:

> "Keep this tab open — closing it takes you offline."

That sentence is the product apologising for its architecture. Cycle 1 fixed the
*vocabulary* — `StatusPill` already knows all four teacher states — but `unreachable`
renders nowhere, because no mechanism exists to produce it. This cycle supplies the
mechanism.

**The user's standing instruction (2026-08-29), which governs every choice below:**

> "this is a legit business being developed for scale. So choose accordingly"

Read as: do not default to the cheapest thing that works today; put the **seams** where
later scale moves happen, so they become swaps behind a boundary rather than rewrites.
YAGNI applies to implementation, never to boundaries. Scale ceilings are stated out loud,
with numbers.

**All devices are first-class** — not phone-first, not desktop-first (user, 2026-08-29).
This closes the primary-device question `project_state.md` had flagged as "asked and
withdrawn"; it is answered and is not re-opened.

## 2. Scope

**In:** durable availability only.

- A declaration of availability that survives tab death, with a lease.
- A push road to a teacher's device, behind a transport port.
- A device registry with a real lifecycle.
- Honest degradation: the four states get a mechanism; a teacher we cannot reach is hidden
  from students **and told**.
- The minimum PWA that Web Push requires, and the onboarding that makes it stick.
- Tests, a live-DB probe, and — at last — a real browser walk.

**Out, deliberately:**

- The **student dashboard**. Split back out by the user's choice; it gets its own spec.
- **Student push** of any kind. The manifest is site-wide; the install prompt and push are
  teacher-only this cycle.
- Offline support, caching, an app shell. The service worker handles push and nothing else.
- Sharding the presence channel (§10 states the ceiling and keeps the seam).
- Anything requiring `profiles.role` to be writable — cycle 3's blocker is untouched here.

**Runs before this cycle's implementation, not inside it:** the payment-surface component
tests (cycle-1 spec §17.5). They protect code this cycle touches, so they land first as a
separate bounded task.

## 3. Approach — B′

Three approaches were put to the user. **B′ was chosen.**

### 3.1 Rejected

- **A — durable declaration + heartbeat, no push.** Deletes the lie but not the
  limitation; teachers stay tied to an open tab. Eliminated by "all devices first-class".
- **C — push-only, poll the list.** Loses the instant path and reintroduces a single point
  of failure.

### 3.2 The two defects in the naive reading of B

"Move availability into Postgres and subscribe students to it" is the worst thing we could
build. Both findings were verified against vendor documentation on 2026-08-29:

**1. `postgres_changes` scales with subscriber count, not write rate.** It performs one
authorization check *per subscriber per change*, processed on a **single thread** — so a
bigger instance does not help. Supabase advises abandoning it past ~3,000 subscribers.
Combined with a 15-second heartbeat it collapses early:

| Teachers online | Students watching | Auth checks/sec |
|---|---|---|
| 100 | 100 | ~670 |
| 500 | 500 | ~16,600 |
| 2,000 | 2,000 | ~267,000 |

**2. Push reachability cannot be silently proven.** Browsers mandate
`userVisibleOnly: true`; there is no silent probe. A dead subscription is discovered only
when the push service returns 404/410 **at send time** — after the student already picked
that teacher.

### 3.3 B′ — split the facts instead of merging them

| Fact | Lives in | Write rate | Why |
|---|---|---|---|
| **Declaration** ("I want work") | Postgres | Rare — a few toggles/day | Durable; survives tab death; is what push is authorised against |
| **Liveness** ("a device is live now") | Realtime **Presence** | **Zero DB writes** | Presence is built for exactly this; diff-based; never touches Postgres |
| **Reach** ("we can wake a device") | Postgres `teacher_devices` | Rare | Inferred from a valid subscription; pruned on 404/410 |

**The key insight: presence is not the problem — presence being the *only* record is the
problem.** B′ **keeps** the existing presence channel, puts a durable declaration
underneath it, and lays a push road beside it.

The student list is therefore no longer a plain intersection. It is:

```
declared ∧ lease-valid ∧ ¬in-session ∧ (live-connection ∨ working-device)
```

ranked live-connection first (§6.2). `intersectOnline()` survives as the *live* half of
that expression; the push-only half is new, and §4.5 is where it comes from.

## 4. Data model

### 4.1 `teacher_availability` — a LEASE, not a heartbeat

A declaration that never expires re-creates the lie in slower motion: a teacher declares
available, vanishes for a month, students keep picking a ghost. A heartbeat fixes that and
buys the write storm above. **A lease gives the same honesty ~240× cheaper:**

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

Declaring buys a fixed span. **The default lease is 4 hours**, one exported constant
alongside `ACCEPT_WINDOW_SECONDS`. Any live client renews it
lazily; accepting work renews it. **The lease is shown to the teacher at the moment they
declare**, so lapsing is what they agreed to rather than a surprise sprung on them. No
nagging pre-expiry push — that would be a user-visible notification for our convenience.

### 4.2 `teacher_devices` — the push subscription registry

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
seam (§10). `endpoint` is unique so re-subscribing updates rather than duplicates. The
failure columns exist because a 404/410 at send time is the **only** death signal there is.

### 4.3 RLS

**`teacher_availability`**
- `select`: any authenticated user. Availability is not secret, and cycle 1 already put
  `/find` and `/teachers` behind sign-in.
- `insert` / `update`: `auth.uid() = teacher_id`, in both `using` and `with check`.
- No `delete` policy — rows are toggled, never removed. `on delete cascade` still fires on
  profile deletion, because FK actions do not consult RLS.
- A `before insert or update` trigger rejects a row whose profile is not a teacher, so a
  student cannot park a declaration.

**`teacher_devices`**
- `select`: `auth.uid() = teacher_id` **only**. This is the security assertion of the
  cycle. **A push endpoint is a capability** — anyone holding one can spam that teacher's
  device. A student must never be able to read another user's row.
- `insert` / `update` / `delete`: `auth.uid() = teacher_id`.
- The dispatcher reads across teachers with an elevated credential (§12).

**Registration goes through a `security definer` RPC, not a raw upsert.** Two teachers
sharing one browser profile produce the same endpoint; a plain upsert would have to update
a row owned by someone else, which RLS correctly refuses, and the teacher would see setup
fail for no visible reason. `register_device(endpoint, p256dh, auth, user_agent)`
reassigns the endpoint to the calling user atomically. That is legitimate: the caller
demonstrably holds the subscription, having just obtained it from their own browser.

### 4.4 The roster read — one `security definer` RPC

§4.3 forbids a student from reading `teacher_devices` at all. But §6.1's list needs to know
whether a teacher **has a working device** — so the derived answer has to be published
without the endpoints that produce it.

`available_teachers(curriculum, grade, stream, subject)` is a `security definer` function
returning one row per eligible teacher:

```
teacher_id · full_name · hourly_rate · has_device  (boolean)
```

**It never returns an endpoint, a key, or a device count.** That is the whole reason it
exists: the capability stays server-side, and the student receives a boolean.

It excludes, in SQL:

- teachers who have not declared, or whose lease has lapsed;
- teachers with **no live device and no working device row** — §6.1's "Can't reach you";
- **teachers who are already in a session** — any row in `pending`, `accepted`, `paid` or
  `active` whose deadline has not passed, mirroring `hasOpenRequest`.

That last exclusion is **new and load-bearing.** Until now, hiding a busy teacher was a
side effect of presence untracking when they navigated into the call. That no longer
suffices: a push-only teacher has no presence to drop, so without this check a teacher
would be shown as startable mid-call and pushed a new request while teaching.

The client then intersects the result with the presence roster to split *live* from
*push-only* for §6.2's ranking. **This function is the "list read behind one function"
seam** named in §10 — sharding presence, or moving the whole read server-side, happens here
without touching a caller.

### 4.5 Why new tables and not columns on `profiles`

`profiles` carries the **known-broken update policy** from cycle-1 spec §17.1 — no column
restriction, so any signed-in user can rewrite their own row, including `role`. Cycle 3 is
blocked on it. Hanging a hot column off that table entangles this cycle with that debt.
Separate tables get correct column-scoped RLS from day one and inherit nothing.

## 5. Delivery

### 5.1 The fan-out

Student taps **Start** → the session row is inserted exactly as today
(`src/app/(app)/(student)/teachers/actions.ts`, `requestSession`) → immediately after,
fan out over **every road**, without making the student wait (Vercel `waitUntil`).

- **Road 1 — the live connection.** The existing realtime card in `incoming-request.tsx`.
  Untouched.
- **Road 2 — Web Push** to every registered device for that teacher. Wakes a locked phone.

The roads are independent by design: neither knows about the other, so one failing still
leaves one landing.

**The dispatcher must run on the Node runtime, not Edge** — VAPID signing requires it.

### 5.2 The catch-up query is already built

`incoming-request.tsx` already queries for open requests on mount — written so a teacher
returning from a call misses nothing. **A teacher arriving by notification is the same
situation**, so the card is simply there when they land. Plug into it; do not add a second
mechanism.

When a teacher has both a notification and an open tab, the dashboard **closes the stale
notification on open** (`registration.getNotifications()` → `.close()`). No dismissal push
— that would have to be user-visible, which is the whole constraint.

### 5.3 The accept window: 30s → 60s, for everyone

`ACCEPT_WINDOW_SECONDS` in `src/lib/session.ts` moves from 30 to 60.

Today's 30s was sized for a teacher already staring at the screen. Waking a sleeping phone
does not fit inside it: delivery, noticing, unlocking, tapping.

**Road-dependent deadlines were considered and rejected** — more machinery than the problem
needs, and the server cannot reliably tell whether a tab is live, because presence lives in
the Realtime service, not in Postgres.

**One longer window costs the fast path nothing**, because 30s is a *deadline*, not a
*wait*: a teacher who accepts in 2 seconds still resolves in 2 seconds. Lengthening it only
changes the failure case, where more time means more requests succeed. The only cost is
that a student whose teacher never answers waits 60s instead of 30s — and that population
shrinks anyway, because a teacher we genuinely cannot reach is **not shown to the student
at all** (§6).

The waiting screen stops being silent:
*"Asking Priya… this can take a moment if their phone is asleep."*

## 6. Honest degradation

### 6.1 The four states finally get a mechanism

| State | How we know | In the student list? |
|---|---|---|
| **Available** | Declared, lease valid, live connection | Yes |
| **Reachable** | Declared, lease valid, ≥1 working device, no open tab | Yes |
| **In a session** | Committed to a student right now | No — hidden |
| **Can't reach you** | Declared, lease valid, no open tab **and** no working device | **No — hidden, and the teacher is told** |

Hiding rather than greying follows the rule M2 already set: *every visible card is
genuinely startable.* This is an existing principle applied to a new case, not a new one.

**These are list states, not a fifth pill value.** `StatusPill`'s vocabulary is unchanged —
`offline · available · in_session · unreachable` — and **Reachable** never appears in it,
because a teacher only reads their own status while looking at the dashboard, and a teacher
looking at the dashboard has a live connection and is therefore *Available*. "Reachable" is
a ranking tier in the student's list (§6.2) and nothing else. Cycle 1's `unreachable` value
finally renders, in the case §6.3 describes.

### 6.2 Student side: RANK, DON'T LABEL

Badging push-only teachers ("Online now" vs "Usually responds in a minute") was considered
and **rejected**. A visible second tier means those teachers stop being picked — punishing
exactly the teachers who did what we asked — and it would land hardest on iPhone users,
producing a marketplace that quietly discriminates by handset.

**Instead, sort.** Live-connection teachers rank above push-only ones. The student
naturally picks the fastest, nobody is marked second-rate, and when nobody has a tab open
the push-only teachers still get the work. Honesty through ordering; the one honest
sentence lives on the waiting screen instead.

### 6.3 Teacher side: delete the apology, tell the truth

`availability-toggle.tsx`'s *"Keep this tab open — closing it takes you offline"* is
deleted — cycle 1 anticipated exactly this — and replaced by one of three truths:

- ✅ **Available until 6:00 pm** — we'll notify you even with your phone locked.
- 🔴 **Can't reach you** — you're marked available, but students aren't being shown to
  you. **[Turn on notifications]**
- 🔴 **Can't reach you** — iPhone needs one extra step: tap Share, then *Add to Home
  Screen*.

**A teacher can never again be silently invisible.** That is the acceptance criterion for
this section.

### 6.4 On the record

**A denied notification permission is close to permanent** — browsers will not let us ask
twice. So the prompt does **not** fire on page load. It is asked during onboarding, after
explaining why, and only on an explicit tap (§7.3). Getting this wrong once costs that
teacher the push road forever and makes "Can't reach you" their permanent normal.

## 7. PWA and onboarding

### 7.1 The PWA, kept to the minimum push requires

`public/manifest.webmanifest`: name, `short_name`, `start_url: "/home"` (the role router,
so it serves either role later), `display: "standalone"`, brand teal theme and background,
icons at 192 and 512 plus a maskable variant.

**No icon assets exist in `public/`.** A plain teal mark is generated for this cycle and
swapped when a real logo exists. Recorded so it is a known placeholder, not an oversight.

Service worker at `/sw.js`, scope `/`, doing exactly two things:

- `push` → `showNotification`
- `notificationclick` → focus an open tab, or open `/dashboard`

**No caching, no offline shell, no app shell.** Caching a Next.js app carelessly serves
stale RSC payloads; offline is out of scope; and a push-only worker has almost no failure
surface. Registered from a client component on teacher surfaces only.

### 7.2 Onboarding is a state machine, not a wizard

This shape is forced by a fact verified on 2026-08-29 (§14): **an installed iOS web app has
its own cookie jar, storage and service worker.** A teacher who signs up in Safari and then
installs lands in a *signed-out* app. So the permission ask cannot live in the signup flow
on iOS — the tab where they sign up can never hold a subscription.

Four facts are read on every teacher dashboard load — installed/standalone?,
`Notification.permission`, is there a live `PushManager` subscription, is there a matching
`teacher_devices` row — and collapse into **exactly one next action**:

| Situation | The one action |
|---|---|
| iOS Safari tab, not installed | Illustrated **Share → Add to Home Screen** |
| Installed, or Android/desktop, permission `default` | **Turn on notifications** → `requestPermission()` *on the tap* |
| Permission `denied` | Honest dead end + browser-settings steps; reads as **Can't reach you** whenever no tab is open |
| Subscribed and registered | Nothing — the card is gone |

One component, three appearances:

1. **New teachers** — a full-screen step after signup (`signUpTutor` redirects here instead
   of straight to `/home`). Skippable.
2. **Existing teachers** — the same step once, on their next dashboard visit.
   Retro-onboarding falls out for free rather than needing its own mechanism.
3. **Anyone whose setup later breaks** — a card on the dashboard, because the same four
   facts stop being satisfied.

**Only iOS needs the install.** On Android and desktop, push works in an ordinary tab: one
tap, permission granted, done. The pressure this section applies is therefore an
iOS-shaped cost, not a universal one.

### 7.3 How hard we push it — decided

**Full-screen step after signup, then an honest card. Never blocking.** (User, 2026-08-29.)

Blocking "Available now" until push works was considered and rejected: a teacher with a
live tab open **is** genuinely reachable right now, and refusing them work would remove
behaviour that works today. A dashboard card alone was also rejected: most teachers never
act on a dismissible card, and reachability is the entire point of the cycle.

### 7.4 The iOS re-sign-in cliff, stated plainly

The real iOS path is **install → sign in again → grant permission**: three steps, three
drop-off points. The setup step says so up front rather than letting the teacher discover
it:

> "Add it to your Home Screen, open it from there, and sign in once more — then we'll
> finish setting up."

**Magic-link rescue is rejected, not overlooked.** A link tapped in email opens in *Safari*
— the wrong storage container — putting the teacher back exactly where they started. A
one-time transfer code was considered and judged over-engineering for the volume.

`start_url: "/home"` means the installed app opens on the role router, which sends a
teacher to `/dashboard`, where the setup card is waiting for them.

## 8. Registration lifecycle

Self-healing by default:

- **On every teacher dashboard mount** with permission granted: `getSubscription()` →
  `register_device(...)`. That single idempotent call **is** the re-registration-on-launch
  path. Cheap, and it repairs drift without anyone noticing.
- **`pushsubscriptionchange`** in the service worker re-subscribes with the same VAPID key
  and posts the new endpoint — handled, but **not trusted**. Safari's support for this
  event is thin; the mount-time upsert is the real backstop.
- **Send-time 404/410** deletes the row. Any other failure increments `failure_count` and
  stamps `last_failed_at` without deleting — a transient 500 from a push service must not
  cost a teacher their reachability.
- **Sign-out deletes this device's row.** Otherwise a shared family phone keeps waking a
  teacher who signed out.

### 8.1 The transport port

Mirrors `src/lib/payments/port.ts`, which is the pattern this project already trusts.

```ts
// src/lib/notifications/port.ts
export interface DeviceSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;   // so a second request replaces rather than stacks
}

// `gone` is the only signal a subscription is dead, and it is the ONLY
// reason a device row is ever deleted. Everything else is transient.
export type SendResult =
  | { ok: true }
  | { ok: false; gone: boolean; status?: number; error: string };

export interface NotificationPort {
  readonly transport: "webpush";
  send(sub: DeviceSubscription, payload: NotificationPayload): Promise<SendResult>;
}
```

`src/lib/notifications/index.ts` holds the single `getNotificationPort()` factory, exactly
as payments does. Adding APNs or FCM for the App Store build is one branch here and one
adapter file — no caller changes.

## 9. Testing and verification

### 9.1 Unit (vitest)

Pure functions, extracted deliberately so they are testable without a network:

- **Lease math** — is a declaration live, when lazy renewal fires, what a lapsed lease
  reads as.
- **Roster derivation** — `declaration ∩ presence ∩ not-in-session`, plus §6.2's ranking
  and the hiding of unreachable teachers. The cycle's correctness sits on this function.
- **Onboarding state machine** — §7.2's four facts → one action, exhaustively.
- **Device pruning** — 404/410 kills a row; every other failure increments and does not.
- **Payload building** — what the teacher's notification actually says.

### 9.2 A live-DB probe, in the house style

`scripts/probe-availability.mjs` — no arguments, no standing credential, mints and deletes
its own teacher and student via `probe-accounts.mjs`, and asserts `teacher_availability`,
`teacher_devices`, `sessions` and `profiles` all return to baseline. What it proves:

- A teacher can write **only their own** availability and device rows.
- **A student cannot read another teacher's `teacher_devices` row at all.** This is the
  security assertion of the cycle and the mirror of `probe-session-rls`'s battery.
- A student cannot forge a declaration to make a teacher appear available.
- `register_device` reassigns a shared endpoint without leaking the previous owner's row.
- **`available_teachers` returns no endpoint column**, and excludes a teacher who is
  already in a session — the §4.4 exclusion, asserted against a real seeded session row.
- The dispatcher credential can read devices across teachers (§12).

### 9.3 Encryption proved deterministically

Web Push payload encryption (RFC 8291, `aes128gcm`) and VAPID signing are tested **against
the RFC's published test vectors** — fixed inputs, known ciphertext. That is a real
assertion that runs in CI forever, rather than a live send that can pass for the wrong
reason. Transport failure handling (404/410 → prune) is exercised through the **stubbed
port**, which is what the port boundary is for.

### 9.4 The browser walk — and who performs it

**This debt is three cycles old. It has never been performed, on any cycle**, because no
agent could drive a browser. This cycle closes most of it. The split is exact:

**Machine-verifiable here, via Playwright:** two browser contexts (student + teacher),
presence appearing and disappearing, the incoming-request card, the pay/cancel race, **and
real web push to desktop Chrome** — desktop Chrome talks to the real push service, so the
dispatcher, the registry, the service worker and notification-click → `/dashboard` are all
provable end to end.

> **Caveat that must not be papered over:** Playwright's bundled Chromium ships without
> Google's API keys and frequently cannot register for push at all. The harness runs
> against `channel: "chrome"` — the real installed Chrome — or this half silently proves
> nothing while appearing green.

**Human-only, and it is the user:** an iPhone actually installing to the Home Screen, the
re-sign-in, the permission grant inside the installed app, and a notification arriving **on
a locked screen**; plus Android Doze delay. No agent can hold the phone. The deliverable is
a written checklist with exact expected outcomes, roughly a dozen steps.

**Playwright is accepted into this cycle** (user, 2026-08-29) rather than deferred again —
every prior cycle deferred it, which is why the debt is three cycles old, and this is the
first cycle whose central claim (*a notification actually arrives and opens the right
screen*) is unfalsifiable without it. Scoped tight: the two-browser walk and the push loop,
not a general E2E suite.

### 9.5 Baseline

"154 tests passing / 3 skipped" was measured on the **previous machine**. This one is a
fresh clone. The baseline is re-established by `npm install` and a green run **before** any
before/after number is quoted (§13).

## 10. Seams and scale ceilings

| Seam | The later move it enables |
|---|---|
| Transport behind a port (§8.1) | APNs/FCM adapter for the App Store build |
| Declaration separate from liveness (§3.3) | Neither one's scaling fix disturbs the other |
| List read behind one function — `available_teachers` (§4.4) | Shard presence by subject; or move the whole read server-side |
| Device registry with lifecycle (§8) | Prune, re-register, survive `pushsubscriptionchange` |

**A ceiling already in the code, not fixed this cycle.** `src/lib/presence.ts` uses **one
global channel** for all teachers — its own comment flags this as deliberate. Every student
downloads every online teacher and filters client-side. At ~5,000 online teachers that is
5,000 entries per sync per student. The fix is sharding the channel by taxonomy; it stays
behind that module so it remains a swap rather than a rewrite.

**`postgres_changes` is not adopted for the roster** (§3.2). If real-time roster updates are
ever wanted beyond presence, the answer is Broadcast, not `postgres_changes`.

## 11. Decisions, and what each costs if wrong

| Decision | If wrong |
|---|---|
| Lease, not heartbeat (§4.1) | Teachers lapse mid-shift and lose work; fix is shortening the lease or renewing on more signals — config, not architecture |
| Lease span of 4 hours | Same as above; one constant |
| Accept window 30s → 60s (§5.3) | Students wait longer on unanswered requests; one constant, reversible |
| Rank, don't label (§6.2) | Students can't tell fast from slow teachers and blame the product; adding a label later is additive |
| Hide unreachable teachers (§6.1) | Supply looks thinner than it is; the alternative is showing cards that cannot start |
| Full-screen setup step, never blocking (§7.3) | Some teachers skip setup and stay push-less; the honest card catches them repeatedly |
| Push-only service worker (§7.1) | No offline; adding caching later is additive and safer done deliberately |
| Separate tables, not `profiles` columns (§4.4) | One extra join on the roster read; the alternative entangles cycle 3's security debt |
| `security definer` RPC for registration (§4.3) | A privileged function to review; the alternative is silent setup failure on shared devices |

## 12. Deferred decision — the dispatcher's credential

Sending a push needs a privileged read of `teacher_devices` across teachers. The cycle-1
handoff states the service role is *"solely for the payment webhook."*

- **(a) A dedicated `sb_secret_*` key for the dispatcher** — honours the rule by narrowing
  it, independently rotatable.
- **(b) Reuse the service role** — nothing to set up, but widens the blast radius of the
  all-powerful key into a student-triggerable path.
- **(c) DB trigger + `pg_net` → dispatch endpoint** — most durable, materially more moving
  parts.

**Deliberately deferred and NOT blocking.** Whether (a) is even available depends on the
Supabase project offering the newer key type, which cannot be checked while this machine has
no `.env.local`. **The dispatcher is designed so the credential is one line of config**, and
the choice is made once the environment exists. Nothing else in the design changes either
way.

## 13. Prerequisites — this machine is a fresh clone

**Nothing can be installed, built, run, tested or probed until this is fixed.** No
implementer may be dispatched before it.

- `npm install`
- Rebuild `.env.local`. **It is the user's file (ruling of 2026-08-27): propose the lines,
  let them paste. Never write it.** Needs at least `DAILY_API_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `PAYMENT_PROVIDER=razorpay`.
- **New this cycle:** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  — generated once, pasted by the user into `.env.local` **and** Vercel for Production,
  Preview and Development.

## 14. Facts verified against vendor documentation (do not re-derive)

- Supabase `postgres_changes`: one authorization check per subscriber per change,
  single-threaded, advised against past ~3,000 subscribers; Broadcast is the scale answer.
- Web Push `userVisibleOnly: true` is mandatory — **no silent push, therefore no silent
  reachability probe.** Subscriptions expire and fire `pushsubscriptionchange`.
- **iOS still requires Add to Home Screen for push, as of iOS 26.** An open Safari tab has
  no `PushManager`. As of iOS 26 every site added to the Home Screen opens as a web app
  even without a manifest.
- **An installed iOS web app has a separate cookie jar, storage and service worker from
  Safari.** Session state does not transfer; the teacher signs in again. (Verified
  2026-08-29 — this was not known when the brainstorm paused, and it reshaped §7.)
- **EU/DMA:** standalone PWA support was removed in the EU, so PWAs there open in Safari
  tabs with no push. Our market is India, so this is a footnote — but it is a real
  geographic hole in the push road if the market ever widens.
- Android wakes the service worker outside the browser; Doze can delay delivery.
- `requestSession` inserts then `redirect()`s — the fan-out slots in between, via
  `waitUntil`.
- `incoming-request.tsx` already runs a catch-up query for open requests on mount.
- `presence.ts` uses one global channel for all teachers.

## 15. Risks

- **The iOS funnel is three steps deep** and each one loses teachers. Mitigated by §7.3's
  full-screen step and §6.3's permanently honest state, not eliminated. If iPhone teachers
  cluster at "Can't reach you", that is the signal to revisit — and it will be visible,
  which is the point.
- **A permission denied once is denied forever.** §6.4 is the whole mitigation.
- **Playwright's Chromium may not register for push** (§9.4). If `channel: "chrome"` is not
  used, the harness goes green while proving nothing — the most dangerous failure mode in
  this spec.
- **The locked-phone case remains human-verified.** No automation covers it; the checklist
  is the control.
- **`profiles.role` is still self-writable** (cycle-1 §17.1). Untouched here by design, but
  it means a student could in principle make themselves a teacher and register devices.
  This cycle does not widen that hole; cycle 3 remains blocked on closing it.

## 16. Out of scope, explicitly

Student dashboard · student push · offline/caching · presence sharding · a general E2E
suite · anything requiring migration `0006` · scheduled tier · Stripe Connect · chat.
