# SMB Tutorials — Design Spec

**Date:** 2026-08-24
**Status:** Draft for review

## 1. Purpose

A service-provider marketplace connecting **students** with **teachers** for 1:1 tutoring delivered over **peer-to-peer video**. Students discover a teacher, book a time, pay, and meet in a live video session. It is a paid service — money moves from student to teacher, with the platform taking a fee over time.

## 2. Guiding constraints

- **Serverless.** No always-on server or VPS to run or maintain. Everything is a managed service called from the app or from on-demand serverless functions.
- **Push-to-deploy.** GitHub-connected auto-deploy on Vercel; push to `main` = production deploy, PRs = preview deploys.
- **Solo developer, MVP-first.** Ship the core loop fast, low operational burden, low/predictable early cost. Defer anything that is a project unto itself.

## 3. Architecture

| Layer | Choice | Role |
|---|---|---|
| Frontend + serverless API | **Next.js (App Router) on Vercel** | UI, routing, and serverless API routes / Server Actions in one repo |
| Auth + roles | **Supabase Auth** | Email/social login; `student` / `teacher` role; JWT feeds row-level security |
| Database | **Supabase (Postgres + realtime)** | Profiles, bookings/sessions, with row-level security |
| Video | **Daily.co** | WebRTC video; signaling + STUN + TURN handled by the service |
| Payments | **Stripe Checkout** (MVP) → **Stripe Connect** (later) | Collect payment at booking; marketplace payouts deferred |
| Transactional email | **Resend** | Booking confirmations, room links, reminders |
| Styling | **Tailwind CSS + shadcn/ui** | Fast UI; shadcn is copy-paste, not a runtime dependency |

**Why this shape:** Two independent architecture reviews (including a fresh-context one) converged on it. Every piece is managed, the deploy loop matches a proven GitHub→Vercel workflow, and there is no server to operate. The frontend/deploy philosophy mirrors an existing app the developer runs (static frontend on Vercel, backend concerns handled off-box) — but adapted to Next.js because this app has logged-in flows, dashboards, and serverless glue that a vanilla static build would fight.

### Auth decision note
Supabase Auth is chosen over Clerk to keep the vendor count low and let roles live in the same database as the data they gate (via row-level security). Clerk remains a valid swap if faster auth wiring is preferred later; it does not change any other layer.

## 4. The one hard truth about "serverless" video

WebRTC needs three things, and one of them cannot be truly serverless:

- **Signaling** — peers exchange connection info before the call. Handled by Daily.
- **STUN** — helps peers find their public address; covers ~80% of connections. Handled by Daily.
- **TURN** — a relay that carries the actual media when direct P2P fails (symmetric NAT, corporate/mobile firewalls — ~15–20% of real connections). This relays live video, so it costs bandwidth and **someone must run relay nodes**.

We do not eliminate TURN — we outsource it. **Daily.co runs signaling + STUN + TURN**, so there is nothing for us to operate. Integration is: create a room via Daily's REST API, store its URL against the session, both parties join. Rolling our own signaling/TURN is explicitly out of scope until scale justifies it.

## 5. Data model (MVP)

Minimal tables in Supabase:

- **`profiles`** — `id` (FK to auth user), `role` (`student` | `teacher`), `name`, `bio`, and for teachers: `subjects`, `hourly_rate`, `available_hours` (free-text or simple structure for MVP).
- **`sessions`** (a booking) — `id`, `student_id`, `teacher_id`, `requested_time`, `status` (`requested` | `confirmed` | `completed` | `cancelled`), `daily_room_url`, `stripe_payment_id`.

Row-level security: a user can read teacher profiles, but can only read/write `sessions` where they are the student or the teacher.

## 6. User flow (MVP core loop)

**Find a teacher → book a time → pay → join video call.**

1. Student browses a list of teacher profiles (no search algorithm yet — a plain list).
2. Student opens a teacher, picks a time via a **simple request form** (not a calendar widget), submits.
3. On confirmation + successful **Stripe Checkout** payment: a serverless function calls Daily.co to create a room, stores the room URL on the `session` record.
4. Both parties receive the room link via **Resend** email.
5. At session time, both click the link and join the Daily video room.

## 7. Build order (MVP milestones)

- **M0 — Deploy skeleton + video spike.** Next.js repo → GitHub → Vercel auto-deploy with a placeholder page. Wire Daily.co and get **two browsers into a video call**. De-risks the hardest part on day one.
- **M1 — Auth + profiles (wk 1–2).** Supabase Auth with `student`/`teacher` roles. Teacher creates a profile; student browses a list of teachers.
- **M2 — Booking + video room (wk 3).** Simple booking request form; on confirmation, create a Daily room, store the URL, email both parties.
- **M3 — Payments (wk 4).** Stripe Checkout to collect payment from the student at booking. Teachers paid manually until volume justifies Stripe Connect.

## 8. Explicitly deferred (YAGNI for MVP)

- **Stripe Connect** — teacher KYC, payout timing, platform-fee logic; a 2–4 week project. Use Checkout + manual payouts first.
- **Real scheduling** — timezones, cancellation, reminders, rescheduling. Start with a plain form; adopt **Cal.com** (embeddable, open source) before building a calendar UI.
- **Search / matching algorithm** — plain teacher list until there are enough teachers to warrant search.
- **Rich chat** — video-only for MVP.

## 9. Risks / things easy to underestimate

- **No-show & refund policy must exist before the first real payment.** Who gets refunded on a no-show, who decides, how disputes resolve. Stripe's refund API is easy; the *policy* is the work. Decide it before money is real.
- **Trust & safety cannot be retrofitted.** If any students may be minors, a ToS, a reporting mechanism, and an escalation policy must be thought through early. Background checks are not required at MVP; a defined escalation path is.
- **Bad video gets blamed on the platform** regardless of whose connection is at fault. Daily.co's per-session quality dashboard (packet loss, jitter, bitrate) is how we tell platform issues from user-connection issues — read it when users complain.
- **TURN cost is real at scale.** Predictable but non-zero; e.g. ~1,000 hours/month of 1:1 sessions ≈ several hundred dollars in video infra. Fine for a profitable marketplace; budget it.
- **Serverless cold starts** (~200–500ms on Vercel) are fine for everything in this MVP, including Stripe webhooks.

## 10. Out of scope for this spec

Native mobile apps, group/classroom (many-to-many) video, recording/playback, and any AI features. Revisit after the core loop is validated with real users.
