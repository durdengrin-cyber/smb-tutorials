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
that expression; the push-only half is new, and §4.4 is where it comes from — with the
final `∨` evaluated on the client, because that is the only place both halves exist.

## 4. Data model

### 4.1 `teacher_availability` — a LEASE, not a heartbeat

A declaration that never expires re-creates the lie in slower motion: a teacher declares
available, vanishes for a month, students keep picking a ghost. A heartbeat fixes that and
buys the write storm above. **A lease gives the same honesty ~240× cheaper:**

| Model | Writes/sec at 10,000 teachers |
|---|---|
| 15s heartbeat | ~667 |
| 4-hour lease, renewed at the halfway point | **~1.4** |

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
alongside `ACCEPT_WINDOW_SECONDS`.

**The renewal rule, stated exactly** — "renews lazily" is not a specification, and two
implementers would build two different things from it:

> A live client renews the lease when **less than half of it remains**, and at most **once
> per 15 minutes** per client. Accepting a session also renews it.

Both halves matter. The halfway trigger is what makes the arithmetic above hold; the
15-minute floor stops several open tabs, or a remount loop, from turning a rare write into
a frequent one.

**The lease is shown to the teacher at the moment they declare**, so lapsing is what they
agreed to rather than a surprise sprung on them. No nagging pre-expiry push — that would be
a user-visible notification sent for our convenience.

**When a lease lapses**, `declared` stays true with a past `declared_until`; every query
filters on `declared_until > now()`, so nothing stale is ever listed. The teacher's own
toggle reads **Offline**, and their next dashboard visit says so plainly — *"Your
availability ended at 6:00 pm."* — rather than leaving them to infer it from a toggle that
silently moved.

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
reassigns the endpoint to the calling user atomically, **matching on all three of
`endpoint`, `p256dh` and `auth`** — not the endpoint alone.

**The risk this leaves, stated rather than assumed away.** The arguments are supplied by
the caller; the function cannot *prove* the caller holds the subscription. Someone who
learned another teacher's full subscription triple could reassign it, which would strip
that teacher's reachability — a quiet denial of service against a rival — and misroute
notifications to their device. Three things make that acceptable rather than open:

- Endpoints and keys **never leave the server**: `teacher_devices` is readable only by its
  owner (§4.3) and the roster RPC publishes a boolean, never a subscription (§4.4). The
  attack presupposes a leak that would already be the more serious incident.
- Requiring all three values means an endpoint glimpsed on its own is not enough.
- Sign-out already deletes the row (§8), which covers the ordinary shared-device case, so
  reassignment is the rare path rather than the common one.

Recorded here so a later reviewer sees a weighed trade-off, not an oversight.

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
- **teachers who are already in a session** — any row in `pending`, `accepted`, `paid` or
  `active` whose deadline has not passed, mirroring `hasOpenRequest`.

That second exclusion is **new and load-bearing.** Until now, hiding a busy teacher was a
side effect of presence untracking when they navigated into the call. That no longer
suffices: a push-only teacher has no presence to drop, so without this check a teacher
would be shown as startable mid-call and pushed a new request while teaching.

**It deliberately does NOT exclude teachers without a device.** The function is SQL and
**cannot see presence** — presence lives in the Realtime service, not in Postgres (§5.3).
A teacher who declared, has the dashboard open, and declined notifications is genuinely
reachable *right now*, and excluding them here would refuse work to a teacher who can take
it — the exact regression §7.3 rejects. So `has_device` is **published, not applied**.

**"Can't reach you" is therefore a client-side join**, and it has to be: it is the only
place where both facts — the boolean from this function and the presence roster from the
Realtime channel — exist at the same time. The client drops a teacher only when
`has_device` is false **and** they are absent from presence, and splits the rest into
live-first / push-only for §6.2's ranking.

**This function is the "list read behind one function" seam** named in §10 — sharding
presence, or moving the whole read server-side, happens here without touching a caller.

#### 4.4.1 Keeping the in-session rule from drifting

