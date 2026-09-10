---
name: supabase-site-url-and-preview-oauth
description: Google sign-in is broken on every Vercel preview because preview hostnames are not in Supabase's redirect allow-list; email+password is unaffected.
metadata:
  type: project
---

Diagnosed 2026-09-10. The owner reported that a Vercel preview showed the new design, but signing
in threw them to "the old landing page" and left them signed out.

**Supabase's Site URL is `https://smb-tutorials.vercel.app`** — the production deployment, which
tracks `main`. Preview hostnames are NOT in Authentication → URL Configuration → Redirect URLs.

So the OAuth return leg goes: Google → Supabase → Supabase finds the preview origin is not
allow-listed → **discards it and uses the Site URL instead**. The browser lands on production
(old code, hence "old landing page") and the `?code` never reaches the preview's `/auth/callback`,
so no session is ever created. Nothing in this repo is at fault: `signIn` redirects relatively and
`auth/callback` uses the request's own origin.

**The probe that settles it**, without needing a real token — `/auth/v1/verify` makes the
allow-list decision before reporting the bad token, so the `Location` header reveals it:

```
GET {SUPABASE_URL}/auth/v1/verify?token=bogus&type=signup&redirect_to=<origin>/auth/callback
   allow-listed -> Location is <origin>
   rejected     -> Location is the Site URL
```

Run it with `http://localhost:3000` (expect allow-listed) and a junk origin (expect rejected) as
controls, or the result means nothing. An earlier probe against `/auth/v1/authorize` was
INCONCLUSIVE — it echoes `redirect_to` into the Google URL regardless, including for
`evil.invalid`, because validation happens on the return leg.

**How to apply:**
- **Email + password on a preview works fine** — it never touches the allow-list. Use it for any
  preview testing until the wildcards are added.
- To fix previews, add to Redirect URLs (each deployment gets a fresh hostname, so wildcards, not
  one URL): `https://smb-tutorials-*-durdengrin-6266s-projects.vercel.app/**` and
  `https://smb-tutorials-git-*-durdengrin-6266s-projects.vercel.app/**`.
- **`smbtutorial.com` is NOT the app.** It is a parked domain serving a 114-byte redirect to
  `/lander`. The published legal pages name that domain, so it has to be pointed at the
  deployment before launch — and the Site URL and allow-list updated with it.
- Related: [[verify-the-stored-values-not-the-shape]] — the first probe here matched a shape and
  proved nothing; only the control-bearing one was evidence.
