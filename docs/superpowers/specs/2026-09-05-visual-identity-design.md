# Visual Identity — Design

**Brainstormed and approved in conversation 2026-09-05.**

Finishes what redesign cycle 1 started. Cycle 1 built the **component layer** — 13 shadcn
components and a token file — and shipped it to the product surface. It never chose a **visual
identity**; it inherited one. This spec chooses one.

---

## 1. Why this exists

The look is leftover from a demo. Stated by the project owner: *"we have taken over this from
the demo I created but that was a temporary play."* The evidence agrees:

- **The palette is shadcn's default.** `--primary: #0f766e` (teal-700) was swapped in; every
  other token — secondary, muted, accent — is stock neutral `oklch` grey.
- **The font is Geist**, Next.js's default. Not chosen.
- **There is no logo.** `public/` holds `next.svg`, `vercel.svg`, `globe.svg`, `window.svg` —
  Next's stock files. The header mark is a gradient square with "SMB" typed into it.
- **Feature icons are emoji** (📚 ⚡ 👨‍🏫 💼).
- **The imagery is hotlinked Unsplash stock** — "Happy students learning", "Students learning
  together", "Tutor teaching students" — loaded live from `images.unsplash.com` on every view.
- **The name is spelled five ways**: `SMB Tutorial`, `SMB Tutorials`, `smb-tutorials`,
  `smbtutorial`, `smbtutorials`. Two of them appear on the published `/privacy` and `/terms`.

The marketing surface never received cycle 1's system at all: `/` carries 42 hardcoded colour
references, `/terms` 40, `/privacy` 37 (created 2026-09-05, born in the old language), against
2–4 on the product screens.

## 2. The name is settled and is not in scope

**SMB stands for Syedna Mohammed Burhanuddin.** The project is named in his honour; he is
remembered for his emphasis on education. **The name does not change.** Read cold it resembles
the enterprise abbreviation for "small and medium business" — it is not, and an argument for
renaming on that basis has already been made once in this project and was wrong. See `CLAUDE.md`.

**Decided: the dedication becomes public, but placed.** It goes on an About page and as one line
in the footer. **Not in the hero, and not in the signup flow** — a parent's first need is *my
child is stuck and someone can help*; the dedication is why the product exists, not what they
are buying.

**Worded around the value he championed, not around religious authority.** Framed as education
being worth giving to every child, it reads to any parent as conviction. Framed as authority, it
becomes a membership marker and narrows the audience the moment the product widens beyond the
community. **The owner writes this copy**; it is the one piece of text on the site that should be
in their words.

**Spelling: `SMB Tutorials`** everywhere — plural, matching the manifest. The visible wordmark
shortens to **SMB** in the nav, which is where the name actually lives.

## 3. Who the surfaces speak to

Established by working out who searches for a 60-minute lesson at an hourly rate. That is a
**considered purchase**, not an impulse: no child spends ₹500 of a parent's money unasked. But
the *moment of need* is the child's — stuck at 9pm, exam Thursday.

**The product is student-triggered, parent-decided, student-consumed.**

- **The marketing surface addresses the parent, about the child's moment.** Only the parent can
  complete the action the page asks for — they hold the account, give consent, and pay
  (shipped 2026-09-05). A student-voiced homepage leading into a signup form that asks for
  "Your Full Name (parent or guardian)" is a bait-and-switch at exactly the moment trust matters.
- **The app serves the child.**

**Go-to-market: community first for the pilot, then widen.** This changes the homepage's job.
Pilot families arrive by referral — WhatsApp, a parent who already vouched — so the page is not
doing cold acquisition. It **confirms** a decision already half-made: this is legitimate, here is
how it works, here is how to start. Trust confirmed, not constructed.

**The site carries no community signifiers.** The dedication is public; the visual language is
broadly Indian and secular, so nothing needs undoing when the audience widens.

## 4. The promise

**A qualified teacher, live and one to one, within a minute of asking.** Immediacy plus a real
human. Everything in the identity serves that.

Not "structured tutoring programmes" — that is the scheduled tier, which is deferred and would
over-promise.

## 5. The visual system

Chosen by presenting three directions and synthesising two of them. The owner kept direction C's
typography and structure and direction A/B's warmer palette: *"totally the font and style of in a
minute is right, just the colour palette needs a bit of one to one."*

