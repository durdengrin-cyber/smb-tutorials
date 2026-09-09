#!/usr/bin/env bash
# One-time setup per machine: symlink Claude Code's project memory → repo _memory/
#
#   bash scripts/setup-memory.sh
#
# Why. Claude Code writes auto-memory to ~/.claude/projects/<key>/memory/, which is
# outside the repo and therefore per-machine. Two machines work on this project, so
# a fact learned on one was invisible to the other. Symlinking that directory into
# the repo puts memory under version control: Claude's ordinary auto-load and
# auto-write transparently hit files that git tracks.
#
# Adapted from the same mechanism in HL-Trader-Private, which has been running it
# across two machines.
#
# Safe to re-run. An existing real directory is backed up, never deleted.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MEMORY_TARGET="$REPO_DIR/_memory"

# Claude Code derives the project key by replacing every / in the absolute path
# with a dash.
PROJECT_KEY=$(echo "$REPO_DIR" | sed 's|/|-|g')
CLAUDE_MEMORY_DIR="$HOME/.claude/projects/$PROJECT_KEY/memory"

echo "Repo:        $REPO_DIR"
echo "Memory dir:  $MEMORY_TARGET"
echo "Claude link: $CLAUDE_MEMORY_DIR"
echo ""

mkdir -p "$MEMORY_TARGET"

# A real directory here holds this machine's existing memories. Move them into the
# repo rather than discarding them — on the second machine to run this, they are
# the memories that machine learned alone.
if [ -d "$CLAUDE_MEMORY_DIR" ] && [ ! -L "$CLAUDE_MEMORY_DIR" ]; then
  BACKUP="${CLAUDE_MEMORY_DIR}.bak.$(date +%Y%m%d%H%M%S)"
  echo "Existing memory found. Copying its files into the repo, then backing it up."
  # -n so a file already in the repo wins: the repo is the source of truth, and a
  # machine-local copy is by definition the staler one.
  cp -n "$CLAUDE_MEMORY_DIR"/*.md "$MEMORY_TARGET"/ 2>/dev/null || true
  mv "$CLAUDE_MEMORY_DIR" "$BACKUP"
  echo "  backup: $BACKUP"
fi

[ -L "$CLAUDE_MEMORY_DIR" ] && rm "$CLAUDE_MEMORY_DIR"

mkdir -p "$(dirname "$CLAUDE_MEMORY_DIR")"
ln -s "$MEMORY_TARGET" "$CLAUDE_MEMORY_DIR"

echo ""
echo "Done. $CLAUDE_MEMORY_DIR → $MEMORY_TARGET"
echo ""
echo "Memory is now version-controlled. Commit and push _memory/ at the end of a"
echo "session — that is what the other machine picks up."
