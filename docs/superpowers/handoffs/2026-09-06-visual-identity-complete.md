# Handoff — the visual identity cycle, 2026-09-06

State at the close of the 2026-09-05/06 session. Read this before touching anything.

---

## 1. Where the work is

**Branch `feat/visual-identity-tokens` — 48 commits ahead of `main`, pushed, tree clean.**
**Nothing is merged. Nothing is in production.** `main` holds only the plan-1 document, so
`smb-tutorials.vercel.app` still shows the demo's teal, still hotlinks Unsplash, and still 404s
`/about`.

**Verified by running them, not inherited:**

| Check | Result |
|---|---|
| `npx vitest run` | **344 passed / 3 skipped** |
| `npx tsc --noEmit` | 0 |
| `npx eslint .` | 0 |
| `npm run build` | 0 |

Preview alias — stable across pushes, and the thing to open on a handset:

```
https://smb-tutorials-git-feat-visual-5af6e1-durdengrin-6266s-projects.vercel.app
```

Database probes were deliberately **not** run: `git diff --name-only main..HEAD` shows no
`supabase/` and no `scripts/` changes. The whole cycle is frontend.

## 2. What shipped to the branch

All three planned cycles, plus a fourth task the plan had missed and a wave of fixes.

- **Plan 1 — the token system** (`plans/2026-09-05-visual-identity-system.md`). Archivo + IBM Plex
  Mono replace Geist; the §5.2 palette replaces shadcn's stock greys and the demo teal;
  `next-themes` actually mounted (it had been a dependency shipping inert, so `.dark` never
  applied); a theme toggle in both headers.
- **Plan 2 — the marketing surface** (`plans/2026-09-05-visual-identity-marketing.md`). The
  scroll-driven hero, every marketing page onto tokens, one spelling, a footer and `/about`.
- **Plan 3 — the app surface** (`plans/2026-09-05-visual-identity-app-surface.md`). 7 tasks
  planned, **8 executed**, subagent-driven with a review gate per task. Every product screen onto
  tokens, one new semantic token, the responsive padding remainder, and a guard test.

**Every "Done when" target is at zero**: literal colour classes on the product surface, emoji
outside `(marketing)`, guard `PENDING` entries, raw hex in the guarded set.

## 3. The five things worth knowing, because none are visible in a diff

1. **The plan missed an entire route group.** `src/app/(fullscreen)` — `/call`, where the lesson
   actually happens — was never in the File Structure table and was not walked by the guard: 19
   literals and an emoji. Root cause: the audit ran over a directory set that was *assumed* rather
   than enumerated. `ls -d src/app/*/` would have caught it in one command. Closed as Task 8.

2. **The structural answer to that is the guard inversion.** `src/app/app-surface.test.ts` was an
   *inclusion* list — three named route groups plus two hand-named components. It now walks
   `src/app` and `src/components` wholesale, `.ts` as well as `.tsx`, excluding `(marketing)` (own
   guard) and tests, with a narrow per-check `ALLOW` for `ui/dialog.tsx`'s overlay scrim and
   `google-button.tsx`'s Google brand hexes. **Coverage went from ~15 files to ~70.** A new route
   group is now guarded on creation.

3. **A wrong premise in the contrast test, written into the plan.** It asserted solid token values
   and claimed a 12% tint *"composites toward the ground, so this is the conservative check."*
   Backwards — a tint moves the ground **toward the text**, so contrast always falls.
   `text-primary` on `bg-primary/12` measured **4.20** over `--background` and **3.91** over
   `--muted`, both under AA. Fixed per-site; `theme.test.ts` now asserts the **composited** case.

4. **`--primary` in light has almost no headroom: 4.91 solid against 4.5.** That is why the tint
   failed. Do not add another `bg-primary/12 text-primary` pairing on a plain background without
   checking it. The hex `#8f5f2b` is the spec's §5.2 palette and changing it is an identity
   decision, not an engineering one.

5. **The hero broke three times on the same fault: the breakpoint was declared twice**, once in
   Tailwind classes and once in a `matchMedia` string, and they drifted. It is now declared **not
   at all** — the hero is gated on the motion preference alone, at every width — and a test fails
   if a width media query or a hardcoded breakpoint reappears in that file.

## 4. Design decisions taken, and what each costs if wrong