### 5.1 One identity, two themes

**Both themes are first class.** Not a marketing-dark / app-light split — the same identity in
two grounds, **following the device's `prefers-color-scheme` with a manual toggle to override**.

**Not time-of-day switching.** A page changing under someone mid-read is jarring and guesses
wrong constantly — a parent in a bright kitchen at 9pm wants light. The device already knows the
preference; let it answer.

**Consequence, and it is the load-bearing one: the brand cannot live in the ground.** A
light-preference visitor must still meet the identity. It therefore lives in the **type, the hue
and the layout**, which is why the two palettes share hues and differ only in ground.

### 5.2 Tokens

| Token | Dark | Light |
|---|---|---|
| `ground` | `#231a28` | `#f6f2ee` |
| `raised` | `#2b2031` | `#ffffff` |
| `text` | `#f1ebe8` | `#2e1f33` |
| `muted` | `#a293a8` | `#6f5c75` |
| `accent` | `#d9a05b` | `#8f5f2b` |
| `on-accent` | `#231a28` | `#fbf8f5` |
| `rule` | `#3a2f40` | `#e3d9dd` |
| `hair` | `#322739` | `#ece4e6` |

The accent shifts between themes deliberately: gold on dark, darkened to bronze on light so it
survives as a link colour against a pale ground. **Same hue, two jobs.**

### 5.3 Type

- **Display and UI: Archivo.** Used at **900**, tracked tight (`-.04em` to `-.05em`), line-height
  below 1. The headline is the identity.
- **Labels, status, data: IBM Plex Mono**, 11px, letter-spaced `.06em`–`.1em`, uppercase.
- Body: Archivo 400/500/600.
- **Geist is retired.**

Mono is not decoration: it marks the parts of the page that are *live or factual* — the online
count, step numbers, rates, timers — against Archivo's editorial voice.

### 5.4 Layout

Left-aligned, ruled, dense but not cramped. Hairline rules and 1px grid gaps rather than cards
with shadows. Structure carries meaning: numbered steps only where there is a real sequence.

**No emoji anywhere.** Replaced by structure and mono labels, not by an icon set — nothing to
commission, nothing to maintain.

## 6. Imagery

**Decided: no photographs of children. Not stock, not real.** Real ones need consent that should
not be collected for marketing; stock ones place children who are not your students beside "we
verify every teacher's ID before they meet your child", and undercut the honesty the rest of the
page is built on. **The three hotlinked Unsplash photos are removed.**

**The primary imagery is the product itself.** Screenshots of the online-now list, the accept
moment, the call. For a product whose differentiator is *see who is available this second*, the
screen showing that is the most persuasive image available — and the one thing a competitor
cannot fake. Production cost is zero; it needs staging with placeholder teacher data.

Optional texture: context, never faces — a desk at night, a phone beside a textbook. Nice to
have, not load-bearing.

## 7. The share card — highest leverage asset on this project

**There is no `openGraph` metadata at all today.** `src/app/layout.tsx` sets `title`,
`description`, `manifest` and `appleWebApp`, and nothing else. A forwarded link renders bare.

Given that distribution is WhatsApp referral, **more people see the share card than ever see the
homepage** — everyone in the group sees it, only some tap. It is the real first impression.

- **1200×630, designed to survive at 250px wide.** WhatsApp renders it small. Three elements
  only: the headline, the live teacher count, the wordmark.
- **The count must be generated live, not baked into a static image.** A card claiming
  "14 teachers online" at 3am is a lie, and the count is the one claim on it that cannot be
  copied. Next's `opengraph-image` route can render it per request.
- **⚠ The domain is unsettled.** The card shows `smbtutorials.com`; the support address uses
  `smbtutorial.com`, singular. **Neither is confirmed as owned.** This blocks the card, and it
  is the one part of the name a parent actually types.

## 8. Assets owed

| Asset | State |
|---|---|
| `opengraph-image` | Does not exist. §7 |
| `apple-touch-icon` | Does not exist. Owed since the iPhone walk |
| App icons (192/512/maskable) | Placeholders from `6694ca7` |
| Wordmark | **Open** — "SMB" in Archivo 900 may already be sufficient; a drawn mark is undecided |
| Product screenshots | To be staged |
| Domain | **Open and blocking §7** |