The in-session exclusion re-implements `hasOpenRequest` (`src/lib/session.ts`) in SQL —
two expressions of one rule, in two languages, over four statuses and three deadline
columns. That is a real drift risk and is accepted deliberately, because the check must be
server-side to be worth anything. **The tripwire is the probe** (§9.2): it seeds a session
in each status and asserts the RPC's answer matches `hasOpenRequest`'s, so a change to one
without the other fails a run rather than quietly listing teachers mid-lesson.

#### 4.4.2 Freshness — poll on focus, plus a 30-second interval

Presence pushes live updates for the live tier. The push-only tier comes from this
function, which is a **snapshot at page load** — so without refreshing, a teacher who
declares while a student is watching never appears, and one whose lease lapses stays
listed until reload.

**The list re-runs the RPC on window focus and every 30 seconds while visible** (user's
decision, 2026-08-29). Chosen over building a Broadcast stream now: at 2,000 concurrent
students that is ~67 requests/second of plain indexed Postgres reads — unremarkable — and
it needs no new infrastructure. The pacing is per-client and interval-based, so it scales
with students rather than with `teachers × students`, which is precisely the trap §3.2
disqualified `postgres_changes` for.

**The ceiling, stated:** this is comfortable into the low thousands of concurrent students
and gets re-examined there. Because the read is already behind one function, moving it to
Broadcast is a swap at that point, not a rewrite (§10).

### 4.5 Why new tables and not columns on `profiles`

`profiles` carries the **known-broken update policy** from cycle-1 spec §17.1 — no column
restriction, so any signed-in user can rewrite their own row, including `role`. Cycle 3 is
blocked on it. Hanging a hot column off that table entangles this cycle with that debt.
Separate tables get correct column-scoped RLS from day one and inherit nothing.

## 5. Delivery

### 5.1 The fan-out

Student taps **Start** → the session row is inserted exactly as today
(`src/app/(app)/(student)/teachers/actions.ts`, `requestSession`) → immediately after,
fan out over **every road**, without making the student wait — via Next's post-response
work API (`after()` from `next/server` on this version; **confirm against
`node_modules/next/dist/docs/` before writing it**, per CLAUDE.md's standing warning that
this Next.js differs from training data). Notably this needs **no new dependency**: the
earlier note that the fan-out rides Vercel's `waitUntil` would have added one.

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

`start_url: "/home"` means the installed app opens on the role router — which, on that
first launch, finds no session and sends them to `/signin`. That is the step this section
exists to be honest about, so the sequence is written out in full: **`/signin` → `/home` →
`/dashboard`, where the setup card is waiting.** Every launch after that goes straight
through.

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
- **`available_teachers` returns no endpoint column** — asserted on the result shape, so
  a future column addition that leaks a subscription fails the run.
- **The in-session exclusion matches `hasOpenRequest` in all four statuses.** A session is
  seeded in `pending`, `accepted`, `paid` and `active`, plus one past its deadline, and the
  RPC's verdict is compared against the TypeScript function's for each. This is §4.4.1's
  drift tripwire and the reason the duplication is acceptable.
- **A declared teacher with no device row is still returned**, carrying
  `has_device = false` — the §4.4 rule that the RPC publishes reachability rather than
  applying it. A regression here silently refuses work to every teacher who declined
  notifications.
- The dispatcher credential can read devices across teachers (§12).

### 9.3 What the webpush adapter is actually tested for

**Decision: the adapter uses the `web-push` library; we do not hand-roll the crypto.**
RFC 8291 `aes128gcm` payload encryption and RFC 8292 VAPID signing are exactly the code
nobody should be writing themselves, and the port (§8.1) means swapping the implementation
later is one file.

**That decision changes what is worth testing, and the earlier draft of this section got it
wrong.** Asserting the library's output against the RFC's published test vectors would be
testing *someone else's* code and reporting it as coverage — green tests that prove nothing
about anything we wrote. What we actually wrote, and therefore what is tested:

- **Status → verdict mapping.** 404 and 410 set `gone: true`; 429, 500 and a network throw
  set `gone: false`. This is the single most consequential line in the adapter — a wrong
  mapping either deletes a live device on a transient blip or keeps a dead one forever.
- **Payload construction** — title, body, url and the `tag` that makes a second request
  replace rather than stack.
- **Configuration wiring** — a missing VAPID key fails loudly at construction, the way
  `razorpayPort` refuses to start without its webhook secret rather than failing at the
  first charge.
