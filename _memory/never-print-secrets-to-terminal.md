---
name: never-print-secrets-to-terminal
description: Never cat/tail a secrets file — printing it writes the credential into the transcript permanently
metadata:
  type: feedback
---

Never `cat`, `tail`, `head` or otherwise print a file holding credentials
(`.env.local`, key files). Terminal output goes into the conversation
transcript and cannot be taken back.

**Why:** on 2026-08-27 I said I'd keep values out of the transcript, then ran
`tail -28 .env.local` to show an appended block — and it printed
`SUPABASE_SERVICE_ROLE_KEY` with it. That key bypasses every RLS policy and
is what the payment webhook holds, so it had to be rotated. This repo had
already been burned once the same way by a test account's password.

**How to apply:** to show structure, mask the values (print key names plus a
prefix and length). To show an appended block, print only that block
(`tail -n <exact lines>` is not enough — anchor on the marker, e.g.
`sed -n '/^# ── marker/,$p'`). To let the user work on the file, open it —
see [[open-a-file-means-open-it]].
