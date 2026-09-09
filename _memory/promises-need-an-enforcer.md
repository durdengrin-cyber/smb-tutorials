---
name: promises-need-an-enforcer
description: This codebase repeatedly ships UI copy and controls that assert something no code enforces; six were found in one day. Check the claim, then pin it.
metadata:
  type: feedback
---

On 2026-09-09/10, **six separate promises with no enforcer** were found in this repo in a
single session. Not typos — each was a sentence or a control that told a user something the
code did not do:

1. `/admin`'s **Suspend button** submitted `state="suspended"`, a value `VETTING_STATES` had not
   held since suspension moved to its own table. It threw on every click, and had since the
   model changed.
2. The profile form said **"Changing this sends your profile back for review"**. Nothing reset
   `vetting_state`. (Now true — migration `0024`.)
3. The profile editor said the **bio was "shown to students"**. It was read by nothing.
   (Now true — the teachers page selects it.)
4. Every **form implied your input was safe**. React 19 resets an uncontrolled form when its
   action completes, so a rejected submit returned a blank one.
5. `/tutor-signup` told a signed-in student **"completing this form converts that account"**,
   then `become_teacher` refused them after fifteen fields.
6. `/admin` said **"Suspended automatically by a conduct report"** about a suspension the admin
   had applied by hand, with their own reason, seconds earlier.

**Why:** the claim and the mechanism live in different files, and nothing connects them. Each
was individually reasonable when written; each became false when something else changed, and
nothing failed.

**How to apply:**
- **Before writing UI copy that asserts behaviour, go and check the behaviour.** Three of these
  were introduced by an agent writing plausible copy without verifying it.
- **Then pin it with a test that runs BOTH ways** — the claim may exist only while the
  mechanism does, and the mechanism must not appear without the claim. `profile-claims.test.ts`
  and `admin-controls.test.ts` are the pattern; both were verified by reintroducing the bug and
  watching them fail.
- **Four of the six were found by driving the app in a browser, not by reading code.** Reading
  cannot see a button that throws or a sentence that lies. See
  [[browser-testing-finds-what-reading-cannot]].
