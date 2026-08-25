# SMB Tutorials — Design Spec

**Date:** 2026-08-24 (rev. 2 — product model + domain updated from the demo)
**Status:** Draft for review
**Tagline:** *One Student, One Teacher.*

## 1. Purpose

A marketplace connecting **students** with **teachers** for 1:1 tutoring delivered over **peer-to-peer video**, aimed at the **Indian K-12 market** (CBSE / State Board / ICSE, grades 6–12). The core experience is **instant, on-demand tutoring**: a student picks a subject, sees teachers who are **online right now**, chooses one, pays, and is in a live video lesson within moments. It is a paid service — money moves from student to teacher, with the platform taking a fee over time.

## 2. Product model — three tiers of availability

The product is one system that degrades gracefully across three tiers. This is deliberate: the instant tier is the differentiator, and the other two tiers keep the product usable when no teacher is online (solving the cold-start problem by design).

1. **Instant pick (primary).** Student selects curriculum → grade → stream → subject, then sees a **live list of teachers currently online** for that subject and **chooses one**. The app does *not* blind-match — the student picks. The chosen teacher gets an incoming request and **accepts within a short window**; on accept, payment then video call. If the teacher doesn't accept in time, the student returns to the list (timeout).
2. **Request a specific teacher (fallback).** If a student wants a specific teacher who is **offline**, they send a request; that teacher is notified and can accept later, which then connects or schedules them.
3. **Scheduled (add-on).** Student books a specific teacher for a **future time**; both join at that time. Additive, built after the instant + request tiers work.

## 3. Guiding constraints

- **Serverless.** No always-on server or VPS to run or maintain. Everything is a managed service called from the app or from on-demand serverless functions.
- **Push-to-deploy.** GitHub-connected auto-deploy on Vercel; push to `main` = production, PRs = preview.
- **Solo developer, MVP-first.** Ship the instant loop fast, low operational burden, low/predictable early cost. Defer anything that is a project unto itself.

## 4. Design reference — the demo

An existing **Create React App demo** (`/Users/Tyler/Downloads/SMB-Tutorial-main`, single 2,387-line `src/App.js`) is the **UI/UX and requirements blueprint**, not a code foundation. It has **no backend** — its only server touch is a Google Apps Script writing the tutor-signup form to a Google Sheet; auth is faked (`alert(...)`), and video is not integrated. We **rebuild it on the stack below** while preserving its look, flows, domain taxonomy, form fields, and copy.

- **Visual direction:** teal accent palette, clean/light, Unsplash photography, "One Student, One Teacher" tagline.
- **Screens present in the demo (reuse as the inventory):** `home, teachers (browse), request, notify, waiting, timeout, payment, form (student booking), custom-request, signin, signup, tutor-signup, terms`.

## 5. Architecture

| Layer | Choice | Role |
|---|---|---|
| Frontend + serverless API | **Next.js (App Router) on Vercel** | UI, routing, serverless API routes / Server Actions in one repo |
| Auth + roles | **Supabase Auth** | Email + Google login; `student` / `teacher` role; JWT feeds row-level security |
| Database | **Supabase (Postgres)** | Profiles, subject taxonomy, sessions/requests, with row-level security |
| **Real-time presence** | **Supabase Realtime (Presence)** | Which teachers are **online/available now**; live-updates the instant list and delivers incoming requests |
| Video | **Daily.co** | WebRTC video; signaling + STUN + TURN handled by the service |
| Payments | **Stripe Checkout** (MVP) → **Stripe Connect** (later) | Collect payment on teacher-accept; marketplace payouts deferred |
| Transactional email/notifications | **Resend** | Request notifications, receipts, scheduled reminders |
| Styling | **Tailwind CSS + shadcn/ui** | Fast UI; shadcn is copy-paste, not a runtime dependency |

**Why this shape:** Two independent architecture reviews (including a fresh-context one) converged on it. Every piece is managed and there is no server to operate. Crucially, the instant/on-demand model needs **only presence** (not a matching engine) — and Supabase Realtime provides presence natively, so "instant" stays fully serverless.

### Auth decision note
Supabase Auth is chosen over Clerk to keep the vendor count low and let roles live in the same database as the data they gate (via row-level security). Clerk remains a valid swap; it does not change any other layer.

## 6. The one hard truth about "serverless" video

WebRTC needs three things, and one cannot be truly serverless:

