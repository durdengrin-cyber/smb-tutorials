# SMB Tutorials — Project State

## ▶ START HERE (updated 2026-09-14)

**Both branches at the same tip, pushed. Working tree clean.**
`713 tests pass · 5 skipped · tsc 0`, run 2026-09-14. 30 migrations, and the session-start
hook reports repo and production agree. **`eslint` and `npm run build` were NOT run this
session** — nothing but docs has changed since 09-11, when they last passed.

### The 09-11 session was never handed over — this block covers it retroactively
Six code commits landed on 2026-09-11 and the START HERE block below was never updated for them,
so a session opening this file on 09-12 or 09-13 would have read a state three days stale. What
shipped:

- **The teacher card was rebuilt twice** (`9138673`, then `816862c`). First the demo video was
  made to lead — thumbnail + play control, nothing fetched from youtube.com until pressed,
  `youtube-nocookie.com` for the player. Then it was cut down: measured at 500x763 a card with a
  video was **659px in a 763px viewport** — 0.9 cards per screen. Below `lg` it is now a 240px
  summary, 3.2 per screen.
- **A root `not-found.tsx`** (`61fbe66`). Four already existed, one per route group, and none
  caught a URL matching no group at all — that fell through to Next's built-in black default,
  confirmed by opening `/no-such-page-here` on production. This one brings its own chrome because
  it renders inside `RootLayout`, which supplies a `<body>` and nothing else.
- **`unstable_rethrow` in the marketing layout** (`bfd9ae9`). `getIdentity` reads cookies; at
  build time Next probes for static generation, `cookies()` raises `DynamicServerError`, and the
  catch reported "identity lookup failed" **nine times in a clean build** with nothing wrong. The
  warning that cries wolf every build is how the real Supabase outage gets scrolled past.
- **One entity name in `/terms`** (`0c6676d`). Two instances of "SMB Tutorial", both in the
  sentences that create the obligation. `entity-name.test.ts` now pins it. **The five-way spelling
  problem in CLAUDE.md is closed for published legal copy**; `/privacy` was already clean.
- **`allowedDevOrigins`** (`a374101`). Next 16 counts `127.0.0.1` as a different origin from
  `localhost` and refuses its own dev chunks across it — the app renders and never hydrates. Not
  our bug, but `127.0.0.1` is the only way the browser extension can reach a dev server. Dev-only;
  changes no build.
- **The tutor-signup promise** (`cf93076`). "Our team will review your application and contact you
  within 2-3 business days" — neither half true. Nothing contacts an applicant, and there is one
  operator and no SLA.
- **Book the same teacher again** (`9e4b6df`), from the session row that remembers them.

### The design pass, and where it lives
The 09-11 work was a pass benchmarked against **preply.com**. The backlog is **45 items in a
private Artifact, not in this repo** — tick state is in its shared database so both machines see
the same progress. URL and status: `_memory/preply-design-pass-backlog.md`. Ten items are ticked.

**Items 1-9, 20, 21, 39 and 42 have never been seen against the real `/teachers`** — only against
fixtures. `_memory/browser-testing-finds-what-reading-cannot.md` records why that matters: on
09-11, **685 tests passed while the teacher card was visibly broken three ways**, because jsdom
has no layout engine. The same file records four audit findings that were simply wrong — a
competitive audit asserted our code of conduct, refund policy and no-show rule "exist nowhere"
and all three are published on `/terms`.

### Exam targets — designed, not built
`docs/superpowers/specs/2026-09-11-exam-targets-design.md`. A teacher declares, per subject they
already teach, that they prep for **JEE** or **NEET**; a parent filters the online list by it.
Phase 0 (taxonomy) is settled: boards are implicit and not a value, and an empty exam set means
"teaches the syllabus, claims no exam prep". Schema is a **child table**, `teacher_subject_exams`,
not a widened primary key — no backfill, `teacher_subjects` untouched, `0027`/`0028`'s revocations
intact.

**The one breaking change:** `available_teachers` is `(text,text,text,text)` with grants naming
that signature, so `p_exam` cannot be added with a default — the function must be dropped and
recreated, and `online-list.tsx` must ship in the same deploy.

**Written into the spec deliberately:** no parent has asked for this. It is the owner's read of
the market, not anything in our data. `sessions.exam` exists so "did anyone use it?" is
answerable. Estimated 5-7 sessions; Phase 5 is blocked on a student login.

### ▶ Next, in order — the three launch items are unchanged and still non-code
1. **Buy `smbtutorials.com`, point it at Vercel, configure MX.** `/privacy` names
   `support@smbtutorials.com` four times, including as the way to withdraw consent and request a
   recording. It bounces today.
2. **Build the five recording mechanisms** — encrypted storage, report-gated access, the access
   log, the 30-day delete, no-opt-out. Published on production as fact.
3. **Require email confirmation** — code first (both signup flows redirect to authenticated routes
   on a NULL session), then Resend as custom SMTP, then the dashboard toggle. Detail in the block
   below.
4. **Delete the burner accounts** when testing is done. `src/lib/test-accounts.test.ts` fails
   under `SMB_LAUNCH_READY=1` while they exist, so it cannot be forgotten.

Then a choice of build: **exam targets Phase 1**, or the **Preply backlog**, which needs a browser
session with a real student account before its unverified items mean anything.

---

## ▶ START HERE (updated 2026-09-10 evening, session close) — SUPERSEDED

**`main` and `feat/teacher-vetting` are IDENTICAL and both at `2e5fac1`, pushed. Production is
live on it.** 18 commits this session. 665 tests · tsc 0 · eslint 0 errors · build 0.
30 migrations, `migration list` shows no drift.

**`main` is no longer behind.** It was 129 commits back this morning; the vetting work was
fast-forwarded onto it and every push since has gone to both. Production = `main` = this tip.

### Nothing here is live yet
The owner confirmed on 2026-09-10 that **every account in the production database is
experimental** — there are no real users, no real tutors, and no real money. `tutor-check`
("Mr. Azad") is a test account; its ~22 sessions were video tests. Launch is an explicit decision
the owner will announce. Deploying to `main` is not launching. See `_memory/no-real-users-yet.md`,
which also records that an earlier memory asserted the opposite and was used all day to argue
severity before anyone checked it.