- **Pruning** driven through the **stubbed port**, which is what the port boundary is for.

The genuine end-to-end proof that encryption works is a **real send to a real subscription**
— desktop Chrome in the browser walk (§9.4), and the locked phone in the human checklist.
That is where a broken payload actually surfaces.

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

**`postgres_changes` is not adopted for the roster** (§3.2). The push-only tier refreshes
by polling `available_teachers` on focus and every 30s (§4.4.2) — deliberately chosen over
streaming, because polling scales with *students* while `postgres_changes` scales with
`teachers × students`. When polling is outgrown, the replacement is **Broadcast**, never
`postgres_changes`, and it lands behind the same function.

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
| Separate tables, not `profiles` columns (§4.5) | One extra join on the roster read; the alternative entangles cycle 3's security debt |
| `security definer` RPC for registration (§4.3) | A privileged function to review; the alternative is silent setup failure on shared devices |
| Renew at half the lease, floor 15 min (§4.1) | Write rate drifts from the ~1.4/s estimate; both numbers are constants |
| Poll the roster on focus + 30s (§4.4.2) | Students see a stale list for up to 30s; the fix is Broadcast behind the same function |
| `has_device` published, not applied (§4.4) | Nothing — this is the fix for a defect the first draft carried; reversing it refuses work to reachable teachers |
| `web-push` library, not hand-rolled crypto (§9.3) | A dependency to keep current; hand-rolling it would be the larger risk by far |

## 12. Deferred decision — the dispatcher's credential

Sending a push needs a privileged read of `teacher_devices` across teachers. The cycle-1
handoff states the service role is *"solely for the payment webhook."*

- **(a) A dedicated `sb_secret_*` key for the dispatcher** — honours the rule by narrowing
  it, independently rotatable.
- **(b) Reuse the service role** — nothing to set up, but widens the blast radius of the
  all-powerful key into a student-triggerable path.
- **(c) DB trigger + `pg_net` → dispatch endpoint** — most durable, materially more moving
  parts.

### 12.1 RATIFIED 2026-09-03 — (b), the service role, until cycle 3

**Decision: (b).** Not a default that went unnoticed; a choice, made with the environment in
front of us and written down here.

**What decided it.** The service role was *already* on student-triggerable application paths
before this cycle — `src/app/session/payment-actions.ts` and `src/lib/payments/settle.ts` both
run on it the moment a student pays. So the dispatcher is a third instance of an existing
pattern rather than a new class of exposure, and the cycle-1 handoff's "solely for the payment
webhook" was already broader in practice than its wording.

**Why (a) is less than it looks.** A dedicated `sb_secret_*` key is independently rotatable but
carries the **same privileges**. It narrows the blast radius of a *rotation*, not of a *bug*.
That is worth something, but not what §12 was reaching for.

**What real narrowing would actually require**, and why it is cycle-3 work: a dedicated Postgres
role. `teacher_devices` has RLS enabled with policies scoped `to authenticated` (`0008`), so a
custom role is refused outright — no policy matches it — unless the dispatcher's entire database
surface first becomes `security definer` RPCs it is granted EXECUTE on. That is a real refactor
of `dispatch.ts` plus a migration, and it wants its own review. **It belongs with the
`profiles.role` fix (cycle-1 §17.1)**: both are the same problem stated twice — *the database
should be enforcing this, not the application code* — and designing them together is better than
doing either alone.

**Why deferring costs almost nothing.** The seam is already in the right place. The credential is
one environment variable read in one function, exactly as §12 designed it, so switching later is
a one-line change and not a refactor. Deferring the decision never cost us the option.

**The one thing that WAS wrong, and is now fixed.** The fallback was silent — nothing in the
logs or at deploy said the service role had been reached by default. A ratified decision that
stays invisible in production is the same failure one step later, so `createDispatchClient()`
now warns once per cold start whenever `NOTIFICATION_DB_KEY` is unset.

