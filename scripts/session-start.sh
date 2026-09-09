#!/usr/bin/env bash
# Runs at the start of every Claude Code session, via the SessionStart hook in
# .claude/settings.json. Two jobs: pull, then report where the work actually is.
#
# Emits a JSON object whose additionalContext is injected into the session, so
# the agent reads this before it plans anything.
#
# Adapted from HL-Trader-Private's SessionStart hook, with two deliberate
# changes that project's own notes asked for:
#
#   1. The branch is DERIVED, not hardcoded. A hardcoded branch pulls the wrong
#      thing the moment anyone works on a feature branch.
#   2. A failed pull is LOUD. `|| true` on a pull means a diverged branch looks
#      exactly like a clean one, which is how a stale base goes unnoticed.
#
# And a third the pull alone does not cover: on 2026-09-09 `main` was perfectly
# in sync with `origin/main` while 87 commits of shipped work — including a
# migration already applied to production — sat on a feature branch nobody had
# fetched. A pull would have reported success. sync-check.sh is what catches it.

set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

REPORT=""
add() { REPORT="${REPORT}$1"$'\n'; }

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

if [ "$BRANCH" = "HEAD" ]; then
  add "Detached HEAD — not pulling. Check out a branch before working."
elif git rev-parse --abbrev-ref "@{upstream}" >/dev/null 2>&1; then
  # --ff-only, never a merge: an automatic merge commit in a hook is a surprise
  # nobody asked for, and a diverged branch is something a person should see.
  if OUT=$(git pull --ff-only 2>&1); then
    case "$OUT" in
      *"Already up to date"*) add "${BRANCH}: already up to date with its upstream." ;;
      *)                      add "${BRANCH}: pulled from upstream." ;;
    esac
  else
    add "PULL FAILED on ${BRANCH} — resolve before working:"
    add "  ${OUT}"
  fi
else
  add "${BRANCH} has no upstream — nothing to pull. It exists only on this machine."
fi

SYNC=$("$(dirname "$0")/sync-check.sh" 2>&1 | sed $'s/\033\\[[0-9;]*m//g')
REPORT="${REPORT}${SYNC}"

printf '%s' "$REPORT" | jq -Rs '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: ("Session-start sync (automatic). Read this before planning any work — "
      + "two machines share this project, and work that looks unbuilt may already be shipped "
      + "on another branch.\n\n" + .)
  }
}'
