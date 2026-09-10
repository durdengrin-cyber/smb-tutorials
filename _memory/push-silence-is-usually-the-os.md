---
name: push-silence-is-usually-the-os
description: A web push FCM accepts with HTTP 201 still shows nothing if the OS or the browser is blocking notifications — check those before reading any code.
metadata:
  type: project
---

On 2026-09-10 the push chain appeared completely broken: no notification arrived on any account,
all day, including a real tutor application that should have alerted the admin. Most of a session
went into it. **Two environmental settings, neither observable from inside the app:**

1. **Brave ships with "Use Google services for push messaging" OFF.** `pushManager.subscribe()`
   then rejects with `AbortError: Registration failed - push service error`.
   `brave://settings/privacy`, then **relaunch** — it does not take effect until you do.
2. **macOS was blocking notifications for Brave entirely.** This one is the trap: everything
   downstream succeeds. The subscription is live, `register_device` writes the row, VAPID signs,
   and **FCM returns HTTP 201** — which means *queued*, never *displayed*. Nothing in this repo
   can see that the OS swallowed it. System Settings → Notifications → the browser.

**Check both BEFORE reading any code.** A 201 with no notification is almost never our bug, and
the code path here was correct throughout while I diagnosed two defects in it that did not exist
(see [[read-the-whole-function-before-diagnosing]]).

**The probe that isolates it**, boundary by boundary, without touching the app — admins → their
device rows → `webpush.setVapidDetails` → `sendNotification`, printing what each stage returns.
Written on the day as a scratch script; `scripts/probe-device-registration.mjs` is the committed
relative that covers the database half. The decisive reading is the FCM status: 201 means the
fault is downstream of everything we control.

**What was genuinely ours**, and is fixed: `0029` widened `register_device`'s role gate but
`0009`'s `teacher_devices_guard` trigger still required `role = 'teacher'`, so an admin could
never insert a device — `0029` was applied in production and did nothing. `0030` closes it and
`src/lib/device-registration.test.ts` pins the two role lists together.

Proven end to end once both settings were fixed: a real application put "New teacher application
— Igris Commander applied to teach 8 subjects" on the operator's screen, through
`notifyAdminsOfApplication` → `applicationPayload` → VAPID → FCM → our own service worker.