- **Signaling** — peers exchange connection info before the call. Handled by Daily.
- **STUN** — helps peers find their public address; covers ~80% of connections. Handled by Daily.
- **TURN** — a relay that carries the media when direct P2P fails (symmetric NAT, mobile/corporate firewalls — ~15–20% of real connections). This relays live video, so it costs bandwidth and **someone must run relay nodes**.

We do not eliminate TURN — we outsource it. **Daily.co runs signaling + STUN + TURN.** Integration: create a room via Daily's REST API on teacher-accept, store its URL on the session, both parties join. Rolling our own signaling/TURN is out of scope until scale justifies it.

## 7. Domain taxonomy (from the demo)

- **Curriculum:** `CBSE`, `State Board`, `ICSE`
- **Grade:** `6th`–`12th`
- **Stream (grades 11–12):** `Science`, `Commerce`, `Arts`
- **Subjects by stream:**
  - Science: Physics, Chemistry, Biology, Mathematics
  - Commerce: Accountancy, Business Studies, Economics, Mathematics
  - Arts: History, Geography, Political Science, Economics, Sociology

This taxonomy defines both what a teacher lists as teachable and what a student selects when requesting a lesson.

## 8. Data model (MVP)

Tables in Supabase (row-level security throughout):

- **`profiles`** — `id` (FK to auth user), `role` (`student` | `teacher`), `full_name`, `email`, `phone`. Teacher-only: `qualification`, `experience`, `specialization`, `teaching_level`, `hourly_rate`, `hours_per_week`, `bio`, `demo_video_url`.
- **`teacher_subjects`** — `teacher_id`, `curriculum`, `grade`, `stream`, `subject` (one row per subject a teacher teaches; drives the instant list filter).
- **`sessions`** — `id`, `student_id`, `teacher_id`, `curriculum`, `grade`, `stream`, `subject`, `type` (`instant` | `request` | `scheduled`), `status` (`pending` | `accepted` | `paid` | `active` | `completed` | `cancelled` | `timed_out`), `scheduled_time` (nullable — instant/request are null until arranged), `daily_room_url`, `stripe_payment_id`, `created_at`.

**Presence** is *live*, not a durable table: teachers publish availability on a Supabase Realtime presence channel keyed by subject; the student's instant list subscribes. A teacher's coarse "accepting students" flag may be mirrored to `profiles` for display, but the source of truth for "online now" is the presence channel.

RLS: anyone can read teacher `profiles` + `teacher_subjects`; a user can read/write a `session` only where they are its student or teacher.

## 9. Core user flow — instant tier

1. Student selects **curriculum → grade → stream → subject**.
2. App shows **teachers online now** for that subject (live via presence).
3. Student **picks a teacher** → a `session` is created (`type=instant`, `status=pending`); the teacher receives the incoming request in real time.
4. Teacher **accepts within the window** (`status=accepted`). On timeout, `status=timed_out` and the student returns to the list.
5. Student **pays** via Stripe Checkout (`status=paid`). *(Payment after accept avoids refunds for declined/timed-out requests.)*
6. A serverless function creates a **Daily room**, stores `daily_room_url`, `status=active`; both join the call.
7. On end, `status=completed`.

*(Request tier: same shape but the teacher is offline at step 2 — student sends the request, teacher is notified via Resend, accepts later, then steps 5–7. Scheduled tier: `scheduled_time` set, both join at that time.)*

## 10. Build order (MVP milestones)

