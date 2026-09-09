---
name: open-a-file-means-open-it
description: "Open the file" means launch it in an editor, not print its contents to the terminal
metadata:
  type: feedback
---

When Tyler says "open the file" / "open X", he means **open it in an editor**
(macOS `open <path>`), not `cat`/`tail` it into the terminal.

**Why:** stated directly on 2026-08-27, right after displaying `.env.local`
leaked `SUPABASE_SERVICE_ROLE_KEY` into the conversation transcript — a
credential that bypasses every RLS policy and had to be rotated. Printing a
file also puts it in the transcript forever; opening it does not.

**How to apply:** run `open <path>` (or the editor) and say it's open. Only
print contents when he actually asks to *see*, *read*, *show* or *review*
them — and even then, mask secret values in anything env-like unless he asks
for them verbatim. See [[never-print-secrets-to-terminal]].
