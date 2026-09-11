---
name: browser-testing-finds-what-reading-cannot
description: Driving the real app in Chrome found five defects that code-reading, curl and 560 passing tests all missed — and corrected two wrong claims.
metadata:
  type: feedback
---

On 2026-09-09/10 the owner asked whether driving the app with the Chrome extension was
worth it. It was, decisively, and the reason is specific: **`curl` has no session, and jsdom
has no layout or push service.** Everything interactive, auth-gated or state-dependent is
invisible to both.

Found only by driving it:

- **Both teachers were locked out of profile editing** — their stored demo URLs
  (`youtube.com/watch?v=abc123`) had 6- and 3-character ids where real ones are 11. Found by
  reading the actual `href`s on `/admin`.
- **A misleading error**: a real YouTube host with a bad id was told "enter a YouTube link",
  which is what they had just done.
- **The VAPID key burning the notification permission** — reported from a screenshot.
- **A dead "Suspend" button** and **a suspension line naming the wrong origin** — both only
  visible by clicking and reading what came back.

It also corrected two claims **I had made**:

- "Both existing teachers already hold YouTube URLs, so nobody is locked out." That check
  matched the HOST only and never ran the validator against the stored values.
- "The admin has zero devices — sign in and turn on notifications." The count was right, the
  cause was not: `register_device` refused every role but `teacher` and no admin surface mounted
  the component, so there was no button to press. The fix I suggested was impossible.

**How to apply:**
- **Scope it to interactive, auth-gated, state-dependent surfaces.** "Walk all endpoints"
  is a combinatorial waste; the value is concentrated where a control can lie.
- **Ask which account to sign in as** — the agent cannot create accounts or type passwords.
- **Coordinate clicks, not `ref` clicks**: a `ref` click did not dispatch React's `onClick`,
  which nearly produced a false "Sign out is broken" report. Screenshot immediately before
  clicking; the page may have scrolled.
- **Wait out CSS transitions before screenshotting.** A 300ms carousel transition photographed
  mid-flight looked exactly like a layout bug, and was nearly reported as one.
- Related: [[promises-need-an-enforcer]], [[verify-the-stored-values-not-the-shape]]

**2026-09-10 — the ratio, measured again.** Nine issues were found and fixed in one session.
**Six came from the owner using the product**, not from me reading it:

- the recording policy was beside the signup form, not on it, so a guardian consented without
  ever meeting it — the single most important thing on that page
- an unvetted teacher could toggle "Available now" and be told "we'll notify you even with your
  phone locked", when nothing could reach him
- the operator approved a stranger to teach children while able to see a name, a badge and two
  links
- the demo video teachers are told "students watch" was renderable by nobody but an admin — the
  same defect as the bio, in the same file, missed when the bio was fixed the day before
- the admin roster I "fixed" was a page tall per teacher and unusable
- clicking a notification landed on a page that did not contain the thing it notified about

Reading found the review findings and `0029`'s dead migration. **Clicking found the rest.** The
pattern is not that reading is useless — it is that reading cannot see a control that lies, a
promise nobody renders, or a layout that does not work. Those are only visible to someone using
the thing.

**How to apply:** when a surface is finished, ask the owner to USE it before calling it done, and
treat what they report as the highest-signal input available. Do not defend the first design —
[[read-the-whole-function-before-diagnosing]] is what defending it looks like.


**2026-09-11 — the same lesson, twice more, and both times the tests were green.**

*Three defects that 685 passing tests could not see.* Rebuilding the teacher card, every test
passed while the component was visibly broken, because **jsdom has no layout engine**:

- with no demo video the media column was still declared, so a teacher who never uploaded one
  had their facts squeezed into an empty 11rem track
- the play button used `bg-background/90` — a theme-flipping token — directly on an arbitrary
  video frame, so in dark theme it was a dark circle on a dark thumbnail. `globals.css` already
  documents this hazard for `--stage`
- `hqdefault.jpg` is 480x360 and bakes letterbox bars into every 16:9 video, which
  `object-cover` then cropped into the card as two dead bands

None is subtle on screen. All three were invisible to the suite. The first was caught by
self-review; the other two only by rendering it.

*Four wrong findings from reading instead of looking.* A competitive audit produced a written
list asserting that our code of conduct, refund policy and tutor no-show rule "exist nowhere".
**All three are published on `/terms`** — five numbered conduct categories with explicit
penalties, a six-case refund policy, and a student code of conduct. Opening the page corrected
in minutes what reading the repo had got wrong with confidence. A fifth item claimed the price
label was a defect; `SESSION_DURATION_MINUTES = 60` settled it in thirty seconds.

**How to apply:**
- **A green suite is necessary and not sufficient for anything with a layout.** Before calling a
  component done, render it — a throwaway preview route with fixtures is enough when the real
  surface is auth-gated, and takes minutes.
- **Before writing that something does not exist, open the page.** "I did not find it in the
  repo" is not "it is not there", and the difference is expensive once it is written down.
- Related: [[localhost-is-blocked-use-127-0-0-1]]