- **M0 — Deploy skeleton + video spike.** *(Plan already written.)* Next.js → GitHub → Vercel auto-deploy; wire Daily.co; get **two browsers into a video call**. Model-agnostic; de-risks the hardest part first.
- **M1 — Auth, profiles, taxonomy, onboarding.** Supabase Auth (email + Google) with `student`/`teacher` roles. Subject taxonomy seeded. Teacher onboarding form (the demo's `tutor-signup` fields) → `profiles` + `teacher_subjects`. Student can browse the teacher list.
- **M2 — Presence + instant pick (core loop).** Teacher "available now" toggle publishing presence; student subject-select → live online list → pick → teacher accept/timeout handshake → **Daily room** on accept. Payment stubbed here.
- **M3 — Payments.** Insert **Stripe Checkout** between accept and room creation. Teachers paid manually until volume justifies Stripe Connect.
- **M4 — Request fallback.** Request a specific **offline** teacher → Resend notification → teacher accepts later → connect.

## 11. Explicitly deferred (YAGNI for MVP)

- **Scheduled tier** — the future-time add-on; build after instant + request work. When built, adopt **Cal.com** (embeddable, open source) before a custom calendar.
- **Stripe Connect** — teacher KYC, payout timing, platform-fee logic; a 2–4 week project. Use Checkout + manual payouts first.
- **Search / ranking** — plain filtered list (by subject) until volume warrants search/sorting.
- **Rich chat** — video-only for MVP.

## 12. Risks / things easy to underestimate

- **Presence reliability is now core.** A student picking a teacher who just went offline must fail gracefully (the accept/timeout handshake covers this). Handle stale presence (dropped connections) so the "online now" list doesn't show ghosts.
- **Payment timing.** Charging *after* teacher-accept (not on pick) is the design choice that avoids refunding declined/timed-out instant requests. Keep it.
- **No-show & refund policy must exist before the first real payment.** Who gets refunded, who decides, how disputes resolve. Stripe's refund API is easy; the *policy* is the work.
- **Trust & safety cannot be retrofitted.** Students here are **minors (K-12)** — a ToS, reporting mechanism, and escalation policy must be thought through early. Background checks not required at MVP; a defined escalation path is.
- **Bad video gets blamed on the platform** regardless of whose connection is at fault. Daily.co's per-session quality dashboard (packet loss, jitter, bitrate) is how we distinguish platform vs. user-connection issues.
- **TURN cost is real at scale.** Predictable but non-zero; ~1,000 hours/month of 1:1 ≈ several hundred dollars in video infra. Budget it.

## 13. UI/UX decisions (from the visual design session)

These decisions cover the screens the demo never built (the instant/presence surfaces). Existing screens (home, browse, signup, terms, etc.) are rebuilt faithfully from the demo.

- **Visual language:** reuse the demo — teal→cyan gradient card headers, emoji avatars, ⭐ rating, `₹{rate}/hr`, gradient CTA buttons, light/clean. "One Student, One Teacher."
- **Online-now list:** **hide busy teachers** — only "Available now" (green) cards are shown, so every visible card is instantly startable; busy teachers reappear when they free up. CTA label is **"Start now →"** (not "Book Now"). Header echoes the demo: "Showing teachers for {subject} • {curriculum} • {grade}".
- **Empty state** (nobody online for the subject): a panel offering **"Request a teacher"** and **"Schedule for later"** — this is where the fallback tiers surface.
- **Accept handshake (two-sided):**
  - *Student:* "Asking {teacher}…" with a countdown ring + **Cancel**.
  - *Teacher:* a live "New student request — {student} wants {subject} now, ₹{rate}/hr" prompt with **Accept / Decline** and a countdown.
  - Accept window default **~30s** (tunable).
  - On accept → payment → both join the call.
  - On **decline or timeout → return to the list with a "{teacher} didn't respond — these teachers are free now" highlight** (option C: preserves student choice, nudges a fast retry).
- **Still to design (just-in-time, before their milestone):** the in-call video screen, and the teacher dashboard (availability toggle + incoming-request management).

## 14. Out of scope for this spec

Native mobile apps, group/classroom (many-to-many) video, recording/playback, and AI features. Revisit after the instant loop is validated with real users.

## 15. Spike → production hardening (M0 debts to close — must not ship as-is)

The M0 `/call` page and `/api/rooms` route are a **spike** — they prove the Daily plumbing and are replaced by the real in-call + session flow. These known shortcuts must be closed in the milestone noted, not band-aided:

- **`/api/rooms` is currently public + unauthenticated** (and live on Vercel — anyone hitting it creates Daily rooms on our account = cost/abuse). **Close in M1/M2:** rooms are minted **server-side only**, on an **authenticated teacher-accept**, tied to a `session` row. No client-supplied room names in production.
  - *(M1, done: the route now rejects anonymous callers with 401 — anonymous cost/abuse is closed, verified. **Still open for M2:** the room is created on client request with a client-supplied name, not server-side on an authenticated teacher-accept tied to a `session` row. Any signed-in user can still mint an arbitrarily-named room.)*
- **Rooms never expire.** `getOrCreateRoom` must set an `exp` so rooms self-clean. *(Hardened in `daily.ts` now — reusable core.)*
- **Client-triggered room creation** (browser effect calls `/api/rooms`) is the wrong shape for service. Production creates the room server-side when the session is arranged, stores `daily_room_url` on the session, and hands each party a scoped join token.
- **Join tokens / access control:** production rooms should be private with per-user meeting tokens (student vs teacher), not open room URLs.

Rule: no M0 spike shortcut reaches real users. Each item above is a gate on its milestone.
