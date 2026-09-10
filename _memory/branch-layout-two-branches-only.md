---
name: branch-layout-two-branches-only
description: The repo is deliberately two branches — main and feat/teacher-vetting; six others were deleted on 2026-09-09 after being proven fully contained.
metadata:
  type: project
---

As of 2026-09-09 the repo carries **two** branches on `origin`: `main` and
`feat/teacher-vetting`. All development lives on `feat/teacher-vetting`, which contains
`main` entirely (`main` is 0 ahead, the branch 100 ahead) — shipping is one fast-forward.

Deleted on 2026-09-09, each proven to have **zero** commits unreachable from
`feat/teacher-vetting` before removal (`git branch -d` accepted the local ones, which is
itself the proof):

| branch | tip | was |
|---|---|---|
| `cycle-2/durable-availability` | `525e29e` | remote |
| `m3-payments` | `cad3783` | remote + local |
| `feat/visual-identity-tokens` | `ba73f13` | remote |
| `m2-presence-instant-pick` | `790db95` | local |
| `redesign/ia-design-system` | `35fc5fc` | local |
| `backup/teacher-vetting-premigration` | `03b84ee` | local — **still present**, see below |

`backup/teacher-vetting-premigration` was judged safe to delete but not yet removed. It holds
the *superseded* vetting design — four states (`unvetted/cleared/suspended/removed`) and
`0020_teacher_vetting.sql`, the migration whose two defects review caught. The shipped design
is two states, because `teacher_suspensions` (`0020`) owns suspension. **Do not read that
branch as current.**

`backup/visual-identity-duplicate` is kept on purpose — see
[[orphaned-online-count-on-backup-branch]].

**Why:** `feat/visual-identity-tokens` is referenced throughout `project_state.md` and older
handoffs as "where development lives". That is no longer true and the branch no longer exists;
its 87 commits are a subset of `feat/teacher-vetting`'s 100.

**How to apply:** when a doc, handoff or spec points at `feat/visual-identity-tokens`,
`m3-payments` or `cycle-2/durable-availability`, read `feat/teacher-vetting` instead — the
content is there. Recover any deleted branch with `git branch <name> <tip>` from the table;
git keeps unreachable objects roughly 90 days before `gc`.

**Update 2026-09-10:** a third branch, `review-base/session-start` (at `7bef05c`), exists on
local and origin. It is NOT development — it is only a diff base for `/code-review ultra`,
which refused the branch against `main` as too large (149 files, 18,631 lines, mostly old plan
documents). Delete it once that review is done; the intended steady state is still two.

**Updated 2026-09-10.** Two more deleted once `main` was fast-forwarded to the vetting work:

| deleted branch | tip | why it was safe |
|---|---|---|
| `review-base/session-start` (local + origin) | `7bef05c` | zero commits not in `main`; existed only as a diff base for one review |
| `backup/teacher-vetting-premigration` (local) | `03b84ee` | 7 commits, but they are the PRE-REBASE originals of the vetting work that `c6c8ab7` rebuilt on the correct base and shipped |

Remaining: `main`, `feat/teacher-vetting` (identical to `main`), and
`backup/visual-identity-duplicate` — kept for the reason in
[[orphaned-online-count-on-backup-branch]] and on no remote, so it only exists on this machine.

