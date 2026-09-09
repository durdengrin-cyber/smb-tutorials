---
name: minimise-review-passes
description: Batch subagent work and reserve reviews for security-touching code; token budget is tight.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 193ed0a3-52e8-4d86-94f2-6e74a0343183
  modified: 2026-09-09T07:41:53.876Z
---

Do not run a review pass per task. Batch same-shape tasks into one dispatch, and reserve
subagent review for code that can cause harm if wrong: SQL/RLS/migrations, auth guards,
payment paths. Mechanical TypeScript from a plan that already contains the full code gets
transcribed and gated by tests, not reviewed by a second agent.

**Why:** Said on 2026-09-09 during the teacher-vetting run — "we cannot waste on multiple
passes of reviews". Two implementer rounds plus two reviews on one task had cost ~220k tokens.

**How to apply:** Verify mechanically in the controller where it is cheap (diff two SQL bodies,
grep for a pattern) instead of dispatching. Use the cheapest model when the plan carries the
complete code. Keep exactly one review for the security surface — the opus review of migration
0020 caught a self-clearable vetting gate, so that category earns its cost.
See [[terse-communication-preferred]].
