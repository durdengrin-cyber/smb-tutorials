#!/usr/bin/env bash
# Where is the work, and does the repo agree with production?
#
# Written 2026-09-09 after a day that cost two rebuilt plans. Two machines work
# on this project. On 2026-09-06 one of them pushed 87 commits to
# feat/visual-identity-tokens — including migration 0020, which it applied to
# production — and never merged to main. The other machine started from main,
# could not see any of it, and rebuilt work that already existed. Twice.
#
# Neither failure was subtle. Both were invisible because nobody ran `git fetch`
# before starting, and because `main` being stale looks exactly like `main`
# being current. This script makes both states impossible to miss.
#
# Always exits 0. It reports; it never blocks. A check that blocks gets disabled.

set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

BOLD=$'\033[1m'; DIM=$'\033[2m'; WARN=$'\033[33m'; BAD=$'\033[31m'; OK=$'\033[32m'; OFF=$'\033[0m'
say() { printf '%s\n' "$*"; }

git fetch --all --quiet --prune 2>/dev/null

say ""
say "${BOLD}── repo sync ────────────────────────────────────────────${OFF}"

CURRENT=$(git rev-parse --abbrev-ref HEAD)

# 1. Where does development actually live? The branch furthest ahead of main is
#    the answer, whatever it is called — main itself is frequently not it.
HEAD_BRANCH="main"; HEAD_COUNT=0
while read -r ref; do
  [ -z "$ref" ] && continue
  n=$(git rev-list --count "main..$ref" 2>/dev/null) || continue
  if [ "${n:-0}" -gt "$HEAD_COUNT" ]; then HEAD_COUNT=$n; HEAD_BRANCH=$ref; fi
done < <(git branch -r --format='%(refname:short)' | grep -v 'HEAD')

if [ "$HEAD_COUNT" -gt 0 ]; then
  say "${WARN}main is ${HEAD_COUNT} commits behind ${HEAD_BRANCH}${OFF}"
  say "${DIM}  Development lives on that branch, not on main. Anything you plan"
  say "  against main may already be built there — check before you build.${OFF}"
else
  say "${OK}main is the furthest-ahead branch${OFF}"
fi

# 2. Is the branch in hand actually built on that work?
if [ "$CURRENT" != "HEAD" ] && [ "$HEAD_COUNT" -gt 0 ]; then
  if git merge-base --is-ancestor "$HEAD_BRANCH" HEAD 2>/dev/null; then
    say "${OK}${CURRENT} is built on ${HEAD_BRANCH}${OFF}"
  else
    BEHIND=$(git rev-list --count "HEAD..$HEAD_BRANCH" 2>/dev/null)
    say "${BAD}${CURRENT} is NOT built on ${HEAD_BRANCH} — missing ${BEHIND} commits${OFF}"
    say "${DIM}  Rebase before building anything: git rebase ${HEAD_BRANCH}${OFF}"
  fi
fi

# 3. Does the repo hold every migration production has run, and vice versa?
#    This is the check that would have caught 0020_teacher_suspensions on day
#    one: applied in production, absent from the working branch.
say ""
say "${BOLD}── migration drift ──────────────────────────────────────${OFF}"

if ! command -v supabase >/dev/null 2>&1; then
  say "${DIM}supabase CLI not installed — drift not checked${OFF}"
  say ""; exit 0
fi

# `timeout` is GNU coreutils and is NOT on a stock macOS. perl's alarm is,
# and both machines on this project are Macs.
LEDGER=$(perl -e 'alarm shift; exec @ARGV' 25 supabase migration list 2>/dev/null \
  | grep -oE '"remote": *"[0-9]+"' | grep -oE '[0-9]+' | sort -u)

if [ -z "$LEDGER" ]; then
  say "${DIM}could not read the remote ledger (not linked, offline, or timed out)${OFF}"
  say "${DIM}  run: supabase link --project-ref <ref>${OFF}"
  say ""; exit 0
fi

LOCAL=$(ls supabase/migrations/*.sql 2>/dev/null | sed 's|.*/||; s|_.*||' | sort -u)
DEFERRED=$(ls supabase/migrations-deferred/*.sql 2>/dev/null | sed 's|.*/||; s|_.*||' | sort -u)

APPLIED_NOT_LOCAL=$(comm -23 <(echo "$LEDGER") <(echo "$LOCAL"))
LOCAL_NOT_APPLIED=$(comm -13 <(echo "$LEDGER") <(echo "$LOCAL"))

if [ -n "$APPLIED_NOT_LOCAL" ]; then
  say "${BAD}applied in production, MISSING from this branch: $(echo $APPLIED_NOT_LOCAL | tr '\n' ' ')${OFF}"
  say "${DIM}  The schema is live and the file is not here. Find it on another"
  say "  branch before writing anything that touches those objects.${OFF}"
fi

if [ -n "$LOCAL_NOT_APPLIED" ]; then
  for v in $LOCAL_NOT_APPLIED; do
    if echo "$DEFERRED" | grep -qx "$v"; then continue; fi
    say "${WARN}staged locally, not applied: ${v}${OFF} ${DIM}(next db push will apply it)${OFF}"
  done
fi

if [ -n "$DEFERRED" ]; then
  say "${DIM}deliberately unapplied: $(echo $DEFERRED | tr '\n' ' ')${OFF}"
fi

[ -z "$APPLIED_NOT_LOCAL" ] && [ -z "$LOCAL_NOT_APPLIED" ] && say "${OK}repo and production agree${OFF}"

say ""
exit 0
