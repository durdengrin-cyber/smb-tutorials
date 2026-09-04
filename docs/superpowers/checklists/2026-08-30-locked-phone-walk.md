# Locked-phone verification walk

**Cycle 2 — durable availability. Spec §9.4. Task 17.**

This is the half of the browser walk **no agent can perform**. Every prior cycle deferred it;
that debt is three cycles old. The central claim of this cycle — *a notification actually
arrives on a locked phone and opens the right screen* — is unfalsifiable without it.

**Performed by: the user.** On a real iPhone and a real Android phone. Not a simulator: a
simulator does not have a lock screen that receives a real push from Apple's push service.

---

## ▶ Use this URL

**https://smb-tutorials-p13avjou4-durdengrin-6266s-projects.vercel.app**

The cycle-2 preview built from branch head `371a6ef`, verified publicly reachable (HTTP 200, no
deployment protection) with the VAPID public key inlined in its bundle. Do **not** use
`smb-tutorials.vercel.app` — that is production, still on `main`, and does not have this code.

**If you push to this branch again, this URL goes stale.** Vercel mints a new preview URL per
deployment, and the usual `…-git-<branch>-…` alias does not resolve here because the branch name
contains a `/`. Get the current one with `vercel ls smb-tutorials | head -3`, and re-check the
key is inlined before trusting it — the branch-scoped preview env vars apply to any deployment of
`cycle-2/durable-availability`, so a fresh one will have them, but verify rather than assume.

## Before you start — ALL PRE-FLIGHT DONE 2026-09-03

Every item below was completed and machine-verified. Kept for the record and for a rebuild.

- [x] **VAPID keys installed** in `.env.local` and in Vercel (Production, Development, and
      Preview scoped to `cycle-2/durable-availability`). Subject is
      `https://smb-tutorials.vercel.app`, chosen over a `mailto:` to keep a personal address out
      of every push request to Apple and Google. Generated fresh; `teacher_devices` was empty at
      the time, so no existing subscription was invalidated.
- [x] **Keys verified to actually sign.** `web-push` built a real signed request: `vapid` scheme,
      JWT present, `aes128gcm` payload encryption, and the `k=` parameter matches our public key
      — which is the one that has to equal what the browser subscribes with.
- [x] **Redeployed, and the redeploy verified.** The public key was found inlined in the deployed
      client chunk — the only proof that the env var actually reached the build. Confirmed on the
      pinned deployment above, which was also checked to contain post-`e92fc95` code rather than a
      stale build.
- [x] **PWA assets serve correctly:** `/sw.js` 200 `application/javascript` with both the `push`
      and `notificationclick` handlers; `/manifest.webmanifest` 200 `application/manifest+json`,
      `display: standalone`, `start_url: /home`, 3 icons; all three icon PNGs 200.
- [x] **Migration `0012` applied and verified** — `anon` → 401 permission denied,
      `service_role` → 204.
- [x] **All four probes exit 0** (`probe-session-rls`, `probe-happy-path`, `reconcile-payments`,
      `probe-availability`), each returning row counts to baseline.
- [x] **`0006` confirmed still unapplied** — `role='admin'` is rejected by the check constraint,
      against a `role='student'` control that reaches the FK instead.

**You still need:**
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

1. [ ] **iPhone Safari → open the preview URL above → sign in as the teacher → `/dashboard`.**
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

## RESULT — PERFORMED 2026-09-04, PASSED

**Run by the user on a real iPhone against the cycle-2 preview. Steps 1–8 and step 10.**
Steps 9 (Android) and 11 (decline case) were NOT run — see "Not covered" below.

> **"Worked seamlessly."**

**Steps 6 and 7 — the two this cycle hangs on — were observed by a human.** A notification
arrived on a locked lock screen, and tapping it opened the app on the dashboard with the request
still live and acceptable. The session then completed end to end.

Corroborated in the database, independently of the report:

| Event | Time (UTC) |
|---|---|
| device registered | `03:24:41` |
| session requested | `03:27:57` |
| **push delivered — `last_ok_at` stamped** | **`03:28:00`** |
| session started | `03:29:49` |

**Delivery took 3 seconds**, and `failure_count` is `0`. That row is also the first live proof of
`record_device_results` (migration `0012`) doing its job — `last_ok_at` had never been written by
anything before this walk.

**This closes a debt three cycles old.** Before 2026-09-04 nothing in this project had ever
executed a real push: the service worker, the payload encryption, `notificationclick` →
`/dashboard` and the iOS install flow were all proven by construction only.

### Three findings from the walk — F1 and F3 FIXED, F2 owed

**F1 — the dashboard flashed "Can't reach you" before the request card appeared.** The teacher
was reachable; the push had just been delivered to that very device. The user's words: *"it
landed to me on a page which already said can't reach you but then I saw the option popped up for
accepting after which things went smoothly."*

Cause not confirmed, but there is a strong candidate in the code:
`src/app/(app)/(teacher)/dashboard/page.tsx` reads
`const { count: deviceCount } = await supabase.from("teacher_devices")...` and **never checks
`error`**. Any failure of that single query silently gives `count: null` → `hasDevice: false`;
with `channelHealthy` still false on first paint, `availability-toggle.tsx`'s status expression
`channelOk || hasDevice` then evaluates to `unreachable`. When the realtime channel connects a
moment later, `channelOk` flips true and the status self-corrects — which matches the observed
sequence exactly, including the request card arriving at the same instant.

