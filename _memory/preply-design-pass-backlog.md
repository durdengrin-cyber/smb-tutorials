---
name: preply-design-pass-backlog
description: The 45-item Preply benchmark backlog lives in a private Artifact, not in the repo — with tick state shared across both machines.
metadata:
  type: reference
---

The design pass benchmarked against preply.com is parked here:

**https://claude.ai/code/artifact/7dc08231-8db3-4777-93f6-7261f649f3e6**

45 items, each pairing what Preply does with what we actually ship and what would change.
Filterable by Ship now / Bigger build / Needs a decision / Not adopting. **Tick state is stored
in the artifact's shared database, so progress syncs between both machines** — that is why it is
an Artifact and not a markdown file in the repo.

Read it with the Artifact tool (`action: "read"`, that URL); update it by publishing to the same
`url`. Publishing without `url` creates a *separate* artifact instead of updating this one.

Started 2026-09-10, audited against our own production 2026-09-11.

**What is already done** (kept here because the artifact records it too, and this is the index
the next session sees first):

- **1, 3, 4, 8, 9, 20, 21** — teacher card rebuild, commit `9138673`
- **10** — root 404, commit `61fbe66`
- **43** — entity name in `/terms`, commit `0c6676d`

**What the audit changed about the list itself:** four items asserted that our code of conduct,
refund policy and no-show rule did not exist. All three are published on `/terms`. Section E
shrank from "write these documents" to "make them findable" — they are four separate documents
stacked on one page with no index. See [[browser-testing-finds-what-reading-cannot]].

**Still unverified:** items 1–9, 20, 21, 39 and 42 have never been seen against the real
`/teachers`, only against fixtures. That needs a student session in the browser — see
[[localhost-is-blocked-use-127-0-0-1]] for why the agent cannot arrange one alone.
