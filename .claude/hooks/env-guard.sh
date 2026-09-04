#!/usr/bin/env bash
# Deny any Bash command that names a dotenv file.
#
# Why this exists: .env.local holds the service-role key, the Razorpay secret,
# the VAPID private key and the Sentry auth token. Any command that prints the
# file — cat, head, grep, sed, source — puts those values into the session
# transcript, where they are stored and re-read on every later turn. Gitignore
# does not help: the leak is the transcript, not the repo.
#
# Scripts that READ the file at runtime are unaffected, because the guard
# inspects the command STRING. `node scripts/probe-availability.mjs` never
# names the file, so it runs normally and reads .env.local itself.
#
# This is a guard rail, not a security boundary. A determined path around it
# exists (a script that prints values, an unusual spelling). It removes the
# ACCIDENTAL leak, which is the realistic one.
cmd=$(jq -r '.tool_input.command // ""')
if printf '%s' "$cmd" | grep -qE '(^|[^A-Za-z0-9_./-])\.?env(\.[A-Za-z0-9_-]+)*\.local|(^|[[:space:]/"'"'"'])\.env([./A-Za-z0-9_-]*)'; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: this command names a dotenv file, and its values would land in the transcript. To read variable NAMES, run a script that masks values. To read a VALUE, ask the user to check it themselves."}}'
fi
exit 0
