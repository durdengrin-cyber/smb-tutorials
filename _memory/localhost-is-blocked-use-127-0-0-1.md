---
name: localhost-is-blocked-use-127-0-0-1
description: The Chrome extension refuses http://localhost:3000 but allows http://127.0.0.1:3000 — the same dev server, a different host string.
metadata:
  type: project
---

**`http://localhost:3000` returns "Navigation to this domain is not allowed" from the Claude
Chrome extension. `http://127.0.0.1:3000` loads the same dev server fine.** The extension gates
by site permission and treats the two as different origins; only the loopback IP is granted.

Found 2026-09-11 after concluding the dev server was simply unreachable and telling the owner the
only options were to grant a permission or sign in on production. Neither was necessary.

**How to apply:**
- Reach for `127.0.0.1:3000`, not `localhost:3000`, whenever driving the dev server in the
  browser. If it is ever blocked too, that is the point to ask for a site permission.
- **They are different origins to the browser, not just to the extension.** A session cookie set
  on `smb-tutorials.vercel.app` — or on `localhost` — does not exist on `127.0.0.1`. Anything
  auth-gated still needs a sign-in on that exact origin, and the agent cannot type passwords.
- For an auth-gated component, a **throwaway preview route** rendering it against fixtures beats
  arranging a session: make it, screenshot it, delete it in the same turn. That is what caught
  two of the three card defects in [[browser-testing-finds-what-reading-cannot]].
- Gotcha when doing that: a `page.tsx` is a Server Component, so passing `onStart={() => {}}` to
  a `"use client"` component renders a blank white page with no error in the terminal. Add
  `"use client"` to the preview page.
