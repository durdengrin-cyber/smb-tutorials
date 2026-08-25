# M2 — Presence + Instant Pick: Design Spec

**Date:** 2026-08-25
**Status:** Approved (brainstormed with the user, decisions recorded in §2)
**Parent spec:** `2026-08-24-smb-tutorials-design.md` — this document details M2 (§10) and the surfaces §13 deferred as "just-in-time". Where the two disagree, this one wins for M2.

## 1. Purpose

M2 builds the **core loop**: a teacher marks themselves available, a student sees who is online for their subject right now, picks one, the teacher accepts within a short window, and both land in a video call. M1 delivered accounts, taxonomy and a static browse list; M2 makes the product actually do the thing it exists to do.

Payment stays **stubbed** in M2 — `accepted` leads straight to a live call. M3 inserts Stripe Checkout between those two states.

## 2. Decisions made in brainstorming

These were settled with the user and are not open for re-litigation during planning:

1. **Open tab = online.** A teacher is reachable only while their dashboard is open. Closing the tab drops them offline. No push notifications, no extra vendors. *Accepted cost:* teachers must keep a tab open to earn. If that proves unworkable in practice, Web Push is a self-contained addition later — nothing here forecloses it.
2. **Fixed 60-minute sessions.** The student pays the teacher's full hourly rate; the call is scheduled for 60 minutes with a visible countdown. Either party may leave early; no refund for unused time.
3. **Teacher dashboard carries toggle + incoming request + session history + earnings.** Earnings are derived from completed sessions × the teacher's rate and labelled as *pending payout* — never an invented balance. Payouts stay manual until Stripe Connect.
4. **In-call screen = context bar + countdown, auto-end at 60 minutes.** The session completes when the last participant leaves or the hour expires, whichever comes first. No separate "End session" button.

## 3. Architecture

### 3.1 Presence: one channel, intersected with the database

A teacher who teaches 4 subjects across 3 curricula and 7 grades has ~80 taxonomy combinations. Per-subject presence channels would mean each teacher joining dozens of channels, so instead:

- **One Supabase Realtime presence channel**, `teachers-online`. An available teacher tracks themselves on it with a small payload: `teacher_id`, `full_name`, `hourly_rate`.
- **The database answers *what* they teach; presence answers *whether they are here now*.** The student's list queries `teacher_subjects` for the chosen curriculum/grade/stream/subject (exactly the M1 query), then intersects that set with the presence roster.

This keeps the realtime layer trivial and leaves all taxonomy filtering in Postgres where it already works.

**Busy teachers are hidden, not greyed** (parent spec §13). A teacher in an active session untracks from presence for its duration and re-tracks when it ends, so every visible card is genuinely startable.

### 3.2 The handshake, with no server to run timers

Nothing in this stack is always-on, so no cron can expire a pending request. The deadline is enforced opportunistically in three places:

1. **The student's countdown.** At zero, the client marks its own session `timed_out`.
2. **The teacher's Accept action.** Server-side, it refuses if `now() > accept_deadline`, whatever the UI showed.
3. **Any later read.** A `pending` row past its deadline is treated as timed out wherever it is read.

Point 3 is the one that matters for correctness: without it, a stale `pending` row could be accepted twenty minutes later, dropping a student into a call they have long since abandoned.

Flow:

1. Student clicks **"Start now →"** → a `sessions` row is inserted: `status='pending'`, `accept_deadline = now() + 30s`.
2. The teacher's dashboard is subscribed to inserts on `sessions` where `teacher_id = auth.uid()`; the request prompt appears with a countdown.
3. Teacher **accepts** → server validates the deadline, mints the room (§3.3), sets `status='active'`.
4. Teacher **declines** → `status='declined'`. Deadline passes → `status='timed_out'`.
5. The student's client is subscribed to updates on its own session row and reacts: navigate to the call, or return to the list with the "{teacher} didn't respond — these teachers are free now" highlight (parent spec §13).

**Transport:** Postgres Changes (not Broadcast) for the handshake, because the session row is the durable source of truth and RLS already scopes it to its two participants. A reconnecting client re-reads the row and recovers; an ephemeral broadcast would be lost.

### 3.2.1 Ending a session, with the same constraint

Completion has the identical no-server problem as the accept deadline, and gets the identical three-way treatment. A session is `completed` when:

1. **A participant leaves** and the call is empty — the leaving client writes `completed`.
2. **The countdown reaches zero** — whichever client is still open writes `completed`.
3. **Any later read** of an `active` session whose `started_at + duration_minutes` has passed treats it as completed.

Rule 3 is what stops a session from sitting `active` forever when both browsers are closed mid-call — which would otherwise keep its teacher out of the online list indefinitely, since busy teachers untrack from presence.

### 3.3 Room minting closes spec §15

On accept, and only server-side:

