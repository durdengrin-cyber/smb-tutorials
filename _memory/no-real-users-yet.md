---
name: no-real-users-yet
description: Every account in the production database is experimental. There are no real users, no real tutors and no real money until the owner says the site is live.
metadata:
  type: project
---

Stated plainly by the owner on 2026-09-10: **nothing in this product is real yet.** The site is
not published, the domain is not pointed at it, and **every account in the production database is
experimental** — including `tutor-check@smbtutorials.in` ("Mr. Azad"), whose ~22 completed
sessions were video tests run from that account, not lessons with a student.

Launch is an explicit decision the owner will announce. Until then, "production" means the live
Supabase project and the `main` deployment, not a live business.

**Why this is worth remembering:** a memory here asserted for weeks that Mr. Azad was "a real
tutor with 22 completed sessions", and on 2026-09-10 I used that phrase repeatedly to argue the
severity of findings — a lock-out bug, deploying recording copy, publishing an unreachable contact
address. Every one of those was a real defect on its own merits. The *urgency* attached to them
was borrowed from a fact nobody had checked, and it went unchallenged for a whole session because
it was written down.

**How to apply:**
- **Do not inflate severity with imagined users.** "This would strand a paying parent" is a
  hypothesis about who exists, and the answer is currently nobody. Argue from the defect.
- **Merging and deploying are not launching.** The owner has said this directly; treat a
  production deploy as reaching a staging environment that happens to be public, not customers.
- **Re-check the narrow class of fact that goes stale: what EXISTS.** Most of what is written in
  these files is reliable and meant to be trusted — that is the whole point of them, and treating
  every note as suspect would waste more than it saves. But claims about users, accounts, live
  data and money change on their own, without anyone editing the file that records them. This one
  was both stale AND load-bearing for severity, which is the combination worth a query.
- Related: [[verify-the-stored-values-not-the-shape]],
  [[read-the-whole-function-before-diagnosing]] — the same failure, applied to data and to code.