## 9. Scope

**In:** the token system and both themes; `next-themes` wired up with a toggle; the marketing
surface (`/`, `/privacy`, `/terms`, `/signup`, `/tutor-signup`, `/signin`); the new About page
carrying the dedication; the app surface re-themed onto the new tokens; the share card;
removal of the Unsplash images and all emoji; one consistent spelling.

**Sequenced into three plans.** This is too large for one, and the order is a dependency chain,
not a preference:

1. **The system.** Tokens (§5.2), `ThemeProvider` mounted, `suppressHydrationWarning`, the
   toggle, `.dark` replaced, Archivo and IBM Plex Mono in, Geist out. Nothing visibly changes
   except colour and type — but every later task builds on it, and it is the only plan that can
   break every screen at once, so it ships and gets verified alone.
2. **The marketing surface.** `/`, `/signup`, `/tutor-signup`, `/signin`, `/privacy`, `/terms`,
   plus the new About page. Unsplash images out, emoji out, product screenshots in, one spelling
   throughout. This is where the identity becomes visible.
3. **The app surface and the share card.** Re-theming the product screens, `opengraph-image`,
   `apple-touch-icon` and real app icons.

**Plan 2 is where the value lands, but plan 1 must ship first** — repainting pages against tokens
that do not exist yet means doing it twice.

**Out:**
- **A drawn logo mark**, until §8's question is answered.
- **Re-laying-out the app screens.** They move to the new tokens and themes; their information
  architecture is cycle 1's and is not reopened.
- **The dedication copy**, which the owner writes.
- Anything touching the `micro-doubt` tier (`project_state.md`), which is a separate cycle.

## 10. Migration from the current system

The plumbing largely exists and was never switched on:

- `next-themes` is **already a dependency**. `sonner.tsx` already calls `useTheme()`. **There is
  no `ThemeProvider` mounted**, so `.dark` is never applied and all of it sits inert.
- `globals.css` already has `@custom-variant dark (&:is(.dark *))` and a `.dark` block of **34
  lines** — but they are shadcn's stock inverted greys, not a designed palette. §5.2 replaces them.
- `<html>` needs `suppressHydrationWarning` for `next-themes` to avoid a hydration mismatch.

So this is **activating and repainting**, not rebuilding. The 13 shadcn components stay; they
read from tokens and will follow.

## 11. Decisions, and what each costs if wrong

| Decision | If wrong |
|---|---|
| Both themes first class, OS-driven | Every screen needs checking twice. Bought deliberately: the alternative is an identity half the visitors never see |
| Brand lives in type and hue, not ground | Weaker single-look impact than a committed dark page |
| Dedication public but placed | A visitor who wanted the story has to reach the footer. Reversible copy change |
| No photographs of children | Less warmth than the category standard. Deliberate — the category standard is dishonest here |
| Product screenshots as primary imagery | They date as the UI changes, and must be restaged. Cheap to redo |
| Archivo 900 as the voice | Assertive. On a worried parent it may read blunt — mitigated by the warm ground, which is why the palette was swapped |
| "Your child is stuck", blunt | Lands harder; less kind to an anxious reader. Owner's explicit call |
| Marketing surface repainted before the app | A brief seam for anyone crossing mid-rollout |

## 12. Open, and blocking parts of the work

1. **The domain.** Blocks §7 entirely.
2. **The wordmark** — is Archivo 900 "SMB" enough, or is a drawn mark wanted? Blocks §8's icons,
   since the icons should carry the mark.
3. **The dedication copy.** Owner's to write; blocks the About page and the footer line.
4. **Mobile hero.** The hero is two-column with the screenshot beside the copy; on a phone the
   screenshot drops below. Most traffic arrives from a WhatsApp tap on mobile, so this needs
   checking on a real handset before it is settled.

## 13. Reference

Both mockups are live artifacts, kept as the visual source of truth until this ships:

- **Direction pitch** (three initial directions, then the synthesis on two grounds) —
  `https://claude.ai/code/artifact/05842e43-bc94-4bad-aec0-80939265d72d`
- **Full homepage, both themes, share card and product screens** —
  `https://claude.ai/code/artifact/8291fceb-9225-4727-99e1-8b07b5fad483`
