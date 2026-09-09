---
name: env-local-is-tylers-to-edit
description: Never write to .env.local — Tyler manages it himself; propose changes instead
metadata:
  type: feedback
---

Do not modify `~/smb-tutorials/.env.local`. Tyler owns that file. Reading it
is fine and necessary (the probe scripts parse it at runtime), but never
write, append or rewrite it — tell him what to add and let him do it.

**Why:** stated 2026-08-27 — "Env is untouchable from here on." Key rotation
is tedious work he does not want forced on him, and a stray edit to a secrets
file can invalidate credentials or clobber an editor buffer he has open.

**How to apply:** propose the exact lines and let him paste them. If a
verification genuinely needs to know whether a var is set, check presence
only and never print values — see [[never-print-secrets-to-terminal]].