- Create the Daily room with `DAILY_API_KEY`, private, with an `exp` (reuse `getOrCreateRoom` in `src/lib/daily.ts`, already hardened in M0).
- Store `daily_room_url` on the session row.
- Issue a **per-user Daily meeting token** for each party, so the student cannot join as the teacher or reuse a link.
- No client-supplied room names anywhere.

This retires every remaining item in parent spec §15. The M1 auth gate on `/api/rooms` closed anonymous abuse; this closes the rest. Once `/call/[sessionId]` works, **both M0 spike artifacts — the `/call` page and the `/api/rooms` route — are deleted**, along with `src/lib/share.ts` if nothing else uses it. `getOrCreateRoom` in `src/lib/daily.ts` survives: it was written as reusable core, not spike code.

## 4. Data model

Extends `sessions` from parent spec §8:

| Column | Notes |
|---|---|
| `id`, `student_id`, `teacher_id` | FKs to `profiles` |
| `curriculum`, `grade`, `stream`, `subject` | snapshot of what was requested |
| `type` | `instant` for M2 |
| `status` | `pending` → `accepted*` → `active` → `completed`, or `declined` / `timed_out` / `cancelled` |
| `accept_deadline` | timestamptz, set on insert |
| `duration_minutes` | 60 |
| `started_at` | set when the call goes `active`; drives the countdown |
| `hourly_rate` | snapshot of the teacher's rate at request time |
| `daily_room_url` | set server-side on accept |
| `created_at` | |

*`accepted` exists in the parent spec's status list and stays reserved for M3, where payment sits between accept and active. In M2, accept transitions straight to `active`.*

**`declined` is a new status.** The parent spec has only `timed_out`, but decline and timeout are different events — a teacher actively refusing is worth distinguishing from one who wasn't looking, and adding it later is a migration.

**`hourly_rate` is snapshotted** on the session rather than read from the teacher's profile at billing time, so a teacher changing their rate cannot retroactively alter what a past session cost.

**RLS:** a user may read or write a session only where they are its `student_id` or `teacher_id`. Only the teacher may move it to `accepted`/`declined`; only a participant may complete it.

## 5. Screens

**Teacher dashboard** (`/dashboard`) — the page a teacher keeps open:
- Large **"Available now"** toggle with unambiguous online/offline state, and an explicit note that closing the tab goes offline.
- The subjects they are live for, read from `teacher_subjects`.
- **Incoming request prompt:** "New student request — {student} wants {subject} now, ₹{rate}/hr" with Accept / Decline and a countdown ring (parent spec §13).
- **Session history:** student, subject, date, status.
- **Earnings:** completed sessions × rate, labelled *pending payout*, ₹0 when there are none.

**Student browse** (`/teachers`) — M1's page, upgraded: only teachers who are online *and* teach the subject are shown, the CTA becomes **"Start now →"**, and the empty state offers the deferred tiers (request / schedule) as disabled affordances until M4.

**Student waiting** — "Asking {teacher}…" with a countdown ring and **Cancel**.

**In-call** (`/call/[sessionId]`) — a slim context bar (other party, subject, countdown from 60:00) above the Daily frame. Daily supplies camera, mic, screen share and leave.

## 6. Error handling

- **Ghost teachers** (present in the roster but actually gone) are handled by the accept/timeout handshake itself — this is the designed mitigation from parent spec §12, not an additional mechanism.
- **Teacher double-booking:** a teacher already in an active session untracks from presence, and the accept action refuses if they have another `active` session.
- **Student cancels while pending:** `status='cancelled'`; the teacher's prompt disappears via the same subscription.
- **Room creation fails on accept:** the session does not go `active`; both sides see "Couldn't start the call — try again", and the request returns to the list rather than stranding either party in a broken call.
- **Realtime drops:** on reconnect, clients re-read their session row; the row, not the socket, is the source of truth.

## 7. Testing

- **Unit (pure functions, as in M1):** deadline expiry, allowed status transitions, the presence-∩-database intersection, countdown/remaining-time maths.
- **Integration against the live project:** RLS refusing a third party's session, accept-after-deadline refusal, room minting on accept.
- **Manual, two browsers:** the full loop — toggle available, pick, accept, land in the call. This is the one part that cannot be automated here, same as M0's video check.

## 8. Explicitly out of scope for M2

Payment (M3) · request-an-offline-teacher (M4) · scheduled sessions · chat · ratings · Stripe Connect · push notifications · a post-OAuth role picker.

## 9. Risks

- **Presence reliability is now load-bearing.** Mitigated by the handshake, but a student picking a ghost is a real, visible failure — the "didn't respond" recovery path deserves care, not a bare error.
- **The open-tab model may not survive contact with real teachers.** Watch for it; Web Push is the escape hatch.
- **A 60-minute call is a long-lived Daily room.** Room `exp` must comfortably exceed the session, or calls die mid-lesson.
- **Trust & safety remains unaddressed** (parent spec §12) and this is the milestone that first puts a minor and an adult in a live video call. A reporting path and an escalation policy should exist before real users, not before M2 merges — but the gap becomes concrete here.
