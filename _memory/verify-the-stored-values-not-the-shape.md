---
name: verify-the-stored-values-not-the-shape
description: A conditional finding is only falsified by running the real check against the real values — matching the shape of the data is not the check.
metadata:
  type: feedback
---

Before tightening `demoVideoUrl` to YouTube-only on 2026-09-09, I checked production and
reported: *"both existing teachers already hold YouTube URLs, so nobody is locked out."*

The query classified rows by **host** (`ilike '%youtube.com%'`). It never ran the validator.
The stored values were `https://www.youtube.com/watch?v=abc123` and `https://youtu.be/abc` —
YouTube hosts with 6- and 3-character ids where every real one is 11. **The new validator
rejected both**, so either teacher opening `/profile` would have been blocked from saving
anything — bio, rate, subjects — and one of them, Mr. Azad, is a real tutor with 22 completed
sessions.

The same shape of mistake recurred: a refactor that made `parseTeacherProfile` require
`curricula` passed all 564 tests, because every fixture hand-built a FormData containing
`curricula`/`grades`/`subjects` — a shape the real form had stopped sending. **Every profile
save was broken and the suite was green.**

**Why:** CLAUDE.md's rule is that a conditional finding names its falsifying check and that
check runs first. Both failures obeyed the letter and missed the point — a check that
approximates the real one is not the real one.

**How to apply:**
- **Run the actual code against the actual values.** For a validator, call the validator. Not
  a regex that resembles it, not a host match, not a type check.
- **Derive test fixtures from what the form actually renders**, not from what the parser
  accepts. `validation.test.ts` now carries an `AS_RENDERED` fixture containing deliberately
  nothing the profile form does not submit.
- When a check comes back clean, ask *"what exactly did that prove?"* before reporting it.
- Related: [[browser-testing-finds-what-reading-cannot]]
