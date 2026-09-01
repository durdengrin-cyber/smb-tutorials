# Locked-phone verification walk

**Cycle 2 — durable availability. Spec §9.4. Task 17.**

This is the half of the browser walk **no agent can perform**. Every prior cycle deferred it;
that debt is three cycles old. The central claim of this cycle — *a notification actually
arrives on a locked phone and opens the right screen* — is unfalsifiable without it.

**Performed by: the user.** On a real iPhone and a real Android phone. Not a simulator: a
simulator does not have a lock screen that receives a real push from Apple's push service.

---

## Before you start

- [ ] **VAPID keys are installed** in `.env.local` **and** in Vercel:
      `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
      (a `mailto:` or `https:` URL — chosen, not generated).
      **Without these nothing below can pass** — the dispatcher has no credential to sign with.
- [ ] You are testing against a deployment the phone can reach (a Vercel preview or production),
      **not** `localhost`. iOS will not install a Home Screen app from an untrusted origin.
- [ ] Two accounts you can sign into: one **teacher**, one **student**.
- [ ] A second device (laptop is fine) to drive the student side.

**Timing constraint that shapes steps 5–8:** the accept window is **60 seconds**
(`src/lib/session.ts:9`, `ACCEPT_WINDOW_SECONDS = 60`). From the moment the student sends the
request you have 60 seconds to reach the accept button. Have the phone locked and in your hand
before the student taps.

---

## The walk

Each step names its exact expected outcome. Record the actual outcome next to it — including
"as expected". A step that half-worked is a failure; write what you saw.

1. [ ] **iPhone Safari → sign in as the teacher → `/dashboard`.**
       The setup card reads **"One more step so students can reach you"** and tells you to tap
       Share, then Add to Home Screen.

2. [ ] **Share → Add to Home Screen → open it from the Home Screen.**
       **It asks you to sign in again.** This is expected, not a bug — the installed app has a
       separate cookie jar from Safari (spec §7.4). Confirm it rather than being surprised by it.
       The app opens at `/home` (the manifest's `start_url`).

3. [ ] **Sign in → `/dashboard` → the card now reads "Turn on notifications".** Tap it and
       **grant** permission at the iOS prompt.
       The card disappears once permission is granted and the device is registered.

4. [ ] **Go available.** The pill reads **"Available now"**, and beneath it:
       **"Available until {time} — we'll notify you even with your phone locked."**

5. [ ] **Lock the phone.** Screen off, in your hand.
       From the other device, sign in as the student, find that teacher, and request a session.

6. [ ] **A notification appears on the lock screen within ~10 seconds.**
       Title: **"New session request"**. Body: **"{student name} · {subject}"**.
       *This is the step the whole cycle exists to prove.* If it does not arrive, stop and
       record it — nothing after this matters until it does.

7. [ ] **Tap the notification.** The app opens on `/dashboard` with the request card **already
       showing**, and the countdown **has time left**. It must not open a second window, and it
       must not land on `/home` first.

8. [ ] **Accept.** Both parties reach the video call.

9. [ ] **Repeat steps 4–7 on Android.** Note any **Doze** delay — if the notification takes
       materially longer than ~10 seconds with the phone idle, write down how long. Android may
       batch pushes for a dozing device; that is the platform, but we need the real number.

10. [ ] **Home-screen icon — an observation, not a pass/fail.**
        Note what iOS actually renders as the Home Screen icon. The app ships **no
        `apple-touch-icon` link**: `src/app/layout.tsx:19` sets `appleWebApp` (capable + title
        "SMB") and `public/manifest.webmanifest` declares 192/512/maskable icons, but there is no
        `icons.apple` entry. Record whether iOS picks up the manifest icon, falls back to a
        screenshot of the page, or renders something worse. **This decides whether an
        `apple-touch-icon` is owed before launch.**

11. [ ] **The honest-degradation path.** On a second teacher account, **decline** the
        notification permission. That teacher's dashboard reads **"Can't reach you"**, and that
        teacher does **not** appear in the student's list.

---

## Recording the result

Write the outcome — including any step that failed — into `project_state.md`.

> **Do not mark this cycle verified until steps 6 and 7 have actually been observed by a human.**

---

## Final verification (the rest of Task 17)

- [ ] `npm test` — green, and the count is **above** Task 1's recorded baseline
- [ ] `npx tsc --noEmit` — exit 0
- [ ] `npx eslint` — clean
- [ ] `npm run build` — clean
- [ ] `node scripts/probe-session-rls.mjs` — exit 0
- [ ] `node scripts/probe-happy-path.mjs` — exit 0
- [ ] `node scripts/reconcile-payments.mjs` — exit 0
- [ ] `node scripts/probe-availability.mjs` — exit 0
- [ ] `grep -rn "Keep this tab open" src/` — no matches
- [ ] Migration `0006` still **unapplied**; **`0007`–`0011` applied**
- [ ] Task 17's checklist above performed by a human, **steps 6 and 7 observed**

**Dropped from this list:** `npm run e2e` (Playwright). **Task 16 was dropped by user decision
on 2026-09-01** — Playwright cannot test a locked phone receiving a notification, and this
checklist is what actually proves the feature. The browser-level regression gap for the
presence/roster/request UI loop is carried forward, not closed.

---

## 🛑 Before merging

Migration **`0011` must be applied before this app code reaches production.** It is, today.
`src/lib/session.ts` sets `ACCEPT_WINDOW_SECONDS = 60`, and the pre-`0011` database bound was
`accept_deadline > now() + 60s` — zero clock-skew margin at a 60-second window. `0011` raises it
to 120s. If the database is ever rebuilt from migrations, apply `0011` **before** deploying this
code, or every session-request insert fails.

**`0006` remains deliberately UNAPPLIED.** Do not apply it.