### Every open item from the last handover is closed
1. **Push chain — PROVEN END TO END.** A real application put "New teacher application — Igris
   Commander applied to teach 8 subjects" on the operator's screen. Two faults had to clear:
   `0029` had been applied to production and did **nothing** (its role gate was widened while
   `0009`'s trigger still demanded `role = 'teacher'`) — `0030` fixes it; and **macOS was
   blocking Brave's notifications**, which silently ate everything. See
   `_memory/push-silence-is-usually-the-os.md` before ever debugging this again.
2. **`/waiting` vs the legal pages — resolved the other way.** Every surface now states that
   sessions ARE recorded. See "Recording policy" below; the five unbuilt mechanisms are the
   launch gate.
3. **Test B — DONE by the owner**, verified in the database: `student_signup` consent at the
   current version, learner details, straight to `/sessions`.
4. **Re-vetting positive path — PROVEN**, diff and all, and `/admin` renders it.

### What else changed today
- **Recording policy** rewritten across six surfaces, Tier A reviewed (8 findings fixed), and
  the notice put ON the three forms that take consent — a guardian had consented without ever
  seeing it. `CONSENT_VERSION` → `2026-09-10-recording`; `/privacy` and `/terms` are
  **fingerprinted** so editing either forces "is this material?" to be answered out loud.
- **Three defects the consent bump would have activated on deploy**, all fixed before it shipped.
- **The ID check** was promised on three pages and recorded nowhere; Clear now requires an
  affirmation, refused server-side, stored in `teacher_vetting.note`.
- **An unvetted teacher could go "Available now"** — refused now, in the action and the UI.
- **The demo video** teachers are told students watch was rendered by nobody; now on the card.
- **`/admin`** gained a full profile at `/admin/teachers/[teacherId]`, live refresh, and a
  notification click that lands on a fresh page.
- **Domain settled: `smbtutorials.com`** (owner is buying it). See below — it has no DNS yet.
- **Branches pruned** to `main`, `feat/teacher-vetting`, and the local-only
  `backup/visual-identity-duplicate`.

### ▶ Next, in order — all three are NON-CODE
1. **Buy `smbtutorials.com`, point it at Vercel, configure MX.** `/privacy` names
   `support@smbtutorials.com` four times, including as the way to withdraw consent and to request
   a recording. It bounces today, and so did the address it replaced.
2. **Build the five recording mechanisms** — encrypted storage, report-gated access, the access
   log, the 30-day delete, no-opt-out. Published on production as fact.
3. **Delete the burner accounts** when testing is done (`node scripts/test-accounts.mjs delete`).
   The owner asked to keep them for now; `src/lib/test-accounts.test.ts` fails the suite under
   `SMB_LAUNCH_READY=1` while they exist, so this cannot be forgotten.
4. **Require email confirmation** — turn OFF `mailer_autoconfirm` (Supabase Dashboard →
   Authentication → Sign In / Providers → Email → "Confirm email"). Dashboard-only; nothing in
   git records it. **Not safe to flip as the code stands**, in this order:
   - **Code first.** `signUp()` returns a user but a NULL session once confirmation is required,
     and neither flow checks for it — `auth/actions.ts:45` destructures only `{ error }` then
     redirects to `/home`; `tutor-signup/actions.ts:159` checks `error || !data.user` then
     redirects to `/setup`. Both would send a new account to an authenticated route with no
     session and bounce it to `/signin` with no explanation. Each needs a "check your email"
     state.
   - **Then delivery.** Supabase's built-in SMTP is rate-limited to a handful per hour and is not
     for production. Resend is already in the stack and needs wiring as custom SMTP, or
     confirmation mail silently never arrives.
   - **Then the toggle.** The confirmation link leg already works: `/auth/callback` handles
     `token_hash` + `type` (added `d864bd0`), subject to the same redirect allow-list as
     everything else.

   **Why it matters here:** `consent_events.subject_email` is the guardian's email and IS the
   consent record for a child's account, and today nothing proves it exists. Measured 2026-09-10 —
   three of thirteen accounts have domains that do not resolve at all, one of them a plain typo
   (`athleticomadrid.yzz` for `.xyz`). Password reset is the only account recovery and it is
   useless to an address that cannot receive mail.

### The pattern that held all day
**Nine issues found, six of them by the owner USING the product.** Reading found the review
findings and the dead migration; clicking found everything else. See
`_memory/browser-testing-finds-what-reading-cannot.md`.

---

## ▶ START HERE (updated 2026-09-10 morning) — SUPERSEDED

**Branch `feat/teacher-vetting` @ `3a55872`, pushed, tree clean. 19 commits this session.
576 tests pass · tsc 0 · eslint 0 errors · build 0.**

**Seven migrations were APPLIED to production today: `0023`–`0029`.** `supabase migration list`
shows 29, no drift. Three probes green against production: `probe-vetting` (8/8),
`probe-revetting` (7/7), `probe-subject-changes` (11/11).

### What changed today, in one line each
- **`0023`/`0024`** — a cleared teacher who changes ANY profile field returns to `unvetted`.
  Written as an exclusion list (`to_jsonb(row)` minus bookkeeping) so a column added later
  re-vets by default. `full_name` compared `lower(btrim(...))`, so a case fix is not a rename.
- **`0025`** — the admin can suspend by hand, with a required reason. Two provenances in
  `teacher_suspensions` (conduct report OR admin), a CHECK making an origin-less suspension
  unrepresentable, and one open suspension per teacher enforced by a partial unique index.
- **`0026`** — `teacher_revet_events` keeps the diff the trigger already computed, so `/admin`
  says WHAT changed since you last approved them instead of just "unvetted".
- **`0027`/`0028`** — subjects are no longer self-service. A change is a REQUEST carrying a new
  demo video; an admin approves it and that replaces subjects, adopts the video and clears them
  in one transaction. Direct teacher writes to `teacher_subjects` are revoked;
  `set_initial_subjects` is signup's one way in. `0028` moved the YouTube and taxonomy rules
  into SQL after review found them bypassable with the anon key.
- **`0029`** — an admin can register a push device at all (see the open item below).
- **App**: rejected forms hand your input back (tutor, student, profile, subject-request — and
  every `<select>`, which needed a remount key); YouTube-only demo links; the bio finally
  reaches students; `/admin` shows accurate `live`/`offline`/`suspended` badges.

### ▶ Next, in order
1. ~~The push chain is NOT proven.~~ **PROVEN END TO END 2026-09-10.** A real tutor application
   on production put "New teacher application — Igris Commander applied to teach 8 subjects" on
   the operator's screen: `notifyAdminsOfApplication` -> `applicationPayload` -> VAPID sign ->
   FCM 201 -> Brave -> our own service worker. Every link, first time in this product's history.

   Two faults had to be cleared, and only one was ours. `0029` shipped with no effect (below);
   `0030` fixed it. The other was **macOS blocking Brave's notifications entirely** — one OS
   setting that silently ate a working chain all day, including an application alert that did
   fire. If notifications ever go quiet again, check System Settings -> Notifications -> the
   browser BEFORE reading any code: nothing in the app can observe that, and a push accepted by
   FCM with HTTP 201 still shows nothing.

   Also not a bug, though it was diagnosed as one twice: a push subscription belongs to a BROWSER
   and a device row to an ACCOUNT, and the endpoint follows whoever signed in last —
   `register_device` deletes a matching-keys row held by another account, and NotificationSetup
   re-POSTs the subscription on mount even in the "done" branch that renders nothing. Now pinned
   by `notification-setup.test.tsx`.

   Original diagnosis of the `0029` half follows.
   **DIAGNOSED 2026-09-10 — `0029` shipped with no effect.**
   `register_device`'s own gate reads `role in ('teacher','admin')` and is live. Its insert then
   hits `teacher_devices_guard`, the BEFORE INSERT trigger from `0009`, whose function still
   required `role = 'teacher'`. The function permits the admin; the table refuses one layer down.
   **Proven with real JWTs:** admin -> `P0001 teacher_devices requires a teacher profile`;
   teacher -> `204`. `0030` (written, NOT applied) widens the guard to match, and
   `src/lib/device-registration.test.ts` pins the two role lists together — verified to fail
   against the migration set without `0030`. **`0030` APPLIED 2026-09-10; `migration list` shows
   30 with no drift.** `scripts/probe-device-registration.mjs` now proves it against production:
   teacher allowed, admin allowed, **student still refused** — that last one is the assertion
   that matters, because `teacher_devices`' RLS policy is `auth.uid() = teacher_id`, which a
   student posting under their own id trivially satisfies. The guard is all that stands there and
   `0030` widened it.
   The browser half is still unproven: "Turn on notifications" hangs on Chrome's native
   permission prompt, which the extension cannot accept. That needs a human click.

   Original note follows.
   **The push chain is NOT proven, and it is the one loose end.** The VAPID public key is now
   in the machine-local config (pulled with `vercel env pull --environment=development`; a
   backup of the previous file sits beside it). Clicking "Turn on notifications" on `/admin`
   fails with `AbortError: Registration failed - push service error` — **Chrome's push service
   refusing this profile, not our code** (typically a Chrome not signed into Google, or FCM
   blocked). A synthetic POST to `/api/devices`, which skips the push service and tests only
   `0029`'s role check, returned **400 `could not register`**, and the reason is in the dev
   server log: `[api/devices] register_device failed { ... }`. **Read that line first.**
   `0029` is confirmed live (the function's role test reads `role in ('teacher','admin')`), so
   the refusal is something else.
2. ~~`/waiting` contradicts the published legal pages.~~ **RESOLVED 2026-09-10** — resolved the
   other way: every page now states that sessions ARE recorded. See "Recording policy" below.
3. **Test B — a real signup end to end.** Never done. The agent cannot: creating accounts and
   typing passwords are prohibited. Every other link is verified; nobody has pressed Submit.
4. ~~The re-vetting positive path~~ **PROVEN 2026-09-10** with `smb-test-teacher`, by driving
   the app: changed the hourly rate on `/profile`, save succeeded, `vetting_state` went
   `cleared` -> `unvetted` on its own, `teacher_revet_events` recorded
   `{phone: {...}, hourly_rate: {from: 500, to: 650}}`, and `/admin` rendered it under
   "CHANGED SINCE YOU APPROVED THEM". The profile banner's promise is true.
5. **Merge decision.** `main` is 119 commits behind, and the schema is now seven migrations
   ahead of what is deployed. That is safe but widening.

### Recording policy — published 2026-09-10, feature NOT built
`/privacy`, `/terms`, `/waiting`, the home page, `/signup` and `/about` now all state that
**every session is recorded**, that it is a condition of use with no opt-out, and that recordings
are encrypted, opened only on a report or a legal demand, access-logged, and deleted after 30
days. The owner chose present tense with no caveat, knowing the capability ships later. The
previous position — "sessions are not recorded", published in six places — is gone.

**Nothing records anything yet.** The published copy is therefore a specification. These are
requirements the recording feature must meet, not aspirations:

| Published claim | What must exist before launch |
|---|---|
| "Recordings are stored encrypted" | Encryption at rest for the recording store |
| "Nobody watches one unless a report is filed about that session, or the law requires it" | Read access gated on an open `session_reports` row; no ambient staff read path |
| "Every access to a recording is logged, and the log is kept after the recording is gone" | An append-only access log that outlives its recording |
| "30 days, then deleted" | A scheduled delete that actually runs. Note `/privacy` already confesses the 90-day notification-log cleanup was never built — a second unbuilt timer on the same page is a pattern, not an oversight |
| "Sessions cannot be taken unrecorded" | No opt-out anywhere; a session that fails to start recording must not proceed |

`src/app/recording-claims.test.ts` pins the copy in both directions and ties it to
`CONSENT_VERSION`. It cannot pin any of the five rows above; only building them can.

**`CONSENT_VERSION` is now `2026-09-10-recording`** (was `2026-09-05-guardian`). Every existing
account is re-gated: next sign-in lands on `/consent`. That is the intended consequence — it is
the only thing that makes anyone's agreement cover recording. Known side effect, from the comment
at `sessions/actions.ts:18`: a user cannot file a report until they have re-consented.

### The consent bump's three deploy blockers — FIXED 2026-09-10
Found by the Tier A review of `1e5a446`, all three fixed and pinned. None was caused by the
recording change; each was dormant because nothing had ever taken the stale-consent path.

1. **The consent form blanks the child's name and grade, then overwrites the stored values.**
   `consent-form.tsx` renders both fields `required` with no `defaultValue`; `consent/page.tsx`
   never loads the existing ones; `consent/actions.ts:43-47` updates unconditionally. Every
   existing family retypes them at next sign-in, and a typo silently replaces the name the tutor
   sees and the grade that drives matching. `Identity` does not carry these fields, so the fix is
   a small select in `consent/page.tsx` plus two `defaultValue`s.
   **Fixed:** the page reads the stored values and the form defaults to them; `ConsentFormValues`
   /`echoConsentForm` hand back what was typed on a rejected submit, so correcting the name and
   forgetting the checkbox no longer restores the old one. `AuthState`'s "nothing worth echoing"
   was true only while this gate was reached solely by never-consented accounts.
2. **A teacher's dashboard keeps saying "Available until …" while every accept fails.**
   `availability-toggle.tsx:111-118` only acts on `"declaredUntil" in result`, so a stale-consent
   `renewLease` returning `{error}` is swallowed and the display never corrects. The DB row stays
   `declared: true`, students still see and pick the teacher, and Accept returns "Request not
   found." for a request that exists. On deploy day this hits every teacher with an open dashboard.
   **Fixed:** `consentGate()` in `lib/auth.ts` distinguishes "signed out" from "owes consent"
   without disturbing `requireConsentedUser`'s deliberate collapse for the seven call sites that
   only have to refuse. The five refusable dashboard actions return `needsConsent`, and the client
   routes to `/consent` on it — a refusal is a destination, not a message. The renew tick also
   surfaces a plain error instead of dropping it. Proven by render, not by source pin.
3. **`redirect("/consent")` drops the attempted path, and there is no route back into a live
   session.** `auth.ts:73` redirects bare; `consent/actions.ts:68` then sends the user to
   `resolveHome(role)`. `/sessions` never links `/call/[sessionId]` or `/waiting/[sessionId]`, so a
   student who refreshes mid-lesson — or sits on `/waiting` after paying — consents and has no way
   back into a paid, running call except browser history. `signInRedirect` already does exactly
   this and is unused here.
   **Fixed:** `consentRedirect()` sits beside `signInRedirect` and carries pathname + query;
   the form forwards it in a hidden field (a Server Action never sees the URL it was posted
   from) and the action returns through `safeNext`, which is what stops it being an open
   redirect. The `/consent` self-link guard already in `requireUser` is what makes it loop-free.

### Burner test accounts — IN PRODUCTION, must be deleted before launch
Created 2026-09-10 with the owner's approval so an agent can test all three roles without the
owner signing in by hand. `smb-test-student@example.com`, `smb-test-teacher@example.com`,
`smb-test-admin@example.com` — **one of them is an admin.**

- **No password exists for them anywhere.** Each was created with a random password that was
  generated, used for nothing and never printed. `node scripts/test-accounts.mjs signin <role>`
  mints a one-time service-role link instead, so there is no standing credential to leak.
- They sit on the **superseded** consent version (`2026-09-05-guardian`) on purpose: that is the
  state every real account is in, and it is what exercises the 2026-09-10 consent-gate fixes.
- **`setup` must be run by a human.** It escalates one profile to `admin` and sets the teacher to
  `cleared`; the permission classifier refuses both from the agent, correctly.
- **The enforcer is `src/lib/test-accounts.test.ts`**, which fails when `SMB_LAUNCH_READY=1` while
  the script still exists. Verified to fail. "We'll delete them before launch" was not going to be
  enough — see `_memory/promises-need-an-enforcer.md`.

### The contact address on the legal pages cannot receive mail
Settled 2026-09-10: the domain is **`smbtutorials.com`** (plural), applied everywhere in `src` —
`/privacy`, `/terms`, the marketing footer and `flow-demo`'s mockup host. That closes the domain
half of CLAUDE.md's "this project spells itself five ways".

**It did not make the address work.** Checked at the time:

| domain | A | MX |
|---|---|---|
| `smbtutorial.com` (the old singular) | 3.33.130.190 (parked) | **none** |
| `smbtutorials.com` (the new plural) | **none** | **none** |

So `support@smbtutorials.com` bounces, and so did the address it replaced. `/privacy` names it
four times and `/terms` twice, including as the way to withdraw consent and to ask for a
recording — both of which the pages promise. **Point the domain and configure MX before launch;
a published privacy policy whose only contact route is dead is worse than a spelling
inconsistency.** The same domain still needs pointing at the deployment: it currently serves a
114-byte redirect to `/lander`.

### The domain is `smbtutorials.com` — bought on the owner's call, not yet configured
Settled 2026-09-10: **plural**, applied everywhere in `src` at once — `/privacy`, `/terms`, the
marketing footer, and `flow-demo`'s mockup host. That closes the domain half of CLAUDE.md's
"this project spells itself five ways". The owner confirmed they are purchasing it.

**Until DNS exists, the published contact address bounces.** Checked at the time of the rename:

| domain | A | MX |
|---|---|---|
| `smbtutorial.com` (old singular) | 3.33.130.190 (a parked page) | **none** |
| `smbtutorials.com` (new plural) | **none** | **none** |

`/privacy` names the address four times and `/terms` twice, including as the way to withdraw
consent and to request a recording — both of which those pages promise. So this is now a DNS
task, not a copy one: **point `smbtutorials.com` at the Vercel deployment and configure MX before
launch.** Note the old singular currently serves a 114-byte redirect to `/lander`, so nothing is
lost by moving off it.

### Known, unfixed, deliberately
- **Admin server actions throw** instead of returning typed errors; production Next strips the
  message to a digest, so a refused suspend shows a blank error page. Fixing properly means
  client components for those forms.
- **`(stream, subject)` pairing is validated only in TypeScript.** `0028` validates curriculum,
  grade and stream in SQL; the stream→subject map would need the taxonomy as a table.
- **`teacher_devices` also holds admin devices** and is misnamed. `push_devices` would be
  honest; it is referenced in 13 files including applied migrations. Recorded in `0029`.
- `/signin` still has a dead "Remember me" checkbox.
- The project still spells itself several ways; `flow-demo.tsx` was aligned to the published
  legal pages (`smbtutorial.com`) so a mockup was not the thing adding a sixth.

### Temporary branch to delete
`review-base/session-start` (local and origin) exists only as a diff base for
`/code-review ultra`, because `main` is too far back for the 8,000-line limit. Delete it once
the review is done; the intended steady state is two branches.

### The pattern worth remembering
**Six promises with no enforcer were found in one day** — the Suspend button, "sends your
profile back for review", "bio shown to students", the forms implying input was safe,
"converts that account", and "suspended automatically by a conduct report". Each is now pinned
by a test rather than merely corrected. Four were found by DRIVING THE APP, not reading it;
one (every profile save failing) was found by an external review after the whole suite passed,
because every test fixture built a form shape the real form no longer sends.

---

## ▶ START HERE (updated 2026-09-09) — SUPERSEDED

**Branch: `feat/teacher-vetting` @ `7bef05c`, pushed. Tree clean. It now contains every other
branch's work, `main` included — shipping is one fast-forward, not a merge.**

### Migration 0023 is APPLIED (2026-09-09, evening)
`supabase db push` run by the owner; `scripts/probe-revetting.mjs` 7/7 against production;
`supabase migration list` shows 23 migrations, all LOCAL == REMOTE.

**A teacher who replaces their demo video returns to `unvetted`.** The gate used to protect the
moment of approval and nothing after it: a cleared teacher could paste a different link and
students saw a video nobody watched. Enforced in `profiles_vetting_immutable` (one function owns
"when may vetting_state change?"), forced in a BEFORE trigger so it catches a direct PATCH with
the anon key, not just the profile form.

**Deploy coupling — the profile form now says "Changing it sends your profile back for review".
That is true only because 0023 is applied.** `profile-claims.test.ts` fails if the copy exists
without the migration, and vice versa.

**Not covered by the probe, by design:** reaching `cleared` needs an admin, and
`handle_new_user` coerces every role that is not `teacher` to `student`, so no throwaway admin
exists over REST. The positive path is a documented half-minute manual check in the probe's
header, using `Task13 Tutor Verify`.

**Still deferred:** `full_name` does not reset vetting, though the operator checks the ID against
it. One more column in the same `IS DISTINCT FROM` when you want it.

### Branches: there are now two, and that is deliberate (2026-09-09)
`origin` carries **`main` and `feat/teacher-vetting`, nothing else.** Six branches were deleted
after each was proven to have zero commits unreachable from `feat/teacher-vetting`. Older text
in this file and in the handoffs still points at `feat/visual-identity-tokens` — **that branch no
longer exists**; its 87 commits are a subset of this branch's 100. Read `feat/teacher-vetting`
wherever a doc names it, `m3-payments`, or `cycle-2/durable-availability`.

Recovery, if ever needed (`git branch <name> <tip>`; git keeps unreachable objects ~90 days):

| deleted branch | tip |
|---|---|
| `cycle-2/durable-availability` | `525e29e` |
| `m3-payments` | `cad3783` |
| `feat/visual-identity-tokens` | `ba73f13` |
| `m2-presence-instant-pick` | `790db95` |
| `redesign/ia-design-system` | `35fc5fc` |

Two local backups remain, neither on any remote:
- `backup/visual-identity-duplicate` (`533b577`) — **kept on purpose.** It is the only copy of
  `src/lib/online-count.ts` + its test: 83 lines of pure, tested logic (`countTeachers`,
  `countBySubject`) for a homepage live-teacher count that was never built. Nothing imports it.
  Take it from there rather than rewriting, and do not delete the branch without cherry-picking.
- `backup/teacher-vetting-premigration` (`03b84ee`) — safe to delete, not yet deleted. Holds the
  **superseded** four-state vetting design and the rejected `0020_teacher_vetting.sql`. Do not
  read it as current.

### Read this before you plan anything
A SessionStart hook now runs `scripts/session-start.sh` and prints where the work actually is.
**Trust it over `main`.** `main` is 87 commits behind `origin/feat/visual-identity-tokens`, which is
where development lives and what production's database was built from. On 2026-09-09 a session
started from `main`, could not see any of it, and rebuilt two plans' worth of work that already
existed. See CLAUDE.md "Two machines work on this project".

### Shipped to production's database today
- **Teacher vetting (`0006`, `0021`, `0022`) — APPLIED and PROVEN.** No teacher is pickable until a
  person clears them. `scripts/probe-vetting.mjs` asserts it against production: 8/8, exit 0. It
  tries self-clearing, forging the audit record, a service-role write, a non-admin RPC call, and
  reading another teacher's judgement — all refused.
- `vetting_state` on `profiles` is the gate (`unvetted` | `cleared` only). Suspension is NOT here —
  `teacher_suspensions` (`0020`) owns that, with its own trigger and roster filter.
- The judgement (`vetted_at`, `vetted_by`, `note`) lives in `teacher_vetting`: RLS on, no policies,
  reachable only via `set_vetting_state` and the service role.
- `commander.igris.jinwo@gmail.com` is **admin**. Both existing teachers are **cleared**.

### Built, pushed, NOT deployed
- **Password reset** — the product had none. `/auth/callback` only handled `?code`, so every
  Supabase email link landed on the homepage and did nothing, and "Forgot password?" was a button
  with no handler. Now: callback verifies `token_hash` + `type`, `/forgot-password` sends the mail,
  `/reset-password` sets it. Redirect URLs are already configured in Supabase.
- **Two-machine sync.** `_memory/` is in the repo and symlinked into Claude's memory path
  (`scripts/setup-memory.sh`, once per machine — **still owed on the other machine**).
  `scripts/sync-check.sh` reports branch drift and migration drift; the SessionStart hook runs both.

### Three defects caught before they reached anyone — the pattern is worth keeping
1. The first `0021` let a teacher `PATCH` their own `vetting_state` to `cleared`. 0013's hole,
   reopened on a new column. Found by review, before push.
2. Its `available_teachers` was rebuilt from `0010` and would have silently deleted `0020`'s
   suspension filter, putting suspended teachers back in front of children. Found by diffing
   against the live definition.
3. `revoke select (col...)` is a no-op against a table-level grant, so the vetting notes were
   world-readable. Found by the probe, fixed by `0022`.

**Reviews and probes found all three. None was caught by writing the code carefully.**

### ▶ Next, in order
1. **Decide whether `origin/feat/visual-identity-tokens` merges to `main`.** Vercel deploys `main`,
   so the payments hardening, the profile editor, the new homepage and everything above are live in
   the database and invisible on the site. This blocks all of it being real.
2. **Owner:** run `bash scripts/setup-memory.sh` on the other machine; register a phone for push or
   teacher applications alert nobody.
3. **Registration form carousel** — swipeable drawn slides for uploading an unlisted YouTube demo,
   dropping the Google Drive path and tightening `demoVideoUrl` validation to YouTube. Decided
   2026-09-09: slides are drawn in SVG/CSS, not screenshots. Not started.
4. Marketing-surface plan (`docs/superpowers/plans/2026-09-09-visual-identity-marketing-surface.md`)
   is **mostly redundant** — `flow-demo.tsx` and the repainted homepage already exist on the real
   branch. Re-read it against that branch before executing anything from it.

### Small, known, unfixed
- `/signin` has a dead "Remember me" checkbox.
- `profiles.email` diverges from `auth.users.email` — match on `auth.users` for lookups.
- The Tutor Agreement DOES exist (`08dbc18`); spec §10 saying it needs writing is stale.

---

## ▶ START HERE (updated 2026-09-06, afternoon) — SUPERSEDED

**🛑 Read `docs/superpowers/handoffs/2026-09-06-conduct-suspension-complete.md` first.**

**Migration `0020` IS APPLIED TO PRODUCTION** — the owner ran `supabase db push` and
`scripts/probe-suspension.mjs` came back ALL CLEAR against the live database. It is the only part
of today's work that is live; the branch carrying the UI is not merged, so the schema is ahead of
the product. That is safe, and §2 of the handoff says why.

**`/terms` promised since cycle 3 that a conduct report suspends a teacher, and nothing did it.**
That is now built: a report suspends immediately, cancels and refunds what was not yet started,
and only the operator can lift it — recorded. An `active` lesson finishes, by owner decision.

**395 passed / 3 skipped · `tsc` 0 · `eslint` 0 · `build` 0**, all measured with no subagent
editing the tree. 23 commits today, tree clean, **not pushed**.

**🛑 Two things need the owner:** the rewritten `/terms` wording, which is a published legal
document and has not been read; and the handset pass carried from the previous handoff, still the
gate on merging the visual identity work.

**Next is designed and not started: teacher profile editing** — a teacher cannot change their own
rate, subjects or bio after signup, and that rate is what students are charged. No migration
needed. Handoff §6.

---

## ▶ START HERE (updated 2026-09-06, later) — SUPERSEDED by the block above

**🛑 Read `docs/superpowers/handoffs/2026-09-06-visual-identity-complete.md` first.** It is the
state at the close of the 2026-09-05/06 session. Everything below it is history.

**The visual identity cycle is COMPLETE on `feat/visual-identity-tokens` — 51 commits, tree
clean, and NOT merged.** The last two are local and not yet pushed. Production still shows the
demo's teal. All three plans executed; plan 3 ran subagent-driven, 7 tasks planned and 8 executed.

**346 passed / 3 skipped · `tsc` 0 · `eslint` 0 · `build` 0**, all measured by running them.
Every "Done when" target at zero: literal colours on the product surface, emoji outside
`(marketing)`, guard `PENDING`, raw hex in the guarded set.

**The no-op hover sweep is done** (handoff §7's first carried-forward item, now closed). It was
17 sites, not the 16 logged, and the handoff's reason for calling them harmless — "every one
carries `underline`" — was true of only 7. Nine had no affordance in any state. The 17th,
`subject-picker.tsx`'s `border-border hover:border-border`, was invisible to a `text-primary`
search and was found only because the new guard is written as a general rule. That guard,
`src/hover-affordance.test.ts`, walks all of `src` — the bug spanned `(gate)` and `(marketing)`,
and the two existing guards are surface-split.

**🛑 The one thing blocking the merge decision is a handset pass** — nobody has opened any of this
on a real phone, and spec §5.6 makes that the owner's. The list is handoff §5. Preview alias:
`https://smb-tutorials-git-feat-visual-5af6e1-durdengrin-6266s-projects.vercel.app`

**Three findings the diff does not show** (handoff §3): the plan missed the entire `(fullscreen)`
route group — `/call`, the product's core screen; the guard was an inclusion list and is now an
exclusion list, ~15 files to ~70; and the contrast test carried a backwards premise, so
`text-primary` on a 12% tint was shipping at 4.20 against an AA floor of 4.5.

**Also fixed this session, both owner-reported:** the signed-in logo pointed at the `/home`
resolver, so it was a no-op for both roles and nothing led back to the landing page; and the phone
hero was four static screenshots, which now pins and cross-fades like the desktop.

**Plan 4 — the assets (share card, `apple-touch-icon`, real app icons) — is not written**, and is
blocked on the domain and the wordmark. **Settling the domain unblocks the share card, the
password reset and the support address at once.**

---

## ▶ START HERE (updated 2026-09-05, evening) — SUPERSEDED by the block above

**Cycle: visual identity.** Spec `docs/superpowers/specs/2026-09-05-visual-identity-design.md`.

**Branch `feat/visual-identity-tokens` — 21 commits ahead of `main`, pushed, tree clean, and
NOT merged and NOT in production.** `main` holds only the plan-1 document. Production still shows
the demo teal, still hotlinks Unsplash, and `/about` 404s there. There is no handoff document for
this cycle; this block is it.

**Verified green on this branch 2026-09-05 by running them, exit codes recorded:**
- `npx vitest run` → **0** · **318 passed / 3 skipped** (41 files passed / 1 skipped)
- `npx tsc --noEmit` → **0** · `npx eslint .` → **0** · `npm run build` → **0**

Both plans' "Done when" boxes check out by command: Geist retired, `#0f766e` gone from
`globals.css`, no Unsplash hotlink, `/about` linked from the footer, the name spelled
`SMB Tutorials` 14× with **zero** singular — and **the `/terms` no-recording clause survived
the repaint byte-identical** (no `+`/`-` line in its diff mentions recording).

Database probes were deliberately NOT run: `git diff --name-only main..HEAD` shows no `supabase/`
and no `scripts/` changes. This branch is frontend only.

### What is done

- **Plan 1 — the token system** (`plans/2026-09-05-visual-identity-system.md`), all 6 tasks.
  Archivo + IBM Plex Mono replace Geist; the §5.2 palette replaces shadcn's stock greys and the
  demo teal; **`next-themes` is actually mounted** (it had been a dependency shipping inert, so
  `.dark` never applied); a theme toggle in both the signed-in and signed-out headers; a palette
  regression test.
- **Plan 2 — the marketing surface** (`plans/2026-09-05-visual-identity-marketing.md`), all 7
  tasks. The scroll-driven hero, every marketing page repainted onto tokens, one spelling, a
  footer and an `/about` route, guard tests.
- **A design-QA round after plan 2** — five `fix(design)` commits found by the owner reviewing
  the hero: it never went sticky, a post-hydration reflow, the online list re-appearing mid-scroll,
  step 1 having no screen, and the responsive pass. **That last one reached into `/find`,
  `waiting-client` and `consent`, so part of plan 3's scope is already done** and plan 3 is smaller
  than the spec assumes.

### Plan 3 executed 2026-09-06 — subagent-driven, 8 tasks + a final fix wave

**Green, measured by running them:** `npx vitest run` **336 passed / 3 skipped**, `tsc` 0,
`eslint` 0, `build` 0. Every "Done when" target at zero: literal colour classes on the product
surface, emoji outside `(marketing)`, guard `PENDING` entries, raw hex in the guarded set.

**Two defects the cycle existed to find, and one it created:**

1. **The plan missed an entire route group.** `src/app/(fullscreen)` — `/call`, where the lesson
   happens — was never in the File Structure table and was not walked by the guard: 19 literals
   and an emoji. Root cause: the audit ran over a set of directories that was *assumed* rather
   than enumerated. `ls -d src/app/*/` would have caught it. Closed as an added Task 8.
2. **Task 8 then introduced a light-theme regression.** It added `--stage`, fixed dark in both
   themes so the video backdrop does not go pale — sound — but every *other* token still flips,
   so the error banner on that stage measured **2.28** contrast in light. Fixed by moving the
   banner to an opaque `bg-card`; the constraint is now documented beside `--stage`.
3. **A wrong premise in the contrast test, written into the plan by me.** It asserted solid token
   values and claimed a 12% tint "composites toward the ground, so this is the conservative
   check". Backwards — a tint moves the ground *toward the text*, so contrast always falls.
   `text-primary` on `bg-primary/12` was **4.20** over `--background` and **3.91** over `--muted`,
   both under AA. Fixed, and `theme.test.ts` now asserts the **composited** case.

**The guard was inverted from an inclusion list to an exclusion list** (`app-surface.test.ts`):
it now walks `src/app` and `src/components` wholesale — `.ts` as well as `.tsx` — excluding
`(marketing)` (own guard) and tests, with a narrow per-check `ALLOW` for `ui/dialog.tsx`'s overlay
scrim and `google-button.tsx`'s Google brand hexes. **Coverage went from ~15 files to ~70.** This
is the structural fix for defect 1: a new route group is now guarded on creation.

**One new token:** `--success` (light `#2f6b46`, dark `#7fc79b`). Deliberately NOT a `--warning`
pair — the brand accent IS gold, so an amber warning token would be the same swatch as the
identity in dark theme. "In a session" therefore takes `--primary`: engagement, not alarm.

**Still deferred to plan 4**, all blocked on the domain and the wordmark: the share card,
`apple-touch-icon`, the real app icons.

### What is not

- **Plan 3 IS now written AND EXECUTED** (2026-09-05/06): `plans/2026-09-05-visual-identity-app-surface.md`,
  7 tasks planned, **8 executed** — see the execution block below. Originally 7 tasks. **It deliberately covers less than spec §9's plan 3.** The share card,
  `apple-touch-icon` and the real app icons are split into a future **plan 4**, because they are
  blocked on the domain and the wordmark and nothing else in the cycle depends on them.
  Plan 3 is the app-surface re-theme plus the padding remainder of §5.6 — and it opens with a
  defect worth knowing: **the app surface is broken in dark theme today.** `ui/card.tsx` already
  reads `--card`, so a Card goes dark while `teacher-card.tsx:29`'s `text-gray-900` stays
  near-black — dark text on a dark card, on the student's browse screen. Not written yet: plan 4.
- **All three of spec §12's blockers are still open** (confirmed by the owner, 2026-09-05): the
  domain, the wordmark, the dedication copy. Plan 3's scope cannot be settled until at least the
  domain is.
- **Nobody has opened this on a handset**, and spec §5.6 makes that the owner's. Preview alias,
  stable across pushes — Vercel hashed the `/` out of the branch name, unlike cycle 2:
  `https://smb-tutorials-git-feat-visual-5af6e1-durdengrin-6266s-projects.vercel.app`
  All seven marketing routes curl 200, and it is built from HEAD (deployment created 18:45:34,
  HEAD committed 18:45:30).

### 🚩 The finding worth carrying: the site shows two domains at once

`/privacy` (8×), `/terms` (4×) and the footer send parents to **`support@smbtutorial.com`
— singular**. The new hero's device chrome shows **`smbtutorials.com` — plural**. Neither is
confirmed as owned. Spec §7 flagged the split and plan 2 deliberately deferred the support
address behind the domain decision, so this is **not a regression** — but the hero is new, so the
two spellings are now visible in one session, on published legal documents. The domain already
gates the share card, the password reset and the email sender; this is a fourth reason to settle it.

**Not a finding, worth knowing:** every marketing route builds `ƒ` (server-rendered on demand),
`/about` included, because `MarketingLayout` reads cookies — also the source of the known
`[MarketingLayout] identity lookup failed` build lines. Pre-existing. It does mean the
WhatsApp-tap landing page gets no static caching.

### The dedication is pulled, on purpose — do not restore it

**The footer's dedication paragraph was removed 2026-09-05 at the owner's instruction, "for now".**
What stood there was *our* placeholder, not their words, and spec §2 reserves that copy to them.
`src/components/marketing-footer.tsx` keeps a comment marking the spot and saying so; the link row
lost its `border-t border-hair pt-6` with it, since that rule only made sense *between* the
dedication and the links and read as a stray second rule beneath the footer's own top border.
`/about` never rendered a dedication — it has only a comment. **An agent that re-adds this from
the spec has made a mistake.**

### Next decision, and it is the owner's

Merge and ship plans 1–2 — accepting spec §11's brief seam, a repainted marketing surface
beside un-repainted app screens — or hold and write plan 3 first so all three ship together.

---

## ▶ START HERE (updated 2026-09-05, morning) — SUPERSEDED by the block above

**🛑 Read `docs/superpowers/handoffs/2026-09-05-guardian-consent-execution.md` first.** It is the
state at the close of the 2026-09-05 session. Everything below it is history.

**The guardian-consent cycle is committed, pushed, merged and deployed**, and its feature branch
is deleted. **"Nothing in flight" is no longer true** — see the visual-identity block above; the
whole of that cycle sits unmerged on `feat/visual-identity-tokens`. Everything else below is
accurate for guardian-consent.

**Verified against the live site route-by-route** (not the Vercel dashboard — this project has
shipped a "Ready" deployment that 404'd every path): `/`, `/privacy`, `/terms`, `/signup`,
`/tutor-signup`, `/signin` all 200; the refund placeholder is gone; the tutor-agreement anchor
resolves; the no-recording clause is intact (correct until plan 3); `/signup` collects the
learner's grade and links to `/privacy`.

- **300 tests passing / 3 skipped** · `tsc` 0 · `eslint` 0 · `build` 0 · **9 probes** (2 new)
- **Migrations `0018` and `0019` are APPLIED (2026-09-05, via `supabase db push`).** Verified
  live: 3 new `profiles` columns, `consent_events` exists, `record_consent` executable by
  `authenticated` and NOT by `anon`, and the table unreadable by both — the `0017` read control
  proven by query, not assumed.
- **All 8 probes exit 0 against production**, including the new `probe-consent.mjs`.
- **Migration workflow changed: the Supabase CLI replaces hand-pasting.** Ledger repaired
  (`0001`–`0005`, `0007`–`0017` marked applied), `begin;`/`commit;` stripped from all files, and
  `0006` moved to `supabase/migrations-deferred/` so `db push` cannot apply it by accident.
  See `CLAUDE.md` and that directory's README.
- **The M3 child-safety blocker is closed in code**, and its four open policy decisions were
  taken. Three questions still need a lawyer — handoff §6.
- **Refund policy** read and acknowledged by the user; they are refining the commercial terms
  separately. **Legal review is the user's and under way** — it does not gate the pilot (spec §17).
- Plans 2 (vetting + escalation) and 3 (recording) are **not written yet**.

---

## 🛑 NO PASSWORD RESET EXISTS (found by the user, 2026-09-05)

**A parent who forgets their password cannot get back in. At all.** Verified: no
`/forgot-password` or `/reset-password` route, no `resetPasswordForEmail` call anywhere in
`src/`, and `src/app/auth/` contains only `actions.ts` and `callback/`. The sign-in page offers
no "forgot password" link because there is nothing to link to.

**Why this is pilot-blocking, not cosmetic.** The account holder is now the guardian (migration
`0018`), who signs up once and may not return for weeks. Email-and-password is the primary path;
Google sign-in is the only escape hatch, and only for those who used it. Everyone else who
forgets is locked out of a paid service, with their only recourse an email to `support@` — an
address that currently points at a domain that may not resolve.

**What it needs:**
1. A `/forgot-password` page calling `supabase.auth.resetPasswordForEmail(email, { redirectTo })`.
2. A `/reset-password` page handling the recovery link, which arrives as a Supabase auth callback.
3. **A working email sender.** This is the real dependency: Supabase's built-in SMTP is rate-limited
   and not for production. It needs the domain settled first, then SMTP configured — the same
   dependency as the transactional email that `CLAUDE.md` lists as Resend but which is not wired up.
4. A link on `/signin`.

**Sequencing:** blocked behind the domain, like the share card. Worth doing in the same pass as
the email setup rather than as its own cycle.

---

## ▶ NEXT PRODUCT TIER — micro-doubt sessions, ₹50 / 10 minutes (recorded 2026-09-05)

**User's call, to be built after the current cycle. Not yet specced or decided in detail.**

Came out of a conversation about who the marketing page is for. Reasoning worth keeping:

**Why it is a genuinely different product, not a cheaper version of the current one.**
`duration_minutes` defaults to 60 and pricing is hourly, which makes today's session a
*considered purchase* — nobody's child spends ₹500 of a parent's money on impulse. That is why
the parent is the buyer and the homepage should address them. **A ₹50 / 10-minute session
inverts that:** it is impulse-priced, so the student becomes the buyer, the trigger and the
consumer. Same infrastructure, different demand shape.

**Why it is attractive:** almost all the expensive machinery already exists — availability
leases, instant pick, push dispatch with multi-device fan-out, Daily rooms, payments, consent,
reports. A micro tier is mostly pricing, duration, and a purchase path.

**The hard problem it creates, and the reason it needs its own design cycle.** As of
2026-09-05 the **guardian holds the account and the student has no login at all**. An impulse
purchase by a student is structurally impossible under that model. Something has to give, and
the options are not equivalent:
- a parent-funded balance the child spends against, with a cap (keeps the guardian model intact —
  probably the answer);
- a student login with delegated spend (reopens every consent question closed this cycle);
- parent approval per session (kills the impulse, and with it the tier's whole point).

**Other things a spec must answer:** teacher economics on a 10-minute unit (₹50 minus fees, and
whether a teacher will accept one at all); whether a 10-minute session is worth an accept round
trip against a 60-second accept window; and the safety surface, since more sessions per child
means more counterparties per child, against a `session_reports` flow built for hourly lessons.

**Also decided in that conversation, and it shapes both tiers:** the current product is
*student-triggered, parent-decided, student-consumed*. The need is the child's; the search and
the payment are the parent's. The marketing surface therefore addresses the parent about the
child's moment; the app serves the child.

---

## ▶ START HERE (updated 2026-09-04) — SUPERSEDED

**🛑 Read `docs/superpowers/handoffs/2026-09-04-cycle-2-3-complete.md` first.** It is the full
state at the close of the 2026-09-04 session: what shipped, what is proven, the configuration,
the eight gotchas that cost real time, and what to pick up next. Everything below it is history.

**Everything is committed, pushed, merged and deployed. `main` == `origin/main`. Tree clean.
Nothing in flight.**

- **260 tests passing / 3 skipped** · `tsc` 0 · `eslint` 0 · `build` 0 · **7 probes all exit 0**
- Migrations `0001`–`0005` and `0007`–`0017` applied live. **`0006` still deliberately UNAPPLIED**
  (its precondition is now met — `0013` closed the role hole — but there is no admin to use it).
- **Cycle 2 (durable availability) COMPLETE AND PROVEN**: iPhone walk 3s, Android walk 5s,
  multi-device fan-out proven. Only step 11 (the decline case) is unproven by execution.
- **Cycle 3 (student session record) SHIPPED**: `/sessions`, and students now land there at
  sign-in and after a call instead of `/find` and `/teachers`.
- **Google sign-in is LIVE** and verified end to end.

**▶ The one thing blocking a trial that code cannot solve: the child-safety policy.** Open since
M3. See the handoff §7.

---

## ▶ START HERE (updated 2026-08-28)

> **Session 5 (2026-09-01 → 09-04): CYCLE 2 IS FUNCTIONALLY COMPLETE. Both reviews done, all
> blockers fixed, migrations `0007`–`0012` applied, credential ratified, and **the locked-phone
> walk PASSED on 2026-09-04** — real push, real lock screen, 3-second delivery. The walk found
> three defects; two are fixed, one (a real Home Screen icon) is owed before launch. See the
> "▶ Cycle 2" block below.**

**Cycle 1 of the redesign — IA + design system — is COMPLETE and SHIPPED TO PRODUCTION.**
`main` @ `f5fdb97`, 37 commits merged and pushed, verified live route-by-route against
https://smb-tutorials.vercel.app (not the Vercel dashboard — this project has shipped a
"Ready" deployment that 404'd every path).

**Read `docs/superpowers/handoffs/2026-08-28-cycle-1-ia-design-system.md` before doing
anything.** It is the full handoff: what shipped, the security finding below in detail, the
cycle-2 backlog, and all 23 rulings made during execution with what each costs if wrong. The
execution ledger lived in git-ignored scratch and no longer exists; that document is what
survived.

### ✅ THE ROLE HOLE IS CLOSED (2026-09-04, migration `0013`)

**The blocker described below is RESOLVED.** `0013` is applied and proved by
`scripts/probe-role-guard.mjs` — 7 assertions, all green, re-runnable with no arguments:

- a signed-in student **cannot** PATCH their own `role` (was HTTP 200 before; now 400)
- they **can** still edit their own non-role fields — the guard is not a blanket lock
- `become_teacher()` converts a clean account, re-checking `canBecomeTeacher` **in SQL**
- an account with history is refused **by the database**, not only by TypeScript
- the RPC is refused to `anon` (revoked by name — the mistake `0012` shipped)
- signup metadata `role: "admin"` lands as `student`; `role: "teacher"` still works

**Demonstrated before it was fixed**, with a throwaway account: a student PATCHed themselves to
`role=teacher, hourly_rate=99999` and got HTTP 200, holding only the anon key that ships in the
browser bundle.

**`0006` is therefore now SAFE to apply — but there is still no reason to.** Its prerequisite
(the trigger + the SQL-side `canBecomeTeacher`) is met, and `handle_new_user` no longer trusts
signup metadata, so a signup carrying `role: "admin"` cannot mint an admin even once `'admin'`
is a legal value. Apply it when cycle 3 actually builds admin, not before. The original hazard,
kept for the record:

### 🛑 (HISTORICAL) DO NOT APPLY MIGRATION `0006`

`0001`'s update policy on `profiles` has **no column restriction**, so any signed-in user can
rewrite their own `role` from a browser with only the anon key. That is pre-existing. Cycle 1
made `profiles.role` the sole authority every auth gate trusts, and `0006` (written, deliberately
**unapplied**) would add `'admin'` to the permitted values — turning a student→teacher annoyance
into self-service admin promotion that cycle 3 would build on unknowingly.

~~**`0006` being unapplied is currently the only thing holding that door shut.**~~ **BOTH
REQUIREMENTS ARE NOW MET (2026-09-04, `0013`):** the `BEFORE UPDATE` trigger blocking role
changes, and the `security definer` RPC re-checking `canBecomeTeacher` in SQL. Neither uses the
service role — that key remains the payment webhook's. Detail in spec
`2026-08-28-ia-design-system-design.md` §17.1.

### Live behaviour change awaiting ratification

**`/find` and `/teachers` are now sign-in-gated.** They were publicly browsable before this
cycle and this is live in production — a signed-out visitor clicking the homepage's primary CTA
hits a sign-in wall, and a signed-in *teacher* cannot view `/teachers` at all. Ratify or revert.

### Outstanding, not blocking

- **🆕 A signed-in user cannot reach the landing page (found by the user, 2026-09-04).** The
  header logo in `src/components/app-shell.tsx:23` links to `/home`, but `/home` is a RESOLVER,
  not a page (`src/app/(app)/home/page.tsx` calls `resolveHome(role)` and redirects). So a
  student clicking the logo goes `/home` → `/sessions` — back to the page they were already on.
  It reads as a dead logo. The signed-out header (`marketing-header.tsx:8`) links to `/`
  correctly; only the signed-in shell is affected.
  **Today's routing change made it more visible:** before `resolveHome("student")` became
  `/sessions`, the logo at least moved a student from `/teachers` to `/find`. Now, clicked from
  `/sessions`, it is a literal no-op.
  **Not fixed — user asked to record it and fix later.** The decision it needs first: should the
  signed-in logo go to `/` (the marketing page, which advertises features that do not exist yet)
  or stay role-aware? A "Home" nav entry pointing at `/` may be the better answer than changing
  the logo, since the logo's current behaviour is right for teachers.

- **🔜 NEXT UP: Google OAuth is unconfigured.** `node scripts/probe-auth-providers.mjs` exits 1
  naming `google` and will until the dashboard config is done. Steps in the cycle-1 handoff.
  **User flagged this on 2026-09-04 as the next thing to do after the student session record.**
  The sign-in and sign-up pages already render a `GoogleButton`, so today it is a visible control
  that cannot work — the same defect class as marketing copy advertising deferred features.
- **`PAYMENT_PROVIDER=razorpay` in `.env.local`** — the stub is deleted; an unset provider throws
  by design. Production already had it set, so production is unaffected.
- **The two-browser manual walk was never performed.** Three agents could not drive a browser.
  Presence, the incoming-request card and the live payment loop are unproven by machine on this
  branch. Route gating was verified by curl against production.

### State

- **154 tests passing / 3 skipped** (up from 113); `tsc --noEmit`, eslint, `npm run build` clean.
- All three database probes exit 0 (`probe-session-rls`, `probe-happy-path`, `reconcile-payments`).
- Migrations `0002`–`0005` applied to the live project; **`0006` written and NOT applied**.
- Tree clean, `main == origin/main` (re-established 2026-08-30).

### ▶ Cycle 2 — BOTH REVIEWS DONE, ALL BLOCKERS FIXED, on branch `cycle-2/durable-availability` (2026-09-01, session 5)

**Both owed reviews are complete and every finding they raised is closed.** Branch head
`e92fc95`. The handoff at `docs/superpowers/handoffs/2026-08-30-cycle-2-execution-state.md`
is now HISTORY up to its SESSION 4 ADDENDUM; this block supersedes it.

**State: 226 tests passing / 3 skipped (27 files) · `npx eslint` exit 0 · `tsc --noEmit` exit 0 ·
`npm run build` exit 0 · tree clean.** All four re-measured directly this session, not taken from
agent reports. (The `[MarketingLayout] identity lookup failed` lines in the build log are
pre-existing — verified identical at a clean HEAD.)

**What happened this session:**
1. **Scoped re-review of `61452b1..54c262d`** — verdict *ready to merge*. One Important (the
   `unstable_rethrow` guard's discriminating branch was untested — deleting the line left the
   suite green) plus four Minors. All fixed in `08a3f19`.
2. **Final whole-branch review** (`af1285b..08a3f19`, 29 commits) — verdict *with fixes*: one
   Critical, three Important. **All four fixed in `e92fc95`.**
3. **Task 17 step 1 done** — `docs/superpowers/checklists/2026-08-30-locked-phone-walk.md`
   (`d48b089`), carrying the three corrections the session-4 handoff owed.
4. **Task 16 (Playwright) DROPPED** by user decision. Recorded in the checklist; the
   browser-level regression gap for the presence/roster/request loop is carried forward, not
   closed.

**The Critical is worth remembering.** A teacher who signed out and back in was permanently
push-unreachable and told the opposite: `nextSetupAction` returned `"done"` for a granted
permission on the premise that `registerExistingSubscription` silently repaired a missing
subscription — but that function only ever POSTed an *existing* one and never called
`subscribe()`, while `removeThisDevice()` unsubscribes on sign-out and the grant survives.
**Both the Critical and one Important originated in the PLAN, not the implementation** — the
cycle's established pattern, now nine plan defects, none shipped.

**✅ Migration `0012` is APPLIED (2026-09-03), including its corrective grant re-run.**
`record_device_results` is the RPC the dispatcher calls on every delivery to increment
`failure_count` and stamp `last_ok_at` (spec §8 required both; neither was ever written).
Verified live: `anon` → 401 permission denied, `service_role` → 204.

**Its first version had a real hole, worth remembering.** It revoked EXECUTE from `public` and
`authenticated` but not `anon` — and Supabase's default privileges grant to `anon` and
`authenticated` **by name**, while `revoke ... from public` does not remove a named role's
grant. Because the function is `security definer` (bypasses RLS rather than being scoped by it),
that gave anyone holding the browser-bundle anon key an unauthenticated write against **any**
teacher's device row. Caught by testing the revoke instead of assuming it worked. **Any future
`security definer` function here must revoke from `anon` and `authenticated` by name, and the
revoke must be tested.** Detail in spec §15.1 items 6–7.

**✅ `NOTIFICATION_DB_KEY` RATIFIED (2026-09-03) as §12 option (b) — the service role, on
purpose, until cycle 3.** Full reasoning in spec §12.1. What decided it: the service role was
already on student-triggerable app paths before this cycle (`payment-actions.ts`, `settle.ts`
both run on it when a student pays), so the dispatcher is a third instance of an existing
pattern, not a new exposure class. A dedicated `sb_secret_*` key carries the SAME privileges —
it narrows rotation blast radius, not privilege. Real narrowing needs a dedicated Postgres role,
which `teacher_devices`' `to authenticated` RLS refuses outright unless the dispatcher's whole DB
surface becomes `security definer` RPCs first. **That is cycle-3 work and belongs with the
`profiles.role` fix (cycle-1 §17.1)** — both are "the database should enforce this, not the app
code". Deferring is cheap because the seam is already right: one env var, one line to swap.
**The fallback is no longer silent** — `createDispatchClient()` warns once per cold start.

**NO MERGE BLOCKERS REMAIN.** What is left is Task 17, which needs a human and a phone.

**⚠ The live database is AHEAD of `main`.** `0007`–`0012` are all applied on this unmerged
branch. `0007`–`0010` are additive and unread by production.
**`0011` REPLACED `enforce_session_insert()`, which production runs on every session insert** —
regression-checked live (three probes exit 0, sessions 19→19), so `0005`'s controls survive. The
final review also diffed `0011`'s body against `0005`'s mechanically: identical but for the
bound. Do not treat it as inert.

**🛑 Migration ordering:** `ACCEPT_WINDOW_SECONDS = 60` needs `0011`'s 120s bound (satisfied
today), and the dispatcher needs `0012`. If the database is ever rebuilt from migrations, both
must be applied **before** this app code deploys.

**`0006` is still deliberately UNAPPLIED.** Do not apply it.

**✅ VAPID keys INSTALLED and VERIFIED (2026-09-03).** Fresh pair generated (`teacher_devices`
was empty, so nothing was invalidated), written to `.env.local`, and set in Vercel for
Production, Development and Preview — the Preview entry was branch-scoped to
`cycle-2/durable-availability` at the time; **it no longer is, see the CLI note below**. Subject is
`https://smb-tutorials.vercel.app`. Verified three ways: `web-push` builds a real signed request
(`vapid` scheme, `aes128gcm`, `k=` matching our public key); the preview was **redeployed** after
the vars were added; and the public key was found inlined in the deployed chunk
`/_next/static/immutable/chunks/00w9z_yz1-slf.js`, which is the only real proof the env var
reached the build.

**⚠ Vercel CLI note:** `vercel env add <name> preview --value <v> --yes` loops — it demands a git
branch, suggests the exact command you just ran, and rejects it again. Pass the branch as the
third argument. **The CLI gotcha is still real; the branch-scoping it caused is NOT — corrected
2026-09-05.** Those scoped entries were replaced with unscoped ones (created 2026-09-04), so
**every preview branch now gets the VAPID vars**, this cycle's included. Verified by query rather
than assumed: `vercel env ls preview <branch>` returns *No Environment Variables found* for BOTH
`feat/visual-identity-tokens` and `cycle-2/durable-availability` — which is what an absence of
branch-scoping looks like — while plain `vercel env ls preview` lists all three VAPID names.
Production and Development hold their own separate entries. Production is unaffected.

### ✅ TASK 17 PERFORMED 2026-09-04 — PASSED. Cycle 2 is functionally complete.

**The user ran the walk on a real iPhone. Steps 1–8 and 10. "Worked seamlessly."**
Steps 6 and 7 — a notification on a LOCKED lock screen, and tapping it opening the dashboard
with the request still live — **were observed by a human**. The session completed end to end.

Corroborated in the database independently of the report: device registered `03:24:41`, session
requested `03:27:57`, **push delivered and `last_ok_at` stamped `03:28:00`** — three seconds —
`failure_count` 0, session started `03:29:49`. That row is also the first live proof of migration
`0012`'s `record_device_results`; nothing had ever written `last_ok_at` before.

**A debt three cycles old is closed.** Before this, no push had ever actually been executed by
this project.

**The walk found three things. Two are fixed; one is owed.**

- **F3 (most serious, FIXED).** After the session the dashboard read "Available until …" while
  the row held `declared = false, declared_until = NULL`, so the student list was empty and
  *correct*. `renewLease()` returned `{ skipped: true }` for BOTH "no write due" and "not
  declared at all", and the toggle ignored `skipped` — so an open dashboard had **no path** to
  learn its lease was gone. Spec §6.3's exact forbidden failure, via the UI instead of push, and
  worse under §7's "all devices, first-class": going offline on the phone left the laptop lying.
  **Fixed at the root** — the tick now always returns the authoritative lease and so reconciles
  rather than merely renewing. `shouldRenew` still gates the write, so §4.1's arithmetic holds.
- **F1 (FIXED, cause unconfirmed).** The dashboard flashed "Can't reach you" when opened from the
  notification. `dashboard/page.tsx` discarded the error from its device-count read, making a
  failed read indistinguishable from zero devices. Error now checked and logged. **This does not
  confirm the flash's cause** — it may have been first-paint ordering; the log is there to say so
  if it recurs.
- **F2 (OWED, pre-launch).** The iOS Home Screen icon is the placeholder committed in `6694ca7` —
  the user reports "just SMB as letters on the logo". iOS did pick up an icon rather than falling
  back to a screenshot, so no `apple-touch-icon` is strictly required, but **a real icon is owed
  before launch.**

**Not covered by the walk:** step 9 (Android — Doze delay unmeasured, Android push still proven
only by construction) and step 11 (the decline case — that a teacher who denies permission reads
"Can't reach you" and is hidden from students is still unproven by execution).

**Note for re-testing:** the teacher's row is currently `declared = false`. Mr. Azad must click
"Available now" again before he appears to students.

---

**Superseded: Task 17's WALK** — everything mechanical around it is done and green.

**▶ Walk against https://smb-tutorials-p13avjou4-durdengrin-6266s-projects.vercel.app**
(cycle-2 preview built from branch head `371a6ef`, HTTP 200, no deployment protection, VAPID
key confirmed inlined. A further push mints a NEW preview URL — the `…-git-<branch>-…` alias
does not resolve because the branch name contains a `/` — so re-read it from
`vercel ls smb-tutorials | head -3`). NOT `smb-tutorials.vercel.app` — that is production, still on `main`, without this
code. Checklist: `docs/superpowers/checklists/2026-08-30-locked-phone-walk.md`.

**Verified by machine on 2026-09-03, so a failed walk points at the phone, not the plumbing:**
226 tests / tsc / eslint / build all clean · all four DB probes exit 0 with row counts back to
baseline · `0006` still unapplied (checked with a `role='student'` control that reaches the FK
while `role='admin'` is stopped by the check constraint) · `0012` applied, `anon` 401 /
`service_role` 204 · `/sw.js` 200 `application/javascript` with both handlers · manifest
`standalone`, `start_url /home`, 3 icons, all PNGs 200 · VAPID key inlined in the deployed bundle.

**Still true and still the point:** nothing has executed a REAL push. The service worker, the
encryption, `notificationclick` → `/dashboard` and the iOS install are proven **by construction
only**. Steps 6 and 7 of the walk are the first and only execution evidence this feature will
have.

**Follow-ups deferred by the final review** (none merge-blocking) are triaged in its report and
summarised in spec §15.1 — the half-strength four-status probe, the unguarded probe `finally`,
`sw.js`'s substring tab match, `readSetupFacts`'s unsupported-browser branch, thin
`declareAvailable`/`renewLease` write assertions, the missing `after()`/`redirect()` ordering
test (its value went UP when Task 16 was dropped — nothing else would catch an inversion), and
the absent `apple-touch-icon` (step 10 of the walk decides it).

---

### Cycle 2 spec + plan — approved (2026-08-29 / 2026-08-30)

**Plan: `docs/superpowers/plans/2026-08-30-durable-availability.md`** — 17 tasks, 108 steps,
TDD throughout. **Next step: `superpowers:subagent-driven-development`**, one implementer per
task, each independently reviewed.

**Task 1 restores the fresh-clone baseline and everything else depends on it** — `npm install`,
`.env.local` rebuilt by the user, and the four green checks re-measured on THIS machine before
any before/after number is quoted. Task 7 step 6 generates the VAPID keys for the user to paste.

Migrations `0007`–`0009` are numbered around the deliberately-unapplied `0006` and do not
depend on it. **Do not apply `0006`.**

---

### Cycle 2 spec — approved (2026-08-29)

**Source of truth: `docs/superpowers/specs/2026-08-29-durable-availability-design.md`**
(16 sections, 762 lines, commits `1bb3937` + `933a2bc`). All five design sections were
approved by the user in conversation; a review pass over the written spec then found and
fixed two defects it would otherwise have shipped. The brainstorm handoff below is
**historical** — it carries a "resume at Section 4" instruction that is no longer true, and
now says so at the top of the file.

**Next step, in order:**
1. User approves the spec file (the only thing outstanding).
2. `superpowers:writing-plans`.
3. Implementation via `superpowers:subagent-driven-development` — one implementer per task,
   each independently reviewed. Brainstorm and spec work stay in the main conversation with
   no subagents (ruling, 2026-08-29).

**The plan must sequence these ahead of the cycle's own tasks:**
- **Fresh clone** — `npm install`, and `.env.local` rebuilt (spec §13). **It is the user's
  file: propose the lines, let them paste. Never write it.** Nothing can be built, run,
  tested or probed until this is done, and every "verified green" number below was measured
  on the *previous* machine.
- **VAPID keys** — `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
  into `.env.local` and Vercel (Production, Preview, Development).
- **Payment-surface component tests** (cycle-1 spec §17.5) — a separate bounded task that
  runs *before* this cycle's implementation, not inside it.
- New dependencies this cycle introduces: `web-push` (runtime) and `@playwright/test` (dev).

**What the review caught, worth not re-deriving:**
- The roster RPC **cannot** exclude teachers without a device row — it is SQL and cannot
  see presence, so doing so would drop a teacher who declared, has the dashboard open, and
  declined notifications. `has_device` is published, not applied; "can't reach you" is a
  **client-side join** (spec §4.4).
- The push-only half of the list needs its own freshness mechanism — presence only streams
  the live half. **Poll on focus + every 30s** (spec §4.4.2), chosen over Broadcast because
  polling scales with students rather than `teachers × students`.
- An installed iOS web app has **its own cookie jar**, so the real iOS path is install →
  **sign in again** → grant permission. That is why onboarding is a dashboard state machine
  rather than a wizard after signup (spec §7.2, §7.4).

**Open, and needing the user:**
- **The dispatcher's credential is deliberately deferred** (spec §12) — a dedicated
  `sb_secret_*` key, the service role, or `pg_net`. Cannot be chosen until `.env.local`
  exists and the project's key type is known. Designed so it is one line of config.
- **The locked-phone walk is the user's to perform.** Playwright covers the two-browser run
  and real push to desktop Chrome; nothing automatable covers an iPhone installing to the
  Home Screen, re-signing in, and receiving a notification on a locked screen (spec §9.4).
  Its harness must run against `channel: "chrome"` — Playwright's bundled Chromium usually
  cannot register for push, and would go green while proving nothing.

**Pushed to `origin/main` 2026-08-30.** The brainstorm state, the cycle-2 spec and this
file all survive a fresh clone now — `7879ea8` from the previous session had also never
been pushed and went up with them.

---

### Cycle 2 brainstorm state — historical, superseded by the spec above

**Read `docs/superpowers/handoffs/2026-08-29-cycle-2-brainstorm-state.md` before anything
else.** Nothing is implemented and no spec file exists yet; that document is the entire state of
the design conversation, written down precisely so it does not evaporate the way cycle 1's
git-ignored ledger did.

In short: cycle 2 is **durable availability only** (the student dashboard was split back out,
user's choice). The approach — **B′** — is approved, as are design Sections 1–3 (data model,
delivery, honest degradation). **Resume at Section 4 of 5** (PWA + onboarding), then Section 5
(testing), then write the spec, then `superpowers:writing-plans`.

Three things settled this session that earlier notes leave open:
- **Primary device: all devices, first-class.** The question `project_state` flagged as "asked
  and withdrawn — re-ask it first" is now answered. Do not ask again.
- **Teachers will onboard via a PWA**, with an App Store build anticipated later — so the push
  transport is built behind a port, mirroring `src/lib/payments/port.ts`.
- **Standing user instruction:** *"this is a legit business being developed for scale. So choose
  accordingly."* Saved to project memory as `build-for-scale`.

**🛑 This machine is a fresh clone: no `node_modules`, no `.env.local`.** Nothing can be built,
run, tested or probed until both are restored. Every "verified green" claim below was verified
on the previous machine — re-establish the baseline before trusting it.

The payment-surface component tests (cycle-1 handoff §5) are a **separate bounded task** that
runs *before* this cycle's implementation, not inside its spec.

Then: student dashboard, admin (gated on the role-write guard above **and** on policy answers),
polish.

---

## What M3 built, and what proves it

The loop now runs: teacher accepts → a 120-second payment window opens → student pays → a signature-verified webhook mints the room and starts the session → leaving completes it and the earnings figure reflects money actually collected.

**Migrations `0002`–`0005` are all applied to the live Supabase project.** `0005` is the security boundary: `paid`, `active` and `refunded` require `auth.uid() is null`, so only the service role — held solely by the webhook — can write them.

**Three committed probes prove it against the real database** (`scripts/`), all re-runnable with **no arguments and no standing credential** — each mints a throwaway teacher and student via the admin API, uses their real JWTs, and deletes both in a `finally` (`scripts/probe-accounts.mjs`):
- `probe-session-rls.mjs` — the ten-attack battery run **twice, once as each participant**. All twenty refused.
- `probe-happy-path.mjs` — sixteen legitimate writes across four rows plus four malformed inserts. Takes ~70s by design: it waits for a real Postgres deadline to elapse rather than mocking a clock.
- `reconcile-payments.mjs` — asserts the money invariants, exits non-zero on violation so it can gate a deploy.

Each probe also asserts that `sessions` **and** `profiles` returned to their pre-run row counts, so a leaked row or a leaked account fails the run.

**The test teacher's password was reset on 2026-09-05 at the user's request, for ACCESS — not as a security rotation.** `tutor-check@smbtutorials.in` is the M1/M2 test teacher account. The user asked for a known password so they could sign in as a teacher; it was set via the Supabase admin API and verified with a real `/auth/v1/token` sign-in. **The password is not recorded here or in any tracked file** — ask the user, or reset it again the same way.

**Do not propose rotating it for security reasons.** That was raised, decided against by the user on 2026-08-27, and the reasoning still holds: it is a pseudo account with a scheduled death, so rotating its credential is busywork. Nothing depends on it — no probe or source file references the account or `PROBE_TEACHER_PASSWORD` (verified again 2026-09-05) — so nothing breaks when it goes.

**The action that IS still owed is DELETION**, tracked under "Open before real launch" below. It is a pseudo account on `smbtutorials.in`, a domain nobody owns; `scripts/probe-accounts.mjs:58` also mints throwaway accounts there, which is harmless (nothing is ever sent to them, and they are deleted in a `finally`) but worth re-pointing if a real domain is settled.

### Task 11, closed (2026-08-27)

Its review had come back *changes requested* and the first fix round died on a quota limit having changed nothing. All three findings are now closed, and every claim below was re-verified by running the scripts against the live database, not by inspection:

1. **`accepted → cancelled` by the student is now proved.** It was the one legitimate M3 write the suite could not make: the trigger gates it on `uid is distinct from old.student_id` with no service-role escape, so only a real student JWT can perform it. `probe-happy-path.mjs` now drives a fourth row — student inserts with their own token → teacher accepts → checkout is stamped → **student cancels with their own token** — and it is PERMITTED.
2. **The malformed-insert probes can no longer leak a row.** They exist to catch a regression where one *stops* failing, and in that case the created row used to survive in the live table carrying forged data. The id is now captured into the cleanup list *before* the verdict is printed. **Proved by deliberately making one of them a legal insert:** the run went red as it should *and* the table returned to its original 5 rows.
3. **The attack battery now runs as the student as well as the teacher**, per spec §8, on two independently seeded rows so neither inherits the other's state. Twenty attacks, all refused.

**Beyond the three findings, deliberately:** the probes no longer depend on `PROBE_TEACHER_PASSWORD` or on any fixed account. `scripts/probe-accounts.mjs` mints a throwaway teacher and student per run (admin API, runtime-generated password never logged), and deletes both in a `finally`; a failed deletion fails the run. This is what let the fix round be verified at all in a session that had no teacher password, and it retires the standing credential the ledger flagged for rotation. A fourth malformed insert — a request arriving with payment data already on it — now covers 0005's new insert-trigger ban, which had no probe.

**Green after the round:** 83 tests · `tsc --noEmit` 0 · eslint clean · `npm run build` clean · all three probes exit 0.

### Two gaps closed after that (2026-08-27, user chose "fix both")

Both were recorded gaps, not new work, and both are **app-layer only — no migration, no DB change**, so the probes above are unaffected and were not re-run.

1. **The busy-teacher regression, fixed at the root.** Presence now follows the *commitment*, not the navigation: `IncomingRequest` reports whether the teacher is committed, the new `DashboardLive` holds that fact for the two siblings that need it, and `AvailabilityToggle` untracks — **without unsubscribing**, so the channel and the remembered intent survive and the teacher reappears on their own when the window resolves. The toggle reads three states now: Offline · In a session (amber) · Available now. Two more defects in the same code went with it — the catch-up query's `limit(1)` on `created_at desc` let a second student's newer request mask the teacher's own in-flight row (now `pickOpenRequest`, 10 unit tests), and the card collapsed `paid` into `accepted` so the countdown could clear a card whose student had already paid.
2. **`accepted → cancelled` made reachable.** `cancelSession` takes `pending` and `accepted`; Cancel sits beside Pay. It now returns `{ cancelled }` and the screen only navigates on a true — otherwise a student whose payment cleared in the same instant would be walked off the screen their room was about to open on. The other half of that race was already safe: the webhook refunds a payment landing on a row that is no longer `accepted`.

**93 tests · tsc 0 · eslint clean · build clean.** Neither fix is proven in a browser — both are client-side realtime, which is exactly what Task 13 Step 3b now exists to cover.

## Known gaps carried out of M3

- ~~**A teacher in the payment window is still visible as available.**~~ **FIXED 2026-08-27** at the root, as the spec required: presence follows the commitment, not the navigation. The toggle untracks (without unsubscribing) from `accepted` through `paid`, and reads three states — Offline · In a session · Available now. Two further defects in the same code went with it: the dashboard catch-up query no longer lets a newer pending row mask the teacher's own in-flight session (`pickOpenRequest`, unit-tested), and a `paid` card is no longer cleared by the payment-window countdown. **Not yet proven in a browser** — presence is client-side realtime, so Task 13 Step 3b carries the run. M3 spec §9.
- **Four ways a row can strand at `paid`**, each requiring our database or the provider to fail *after* money moved. All alarmed, none silent; a durable fix needs a transactional outbox M3 does not have. `reconcile-payments.mjs` is the backstop. M3 spec §9.
- ~~**`accepted → cancelled` is specified and permitted but unreachable.**~~ **FIXED 2026-08-27** (user chose to widen the action over narrowing the spec): `cancelSession` accepts `pending` and `accepted`, and the waiting screen shows Cancel beside Pay. The status filter decides the race in Postgres, and `cancelSession` now returns `{ cancelled }` so the screen never navigates a student away from a session that just got paid for. **Not yet proven in a browser** — Task 13 Step 3b runs the pay/cancel race deliberately. M3 spec §9.
- **A crossed `payment_ref` alarms rather than auto-refunding** — money sits with the provider until a human acts. Should be impossible (the column is unique and write-once), so its occurrence is itself the signal. M3 spec §9.
- **The development stub and `/dev/checkout` must not reach production.** Four independent refusals plus a build-time 404. Delete both once Razorpay is live. M3 spec §13.
- `getOrCreateRoom` in `daily.ts` still has no caller and still mints *public* rooms — the M2 trap, still open.

## Post-M3: redesign + the three dashboards (scoped 2026-08-26, deferred behind M3)

**Sequencing decision (user, 2026-08-26): ship M3 Stripe Checkout on the current UI FIRST, then do all of the below.** The trade-off was put to the user explicitly — the redesign will then have to absorb the Stripe surfaces too, and admin/payouts stays manual while real money is moving — and they chose this order anyway. Do not re-litigate it; do plan M3 knowing its UI is temporary.

**How this started:** a signed-in teacher had no way to reach `/dashboard`. Verified: `auth/actions.ts` redirects everyone to `/` after sign-in, and `/` renders only "Hi, {name}" + Sign out with no role branch.

**The real diagnosis is structural.** There is no authenticated shell anywhere. `SiteHeader` is a logo plus a per-page ad-hoc `action` prop; nothing in the app knows who is signed in or what role they are. M1 and M2 each built their own pages and the connective tissue was never built.

**Full inventory of what is missing (user, 2026-08-26 — "3 sets of different dashboards"):**

| Surface | Reality today |
|---|---|
| Teacher dashboard | EXISTS (M2): availability toggle, incoming request, subjects, history + earnings. Unreachable without typing the URL. |
| Student dashboard | **DOES NOT EXIST.** A student has `/find` -> `/teachers` -> call, then nowhere. No history, no profile, no home. |
| Admin | **DOES NOT EXIST AND CANNOT YET.** `profiles.role` is `check (role in ('student','teacher'))` — there is no admin role. Zero mention of admin in code or specs. Needs a migration, its own RLS policies, and policy decisions. |
| Shell / design system | No component layer, no nav, no role routing. |
| Polish | "Small things not given attention" — real, but only assessable once the above settles. |

**Why admin is load-bearing, not cosmetic.** Three existing launch blockers quietly require it: payouts are manual (the teacher dashboard literally renders "Payouts are made manually while payments are being set up"), the no-show/refund policy needs someone able to act on it, and the trust & safety escalation path for minors needs somewhere to escalate *to*.

**Agreed decomposition — four separate spec -> plan -> implement cycles, in this order:**
1. **IA + design system** — the shell, role-aware nav, post-login routing by role, the component layer that was never built, the visual language, and deleting the marketing copy that advertises deferred features. Everything else is built *in* this, so it must go first; doing it later means building three dashboards in the old language and redoing them.
2. **Student dashboard** — smallest new surface; closes the student's dead end after a call.
3. **Admin** — largest; gated on policy answers only the user can give; unblocks the launch items above.
4. **Polish pass** — last, against a finished system rather than a moving one.

**Scope already chosen by the user: FULL VISUAL REDESIGN** — rework the visual language across every screen (layout, typography, spacing, components), not just navigation. Chosen over "connective tissue only" and over "shell + fix the lying pages", having been told it touches pages verified working the same day.

**Findings that must survive into that work:**
- **Stack drift:** `CLAUDE.md` locks the stack as "Tailwind + shadcn/ui" but **shadcn/ui was never installed** — no `components.json`, no `src/components/ui`, only two shared components (`site-header`, `google-button`). Every button/card/input is inline Tailwind duplicated per page, inherited from the CRA demo. The redesign is *building* the component layer, not repainting one.
- **The home page lies about the product.** `/` advertises "Your Schedule — Book sessions that fit your time", the scheduled tier that is deferred. Same defect class as `/terms` (chat, packages, ratings).
- **Primary device is a product decision, not a styling one.** "Online" means a teacher has `/dashboard` open in a *visible* tab; on a phone, backgrounding the browser throttles the websocket and the teacher silently drops offline. If phones are primary for teachers, design spec §3's presence model needs rethinking. Current build is desktop-first, which is unusual for Indian K-12. **This question was asked and withdrawn for clarification — re-ask it first when this work starts.**

**Still-open questions for piece 1:** primary device per role (above) · is the SMB teal/cyan brand and "One Student, One Teacher" fixed or open · does "every screen" include the marketing surface (`/`, `/terms`, `/signup`, `/tutor-signup`) or only the product surface · is there a visual reference the user likes, or should directions be proposed.

**Process note:** classified architectural. When resumed, the brainstorming skill's architectural path applies — questions, approaches, sectioned design, written spec, then `writing-plans`. Do NOT invoke `ui-ux-pro-max` or any implementation skill during the brainstorm; the only terminal state is `writing-plans`.

## Now
**🌐 Production is live: https://smb-tutorials.vercel.app** — M2 is deployed and verified there (deployment `b7i9b32au`, 2026-08-26). Every route curl'd against the real URL, not just "Vercel says Ready": marketing pages 200, `/dashboard` `/waiting/{id}` `/call/{id}` all 307 behind the auth gate, `/call` and `/api/rooms` both 404 confirming the M0 spike is gone from the deployed build.

**M0 complete** — Daily plumbing proven. *(The spike itself was deleted in M2 Task 11; see spec §15.)*

**M1 complete (all 12 tasks)** — auth, profiles, taxonomy, tutor onboarding, `/find` → `/teachers` browse. Deployed and verified in production.

**M2 complete and deployed (all 12 tasks, merged to `main`)** — 57 tests green, `tsc --noEmit` exit 0, eslint clean, production build clean.
- **The loop:** `/teachers` lists only teachers who are online *right now* (eligible ∩ presence) → **Start now →** → `/waiting/{id}` with a 30s countdown → teacher's dashboard shows an Accept/Decline prompt → Accept mints a **private** Daily room server-side and drops both into `/call/{id}` for a fixed 60 minutes → leaving (or the countdown) completes the session and it appears in the teacher's history with earnings.
- **Migrations applied to the live project:** `0002_sessions.sql` (table, RLS, realtime publication), `0003_session_integrity.sql`, `0004_session_student_name.sql`. All three verified against the live DB, both that they block what they should and that they permit every write the app makes.
- **Spec §15 is closed.** Rooms are minted only inside `acceptSession`, are private, carry an `exp` tied to the session length, and each party joins with its own meeting token. `/call` (spike) and `/api/rooms` are deleted.
- **A whole-branch code review was run and every Critical and Important finding fixed** (2 Critical, 8 Important). The two Criticals were: a teacher whose browser closed mid-call was locked out of the product permanently, and the `sessions` RLS was column-blind so either participant could rewrite `hourly_rate`, jump `pending → completed`, or forge an `active` row that could never expire. Both are closed by the read-time settling in `acceptSession` plus the `0003`/`0004` triggers, and both were probed against the live DB before and after.
- **The two-browser run passed.** The first attempt found three bugs no automated check had caught: `postgres_changes` were silently dropped because the realtime socket joins as `anon` unless the JWT is pushed onto it *before* subscribing (`subscribe()` acks SUBSCRIBED either way); Daily's `privacy` is a top-level room field, not a room property, so no room was ever minted — and the unit test asserted the wrong shape against a mock, so it agreed with the bug; and a student sent back after a failed attempt lost their search criteria. All three fixed and re-verified against the real services.
- **Shipped.** `main` @ `790db95`. 12/12 tasks, 57 tests, migrations 0002-0004 live.
- **Known gap found immediately after shipping:** no navigation to `/dashboard` for a signed-in teacher. See "Redesign brainstorm — open" above.

**⚠ The one thing to know about presence:** a teacher is online only while their dashboard tab is open. Accepting navigates them to `/call`, which drops presence on purpose (a teacher in a session must not look startable); returning to `/dashboard` restores it from a localStorage intent flag. An empty `/teachers` list is almost always "nobody has a tab open", not a bug.

**Terms-page caveat:** the demo's policy text is transcribed as-is and **contradicts the spec** — it describes a messaging system (chat is deferred), package/bundle purchases, ratings, and a scheduled-session model. Spec §12 lists no-show/refund policy as open before launch; rewrite this page then rather than treating it as settled policy.

**Supabase project ref:** `upggvzzzoxqgourjywtd` (SQL editor: `https://supabase.com/dashboard/project/upggvzzzoxqgourjywtd/sql/new`). The public `/auth/v1/signup` endpoint **rejects `@example.com`** addresses — use a real-looking domain when testing; the admin API does not validate.

## Source of truth
- Spec: `docs/superpowers/specs/2026-08-24-smb-tutorials-design.md` — all stack + scope decisions.
- M2 design: `docs/superpowers/specs/2026-08-25-m2-presence-instant-pick-design.md`.
- **M3 design: `docs/superpowers/specs/2026-08-26-m3-payments-design.md`** — approved 2026-08-26. §11 records the deviation from the locked "Stripe Checkout" to a processor-agnostic port, and the subsequent choice of **Razorpay** with the reasoning. §9 lists every accepted gap; §13 the spike debts.
- **Cycle 1 handoff: `docs/superpowers/handoffs/2026-08-28-cycle-1-ia-design-system.md`** — READ FIRST. The ledger was git-ignored scratch; this is what survived it.
- **Cycle 1 spec: `docs/superpowers/specs/2026-08-28-ia-design-system-design.md`** — §17 records the findings that originated in the spec itself, including the role-write security hole.
- **Cycle 1 plan: `docs/superpowers/plans/2026-08-28-ia-design-system.md`** — amended in flight as reviews found defects in it.
- **M3 plan: `docs/superpowers/plans/2026-08-26-m3-payments.md`** — 13 tasks. Its code blocks have been synced to the reviewed implementations, so a re-run reproduces what shipped rather than the original drafts.

## Decided
- Stack: Next.js (App Router) on Vercel · Supabase (Postgres + Auth + realtime) · Daily.co (video) · Stripe Checkout · Resend · Tailwind + shadcn/ui.
- Serverless, GitHub → Vercel push-to-deploy. No server to run.
- Auth = Supabase Auth (not Clerk) — swap is cheap if revisited.
- Presence (teacher online-now) via Supabase Realtime — instant model needs presence, not a matching engine.
- Product = 3 tiers: **instant pick** (primary) · **request offline teacher** (fallback) · **scheduled** (add-on later).
- Domain: Indian K-12 — CBSE/State Board/ICSE, grades 6–12, streams Science/Commerce/Arts.

## Build order
M0 ✅ → M1 ✅ → M2 ✅ → M3 ✅ → **redesign cycle 1 (IA + design system) ✅ SHIPPED 2026-08-28** → **cycle 2: fix what "online" means + student dashboard** → cycle 3: admin (gated on the role-write guard) → cycle 4: polish → M4 request fallback.

*Ordering note: the redesign sits after M3 by explicit decision, so M3 ships on a UI that is known to be temporary.*

## Deferred (not MVP)
Scheduled tier (Cal.com later) · Stripe Connect · search/ranking · chat.

## Open before real launch
**🛑 ROLE-WRITE GUARD on `profiles` — blocks migration `0006` and therefore cycle 3.** `0001`'s update policy lets any signed-in user rewrite their own `role`. See the cycle-1 handoff §1 and spec §17.1.

No-show/refund policy · trust & safety (minors) escalation path · delete test teacher · finish `/terms` (the false feature claims are gone; the policy itself is still unpublished) · ratify or revert the `/find` + `/teachers` sign-in gate.

**⚠ ROTATE `SUPABASE_SERVICE_ROLE_KEY` — DEFERRED BY THE USER to the pre-launch pass (decided 2026-08-27). Do not re-raise it before then.** It was printed into a conversation transcript on 2026-08-27 by an assistant command that dumped `.env.local` while showing an appended block. It is in no committed file and `.env.local` is gitignored, but this key bypasses every RLS policy and is the credential the payment webhook holds — the one thing migration 0005's security boundary assumes only the server has.

*Why deferring is defensible:* the exposure is a private transcript, not a public one; the repo is private; the project is pre-launch with a handful of test rows, no real users and no real money. *What makes it stop being defensible:* real users, real money, or a public/production launch — whichever comes first. Rotating it then is the same job, done once, at the point it actually matters.

*The catch to know before doing it:* on legacy Supabase projects `anon` and `service_role` are both JWTs signed by one project JWT secret, so rotating `service_role` regenerates the anon key **and signs out every user**. If the project offers the newer independently-rotatable secret keys (`sb_secret_…`), use those instead — no collateral. Then update `.env.local` and Vercel for Production, Preview and Development, redeploy, and prove it with `reconcile-payments.mjs` and `probe-session-rls.mjs` (both must exit 0). The `NEXT_PUBLIC_SUPABASE_ANON_KEY` exposed alongside it needs nothing — it is public by design.

**`.env.local` is the user's file (2026-08-27).** Do not write to it. Propose lines; let them paste. Reading it is fine — the probes parse it at runtime.

**Needs an admin surface before launch (see the post-M3 section):** manual payouts · no-show/refund policy · trust & safety (minors) escalation.

**Carried forward from the M2 review (logged, not blocking):** `getOrCreateRoom` in `daily.ts` survives with no caller and still creates *public* rooms — delete it or make it private-by-default before anything calls it (spec §15) · only one incoming request is displayed at a time, a second overwrites the first · `sessions.subject` has no CHECK constraint (the insert trigger blocks the forged-insert route to it) · `didNotRespond` on `/teachers` is unvalidated text (React escapes it, so content-injection not XSS).

## Environment / facts (for a cold session)
- **Repo:** `~/smb-tutorials`, git remote `origin` = GitHub `durdengrin-cyber/smb-tutorials` (private), branch `main`. Per-repo credential isolation set (`credential.useHttpPath true`) so its scoped token never touches HL-Trader's.
- **Vercel:** project `smb-tutorials` under team `durdengrin-6266s-projects`, auto-deploys `main`. Production URL **https://smb-tutorials.vercel.app**. All four env vars (`DAILY_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) set for Production + Preview + Development.
- **⚠ Vercel gotcha that cost a session:** the project had **no Framework Preset** (set to "Other"), so `npm run build` succeeded and the deployment showed **Ready** while Vercel applied no Next.js routing — every path, including `/_next/static/*`, returned a platform `x-vercel-error: NOT_FOUND`. Deployment Protection (Vercel Authentication) masked it behind an SSO redirect from M0 until 2026-08-25. Fixed by committing `vercel.json` with `{"framework": "nextjs"}` so the setting is version-controlled. **"Deployment Ready" ≠ "site works" — always curl the real URL.**
- **Local secrets:** `.env.local` (gitignored) holds the Daily + Supabase keys. Daily domain = `smbtutorials` (rooms at `smbtutorials.daily.co/...`). Daily billing/payment method added.
- **Demo (UI/UX blueprint, read-only):** `~/Downloads/SMB-Tutorial-main` — a CRA single-file `src/App.js` (~2,387 lines), no backend. We rebuild it in Next.js; do NOT extend it.
- **Stack live:** Next.js 16 + React 19, Tailwind v4, Vitest (57 tests), `@supabase/supabase-js` + `@supabase/ssr`. Scripts: `npm run dev|build|test`.
- **App routes:** `/` home · `/signin` · `/signup` · `/tutor-signup` · `/find` · `/teachers` · `/dashboard` (teacher) · `/waiting/[sessionId]` · `/call/[sessionId]` · `/terms` · `/auth/callback`. *(`/call` and `/api/rooms` were the M0 spike and are deleted.)*
- **Next.js 16 gotchas:** `middleware.ts` is deprecated → `src/proxy.ts` exporting `proxy()`. `searchParams` is a Promise. A `"use server"` file may only export async functions. Supabase's `.select()` string must be a single literal or type inference collapses to `GenericStringError`. Read `node_modules/next/dist/docs/` before writing app code.
- **`next-env.d.ts` churn:** Next rewrites it to `.next/dev/types/...` after `next dev` and `.next/types/...` after `next build`, so it shows as modified after running dev. Discard it (`git checkout next-env.d.ts`); it is not a real edit.
