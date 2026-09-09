---
name: orphaned-online-count-on-backup-branch
description: online-count.ts exists only on the local backup/visual-identity-duplicate branch, on no remote, and is the sole reason that branch is kept.
metadata:
  type: project
---

`src/lib/online-count.ts` and `src/lib/online-count.test.ts` — 83 lines of pure, tested
logic — exist **only** on the local branch `backup/visual-identity-duplicate`
(tip `533b577`, commit "feat(marketing): derive the online count from one row shape",
written 2026-09-09). They are on **no remote** and are **not** on `feat/teacher-vetting`.

What the code does: takes `AvailabilityRow[]` (`{teacher_id, subject}`) and exports
`countTeachers()` (distinct teachers) and `countBySubject()` (per-subject distinct counts,
sorted by count desc then subject asc). Its doc comment states the intent — the homepage
nav count and the subject strip should be *provably* derived from the same rows.

Nothing imports it, on any branch. It is groundwork for a homepage live-teacher count that
was never built: `feat/teacher-vetting`'s homepage only links "See who's online now"
(`src/app/(marketing)/page.tsx:153`) with no number.

The other six commits on that branch are superseded — `feat/teacher-vetting` has newer
versions of theme-toggle, theme-provider, globals.css and marketing-header.

**Why:** on 2026-09-09 the repo was pruned to two branches, `main` and `feat/teacher-vetting`
(everything else was proven fully contained and deleted). `backup/visual-identity-duplicate`
was deliberately kept, and this orphaned pair is the only reason. Owner chose to keep the
branch rather than cherry-pick, because the code is unused until a homepage count exists and
would otherwise land as dead code.

**How to apply:** if a live teacher count or per-subject supply figure is ever built on the
homepage, do not write it from scratch — take it from here first:
`git show backup/visual-identity-duplicate:src/lib/online-count.ts`. Do **not** delete that
branch without cherry-picking these two files; it is local-only, so no remote holds a copy.
Recover the branch if lost with `git branch backup/visual-identity-duplicate 533b577`.

Related: [[branch-layout-two-branches-only]]