| Decision | Cost if wrong |
|---|---|
| **Only `--success` was added, no `--warning`.** The brand accent IS gold, so an amber warning token would be the same swatch as the identity in dark theme. "In a session" therefore takes `--primary` — engagement, not alarm | A status pill reads as a brand element. One file |
| **`--stage`, identical in both themes**, for the video call backdrop — a stage should not go pale in light mode | `/call` looks heavy in light theme |
| **No `--stage-foreground`.** A reviewer wanted one; nothing would consume it, so the constraint is documented beside the token instead | A future element on the stage repeats the trap the comment warns about |
| **The signed-in logo goes to `/`**, not the `/home` resolver | None found; `MarketingHeader` already offers "Go to your dashboard" back |
| **The phone gets the pinned hero too**, against spec §5.4's "miserable on a small screen" | Phone visitors get a longer hero. Revertible by restoring the width gate — but see §3.5 first |
| **`border-hair` = edge or divider of an *elevated* surface; `border-border` = outline of a shadowless one** | A cosmetic inconsistency survives. Audited 13/13 sites; it holds |

## 5. 🛑 Verification only a human can do — this is the top of the next session

Nobody has opened any of this on a real handset. Spec §5.6 makes it the owner's, and it is the one
thing standing between here and a merge decision.

On the preview alias, **in both themes**:

1. **The phone hero.** It now pins and cross-fades like the desktop. Three unknowns: does the
   pinned frame fit without clipping the copy above it (tightest on a small phone like an SE); is
   42vh of scroll per stop the right pace; and does the address bar stay steady while scrolling
   (`100dvh` should hold it, but only a handset proves that).
2. **`/find` at 360px** — the specific §5.6 finding, two columns for the subject grid.
3. **`/dashboard`** — does "In a session" read as a status or as a button? That is the §4 decision
   most worth overturning if it is wrong.
4. **`/privacy` and `/terms`** — the name, and the two domains below.

## 6. Open, and what each blocks

**Settling the domain unblocks three of these at once.**

| Item | Blocks |
|---|---|
| **The domain.** `/privacy`, `/terms` and the footer say `support@smbtutorial.com` (singular); the hero's chrome says `smbtutorials.com` (plural). Neither is confirmed owned | The share card (spec §7 — the highest-leverage asset, since distribution is WhatsApp referral), the support address, and the email sender |
| **No password reset exists.** No route, no `resetPasswordForEmail` call anywhere. A guardian who forgets is locked out of a paid service | Pilot. Its real dependency is an email sender, so it belongs in the same pass as the domain |
| **The wordmark.** Is Archivo 900 "SMB" enough, or is a drawn mark wanted? | `apple-touch-icon` and the real app icons, owed since the iPhone walk |
| **The dedication copy.** Owner's to write | `/about`, which ships nearly empty on purpose |

**Plan 4 is not written.** It is the assets-only plan — share card, `apple-touch-icon`, real app
icons — and it starts the moment the domain or the wordmark lands.

## 7. Carried forward, not blocking

- ~~`text-primary hover:text-primary` is a **no-op hover** at 16 sites, 14 of them pre-existing in
  `(marketing)`. Every one carries `underline`, so no affordance is lost. Sweep separately.~~
  **CLOSED 2026-09-06** (`fix(design): seventeen hovers…`). Two things in that entry were wrong,
  and both are the reason it was filed as harmless rather than fixed. It was **17** sites, not 16
  — the extra is `subject-picker.tsx`'s `border-border hover:border-border`, which no
  `text-primary` search could reach. And "every one carries `underline`" was true of **7 of 16**;
  the other nine carried a font-weight and nothing else, so they had **no affordance in any
  state**, including the support address in `/privacy`'s body copy. The lesson is the same one
  §3.1 records about the missed route group: the entry described a set that was assumed from the
  first few examples rather than enumerated. Guarded now, generally, by
  `src/hover-affordance.test.ts`.
- The guard's loop throws on the **first** offending file, so a run names one at a time. Costs a
  re-run, never a miss.
- **`rgb()`, `oklch()` and named colours still escape the raw-hex guard.** Nothing uses those forms
  today and a detector risks false positives on legitimate code — deferred deliberately. It is the
  direct sibling of the `#14B8A6` escape that Task 7 fixed.
- The dedication paragraph was **pulled from the footer on purpose** (2026-09-05). What stood there
  was ours, not the owner's. `marketing-footer.tsx` says so. **Do not re-add it from the spec.**

## 8. The decision waiting

**Merge and ship plans 1–3, or hold.** Spec §11's "brief seam" argument is gone — the marketing
surface and the app surface are both repainted, so there is nothing half-done left to ship. What
remains before merging is §5: the handset pass.

If it merges: push to `main` deploys production. Verify **route-by-route against the live URL**,
not the Vercel dashboard — this project has shipped a "Ready" deployment that 404'd every path
(`vercel.json` carries `"framework": "nextjs"` to prevent that; do not let anyone tidy it away).
