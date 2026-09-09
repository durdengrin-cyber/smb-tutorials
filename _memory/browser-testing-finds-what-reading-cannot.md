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
