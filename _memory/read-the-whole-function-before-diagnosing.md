---
name: read-the-whole-function-before-diagnosing
description: Twice in one hour I diagnosed a bug from a fragment and nearly shipped a migration for behaviour that already existed — read the whole function, and its caller.
metadata:
  type: feedback
---

On 2026-09-10, investigating why push notifications never arrived, I reported a confident root
cause twice and was wrong both times. Both errors were the same: **I stopped reading too early.**

1. **"`register_device` refuses an endpoint held by another account."** I read
   `raise exception 'endpoint is registered to another account'` and concluded a shared browser
   could never transfer a subscription. Directly *above* that raise is a `delete` that removes
   exactly that row when the keys match — the shared-device case. The raise only covers
   mismatched keys, which is a hijack attempt. I proposed a migration to add behaviour that had
   been there since `0009`.
2. **"The setup card hides itself, so the account never registers a device."** I read
   `nextSetupAction()` returning `"done"` and stopped. Its caller, `NotificationSetup`, calls
   `registerExistingSubscription()` **on mount precisely in the `"done"` branch** — the case I
   said never registers. The endpoint had in fact already transferred to the owner's admin
   account an hour earlier, exactly as designed.

The real fault was environmental — see [[push-silence-is-usually-the-os]] — and I was inventing
code defects to explain a symptom the OS was causing.

**Why it happened:** grep gives fragments, and a fragment that matches the symptom feels like a
finding. Both times the disproof was four lines away in the same file.

**How to apply:**
- **Before naming a function as the cause, read it start to finish** — not the matched line.
  Especially SQL, where the guard clause is usually the last thing in a block that already
  handled the case.
- **A function's behaviour includes its callers.** "This branch does nothing" is unprovable from
  the branch.
- **Check current state before building the fix.** One query — who owns the endpoint now — would
  have collapsed both diagnoses instantly, and it is what finally did.
- Related: [[verify-the-stored-values-not-the-shape]], which is the same failure with data
  instead of code, and CLAUDE.md's rule that a conditional finding names its falsifying check and
  runs it FIRST.
