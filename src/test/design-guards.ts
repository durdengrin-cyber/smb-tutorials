// One definition of what "unstyled literal" means, shared by both surface
// guards.
//
// It exists because the two guards drifted. app-surface.test.ts was hardened
// into an exclusion list with gradient prefixes, the full colour family list
// and a raw-hex check; marketing.test.ts kept the original narrow regex —
// three prefixes, six families, no hex. app-surface.test.ts then EXCLUDES
// (marketing) and delegates to it, so the weaker guard was the only thing
// watching /tutor-signup, a product surface that happens to sit in the
// marketing route group. It let through the demo's teal gradient and six
// lines of literal blue, and both guards stayed green.
//
// Anything imported from here is enforced identically on both surfaces. A
// surface that needs an exception names the file in its own ALLOW set, where
// the omission is a decision on the record rather than a hole in a regex.

import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Literal Tailwind colour utilities. Gradient stops (`from`/`via`/`to`) are
 * in the prefix list deliberately: `from-teal-50 via-cyan-50 to-blue-50`
 * carries exactly as much demo palette as `bg-teal-50`, and omitting those
 * three prefixes is what hid the tutor-signup page's background for the whole
 * visual identity cycle.
 *
 * white/black get their own branch because they carry no numeric shade —
 * folding them into the group above would demand the \d{2,3} they never have
 * and silently match nothing.
 */
export const LITERAL_COLOR =
  /\b(bg|text|border|ring|from|to|via|fill|stroke|decoration|outline|shadow|accent|caret|divide|placeholder)-(gray|slate|teal|zinc|cyan|neutral|emerald|red|amber|green|blue|indigo|purple|orange|yellow|rose|stone|sky|violet|fuchsia|pink|lime)-\d{2,3}\b|\b(bg|text|border|ring|from|to|via|fill|stroke|decoration|outline|placeholder)-(white|black)\b/;

/**
 * Raw hex colours in any attribute or property. find/page.tsx carried
 * stroke="#14B8A6" — teal-500 — through six repaint tasks because a class
 * regex cannot see an SVG attribute.
 *
 * Exactly 3, 6 or 8 hex digits at a trailing word boundary, so `#fff`,
 * `#14B8A6` and `#00000080` match while `url(#grid)` does not.
 */
export const RAW_HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/;

/** Emoji as iconography. Replaced by structure and mono labels. */
export const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/**
 * Invisible characters — zero-width joiner, variation selectors, zero-width
 * space, word joiner, BOM.
 *
 * These are banned outright rather than only when orphaned, and that is
 * sound precisely BECAUSE emoji are banned above: on a surface with no emoji,
 * a joiner has nothing to join, so every one is the residue of an emoji that
 * lost its other codepoints. tutor-signup/page.tsx shipped
 * `<div className="text-6xl mb-4">‍</div>` — a bare ZWJ, all that
 * survived of a multi-part emoji — which rendered as roughly sixty pixels of
 * blank space above the heading. The emoji guard could not see it: a joiner
 * is not itself in any emoji range.
 *
 * A scan of every .ts/.tsx file in src on 2026-09-09 found exactly one such
 * character, the one described above, so this rule costs nothing today.
 */
export const INVISIBLE_CHAR = /[​‌‍⁠︎️﻿]/;

/** Human-readable names, so a failure says WHICH invisible character. */
export const INVISIBLE_CHAR_NAMES: Record<string, string> = {
  "​": "ZERO WIDTH SPACE (U+200B)",
  "‌": "ZERO WIDTH NON-JOINER (U+200C)",
  "‍": "ZERO WIDTH JOINER (U+200D)",
  "⁠": "WORD JOINER (U+2060)",
  "︎": "VARIATION SELECTOR-15 (U+FE0E)",
  "️": "VARIATION SELECTOR-16 (U+FE0F)",
  "﻿": "ZERO WIDTH NO-BREAK SPACE / BOM (U+FEFF)",
};

/**
 * Names the offender and its line, because an invisible character is exactly
 * the thing a developer cannot find by eye from a filename alone.
 */
export function describeInvisible(source: string): string | null {
  const m = INVISIBLE_CHAR.exec(source);
  if (!m) return null;
  const line = source.slice(0, m.index).split("\n").length;
  const name = INVISIBLE_CHAR_NAMES[m[0]] ?? `U+${m[0].codePointAt(0)!.toString(16).toUpperCase()}`;
  return `line ${line}: ${name}`;
}

export interface WalkOptions {
  /** Directory prefixes to skip, as path segments (e.g. "src/app/(marketing)"). */
  exclude?: string[];
  /** File extensions to collect. Defaults to .ts and .tsx. */
  extensions?: string[];
  /** Skip *.test.* files. Defaults to true. */
  skipTests?: boolean;
}

/**
 * Collects source files under `dir`. Both extensions by default, not just
 * .tsx: a className map in a .ts file carries just as real a literal, and an
 * inclusion list that only walked .tsx would be unable to see it.
 */
export function collectFiles(dir: string, options: WalkOptions = {}): string[] {
  const {
    exclude = [],
    extensions = [".ts", ".tsx"],
    skipTests = true,
  } = options;

  const isExcluded = (p: string) =>
    exclude.some((ex) => p === ex || p.startsWith(ex + "/"));

  const out: string[] = [];
  (function walk(d: string) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (isExcluded(p)) continue;
      if (entry.isDirectory()) {
        walk(p);
      } else if (
        extensions.some((e) => entry.name.endsWith(e)) &&
        !(skipTests && entry.name.includes(".test."))
      ) {
        out.push(p);
      }
    }
  })(dir);
  return out;
}