**Severity: real but not blocking.** Nothing was lost and the session completed. But it shows a
teacher the precise sentence this cycle exists to stop showing them, and it is the same
fail-quietly class as the `admin.ts` finding the branch review raised.

**FIXED** — the read now checks and logs its error. **Be honest about what that does and does
not settle:** it removes a read that fails silently into a false accusation, but the root cause
of the observed flash is *not confirmed*. It could equally have been ordinary first-paint
ordering. If it recurs, the log line is now there to say so.

**F2 — the iOS Home Screen icon is the placeholder.** The user reports it rendered as *"just SMB
as letters on the logo"*. So iOS did pick up an icon rather than falling back to a page
screenshot, but the icons in `public/` are the placeholders committed in `6694ca7`. **A real icon
is owed before launch** — this is the answer step 10 existed to get.

**F3 — after the session, the dashboard said "Available now / Available until …" while the
student list stayed empty. THE MOST SERIOUS FINDING OF THE WALK.**

Reported by the user; confirmed against the live database within minutes:

```
teacher_availability:  declared = false,  declared_until = NULL
declared_at  03:33:09   <- went available, AFTER the session
updated_at   03:33:15   <- went offline, six seconds later
available_teachers(CBSE, 11th, Science, Physics) -> []
```

So the empty student list was **correct** — the RPC was right, the data was right, and the
*dashboard* was the thing lying. The teacher was shown a live lease that the server did not
believe in.

**Root cause, and it is squarely cycle-2 code.** `renewLease()` in `dashboard/actions.ts`
answered `{ skipped: true }` for two completely different server truths — "declared, but no write
is due yet" and "**this teacher is not declared at all**" — and `availability-toggle.tsx` did
nothing with `skipped`. So an already-open dashboard had **no path** by which it could ever learn
its lease was gone. It would keep rendering `Available until 07:33` indefinitely.

That is the precise failure spec §6.3 forbids — *"a teacher can never again be silently
invisible"* — reached through the UI instead of through push. It is also sharper than it looks
given spec §7's "all devices, first-class" decision: **going offline on the phone left the laptop
lying**, and this tick was the only thing that could have corrected it.

Verified separately that nothing clears the lease automatically: `undeclareAvailable()` has
exactly one caller (the toggle button), the button is `disabled={busy}` so a double-click cannot
double-fire, and no SQL trigger or session migration touches `teacher_availability`. The two
writes were two real clicks.

**FIXED at the root.** `renewLease` now always returns the authoritative lease — `null` when not
declared, the stored timestamp when no write is due (including a lapsed one), the new timestamp
when it renews. The periodic tick becomes a **reconciliation**, not merely a renewal, so any open
dashboard self-corrects within one interval. Write behaviour is unchanged: `shouldRenew` still
gates the upsert, so the write-rate arithmetic in §4.1 still holds. Four new tests, two on each
side of the boundary — including that a tick must not *demote* a genuinely live teacher, since a
reconciliation that only ever removed availability would be its own bug.

### Not covered

- ~~**Step 9 — Android.**~~ **RUN AND PASSED 2026-09-04.** The user reports: notification received
  as intended, tapping it opened the app, accepted the request, and the room opened as designed.

  Corroborated in `notification_events`, independently of the report:

  | Event | Time (UTC) |
  |---|---|
  | session requested | `16:28:29` |
  | **sent → `fcm.googleapis.com`** (Android) | **`16:28:34`** |
  | **sent → `web.push.apple.com`** (iPhone) | **`16:28:34`** |
  | session started, room minted | `16:29:21` |

  **Five seconds. No meaningful Doze delay** — Android matched iOS's three. Zero failures on
  either device; both `last_ok_at` stamped.

  **This also proved something the iPhone walk could not: the multi-device fan-out.** One request
  reached two different push services in a single dispatch. Until this run the dispatcher had
  never sent to more than one device, so `MAX_DEVICES_PER_TEACHER`, the `Promise.allSettled`
  fan-out and the per-device delivery log were all proven only by construction.
- **Step 11 — the decline case.** Not run. That a teacher who denies permission reads "Can't
  reach you" and is hidden from students is still unproven by execution.

## Recording the result

Write the outcome — including any step that failed — into `project_state.md`.

> **Do not mark this cycle verified until steps 6 and 7 have actually been observed by a human.**

---

## Final verification (the rest of Task 17)

- [x] `npm test` — 226 passing / 3 skipped, above the 154 baseline
- [x] `npx tsc --noEmit` — exit 0
- [x] `npx eslint` — exit 0, no output
- [x] `npm run build` — exit 0
- [x] `node scripts/probe-session-rls.mjs` — exit 0
- [x] `node scripts/probe-happy-path.mjs` — exit 0
- [x] `node scripts/reconcile-payments.mjs` — exit 0
- [x] `node scripts/probe-availability.mjs` — exit 0
- [x] `grep -rn "Keep this tab open" src/` — no matches
- [x] Migration `0006` still **unapplied**; **`0007`–`0012` applied**
- [x] Task 17's checklist above performed by a human, **steps 6 and 7 observed** (2026-09-04)

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