**Revisit when** the dispatcher grows any query beyond `teacher_devices`, or at cycle 3's
database-enforcement work, whichever comes first.

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
- **New dependencies:** `web-push` (runtime, §9.3) and `@playwright/test` (dev, §9.4).
  Playwright's browser download is a one-time step on this machine, and the harness runs
  against `channel: "chrome"` — see §9.4's caveat.

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
- `requestSession` inserts then `redirect()`s — and `redirect()` throws, so the fan-out
  must be scheduled **before** it, not after. Post-response scheduling is Next's `after()`
  on this version; verify in `node_modules/next/dist/docs/` before implementing.
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
- **One rule, two languages.** The in-session exclusion lives in SQL *and* in
  `hasOpenRequest`. §9.2's parity assertion is the only thing keeping them honest; if that
  probe is ever weakened, teachers get pushed requests mid-lesson and nothing complains.
- **`register_device` cannot prove the caller owns the subscription** (§4.3). Mitigated by
  keeping endpoints server-side and matching all three subscription values; not eliminated.
- **`profiles.role` is still self-writable** (cycle-1 §17.1). Untouched here by design, but
  it means a student could in principle make themselves a teacher and register devices.
  This cycle does not widen that hole; cycle 3 remains blocked on closing it.

## 15.1 Spike → production hardening (cycle-2 debts to close)

Required by `CLAUDE.md`: a shortcut with a functional, security or cost cost **in service** is
recorded here rather than left silent. Written 2026-09-01, at the close of the final pre-merge
review.

**1. ~~`NOTIFICATION_DB_KEY` is unset~~ — CLOSED 2026-09-03. Ratified as §12 option (b); see
§12.1 for the reasoning and the revisit trigger, and note the fallback is no longer silent.
Retained below for the record.** The dispatcher runs as the service role — §12 option (b),
originally reached by default rather than by choice.** §12 deferred this until the environment existed. It now
exists, and nothing warns at boot or deploy that the fallback took effect. Reviewed for
weaponisation and none found: `notifyTeacherOfRequest`'s only queries are `.eq("teacher_id",
teacherId)` where `teacherId` has already passed the session-insert trigger's `role = 'teacher'`
check, and `.in("id", …)` over ids that query itself returned — no injection surface, no
caller-controlled table or column. So (b) is defensible, not dangerous. **But it is a default
nobody chose, on a student-triggerable path, for the key the cycle-1 handoff reserves for the
payment webhook alone.** Close by setting `NOTIFICATION_DB_KEY` to a dedicated `sb_secret_*` key
(option (a)) once the project's key type is confirmed, or by ratifying (b) explicitly here.

**2. Migration `0012` must be applied before this app code deploys.** Same ordering hazard as
`0011`, and the second instance of it this cycle. `record_device_results` is the RPC that
increments `failure_count` and stamps `last_ok_at`; the dispatcher calls it on every delivery.
Unapplied, the call fails and is logged, and the counter is silently lost — the `last_failed_at`
stamp is deliberately kept as a separate PostgREST write ahead of it so that the *record that
anything went wrong* survives the gap. **Verify `0012` is live before deploy.**

**3. Nothing in this cycle has ever executed a real push.** Task 16 (Playwright) was dropped by
user decision 2026-09-01 and Task 17 (the locked-phone walk) is unperformed; VAPID keys are
generated but not installed. The service worker, the encryption, `notificationclick` →
`/dashboard`, and the iOS install flow are proven **by construction only** — no test, probe or
human has observed one. This is accepted, but it means the delivery road carries no execution
evidence at all until Task 17 runs.

**4. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is inlined at build time**, in the Node environment as well
as the browser bundle, and `getNotificationPort()` reads it server-side for signing. Adding the
VAPID vars to Vercel therefore requires a **redeploy**, not just an env save, or every dispatch
throws "VAPID public key is missing" — swallowed by `after()`'s catch and visible only in logs.

**5. `available_teachers`' four-status parity is probed at half strength.** §9.2 promises seeds
in all four statuses; `probe-availability.mjs` seeds only `pending` ×2 and `accepted` ×2. The
`paid`/`active` exclusion branches are verified by static parity-reading alone, and §15 names
this probe as the *only* control against the "one rule, two languages" drift between the RPC's
SQL and `session.ts`'s TypeScript. Hand-traced and correct today; the control, not the code, is
what ships weak.

**6. Every `security definer` RPC on this branch is EXECUTE-reachable by `anon`.** Supabase ships
`ALTER DEFAULT PRIVILEGES` granting EXECUTE on new `public` functions to `anon` and
`authenticated` **by name**, and in Postgres `revoke ... from public` does not remove a grant a
named role holds. Verified live: `register_device` and `available_teachers` are both reachable
with only the anon key. Neither is exploitable — they defend inside their own bodies
(`register_device` raises `not authenticated` on a null `auth.uid()`; `available_teachers`
returns `[]`) — so this is noted, not a defect. **But the pattern bit once already:** `0012`'s
first version revoked from `public` and `authenticated` only, leaving `anon` able to call a
`security definer` function that bypasses RLS, i.e. an unauthenticated write against any
teacher's device row. Caught by testing the revoke instead of assuming it, fixed in `0012`,
re-verified (anon → 401, service_role → 204). **Any future function here must revoke from
`anon` and `authenticated` by name, and the revoke must be tested, not assumed.**

**7. `teacher_devices`' update policy has no column restriction.** `0008`'s
`teacher_devices_update` is `using (auth.uid() = teacher_id) with check (auth.uid() =
teacher_id)` — correct on ownership, silent on columns, so a signed-in teacher can already
rewrite their own `failure_count` and `last_ok_at` directly through PostgREST and mask a dead
device. Pre-existing and low-impact (it only harms that teacher's own reachability), and
structurally the same shape as cycle-1 §17.1's `profiles.role` finding. Restrict the columns
when that one is closed.

**8. `register_device` caps nothing.** The dispatcher now bounds its own fan-out at
`MAX_DEVICES_PER_TEACHER = 20`, which caps the cost regardless of what the registry holds, but
the table itself will still accept unbounded rows per teacher. Trim inside `register_device` if
the row count ever matters for reasons other than fan-out.

**9. `notification_events` has no retention sweep.** `0015` writes one row per device per
session request and nothing prunes it. At trial volume that is nothing; add a sweep before it
matters. Recorded here rather than left to be discovered.

**10. Session recording is a launch requirement, decided 2026-09-04, deliberately NOT built
yet.** When it ships, three things move together or the product contradicts itself:
`createSessionRoom` gains the recording property; the payment notice changes from *"sessions may
be recorded"* to *"will be"*; and `src/app/(marketing)/terms/page.tsx:186` — which today states
**"No Recording Without Consent: you may not record… any portion of a live session"** — must be
rewritten in the SAME commit. Shipping recording while that clause stands would put a
contradiction in production. Budget ~₹50–75 per 60-minute session for recording plus storage
(verify against daily.co/pricing), which is a real 10–15% slice of a ₹500 lesson and should be
priced in rather than discovered.

## 16. Out of scope, explicitly

Student dashboard · student push · offline/caching · presence sharding · a general E2E
suite · anything requiring migration `0006` · scheduled tier · Stripe Connect · chat.

**11. Sentry source maps — plugin wired, awaiting a token.** `withSentryConfig` is in
`next.config.ts` and **inert** until `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are
all set. Guarded explicitly rather than trusting the plugin to notice: Sentry's own skip logic
keys off the bundler, not off whether a token exists. Verified today that the build passes with
it inert, that the output contains **zero** client source maps, and that production returns 403
for a `.map` probe — so nothing is exposed now, and `deleteSourcemapsAfterUpload` keeps that true
once uploads begin. ORIGINAL NOTE: `SENTRY_AUTH_TOKEN` is unset, so production stack
traces arrive minified — the error, route and frequency are readable, the line numbers are not.
Adding it requires `withSentryConfig` in `next.config.ts`, which was deliberately left out rather
than risk this project's Turbopack build on a step that cannot work until the token exists. Do it
when the Sentry account has an auth token.

**12. ~~Sentry preview env var is unset~~ — CLOSED 2026-09-04.** Set for **all** preview
branches, along with the three VAPID vars, via the Vercel REST API
(`POST /v10/projects/:id/env` with `target:["preview"]` and no `gitBranch`) — which does exactly
what the CLI refuses to do non-interactively. The three VAPID vars had been scoped to
`cycle-2/durable-availability`; that branch is merged, so every future preview would have had no
push keys. Those stale branch-scoped duplicates were deleted rather than left to drift out of
sync with the all-branch copies.
