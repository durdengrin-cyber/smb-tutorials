import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The whole product surface: everything under src/app and src/components,
// except (marketing) — which has its own guard, marketing.test.ts — and
// test files themselves. This used to be an INCLUSION list: three
// hand-named route groups under src/app, plus two hand-named files out of
// 27 in src/components. That is exactly the shape of bug that let the
// entire (fullscreen) route group render un-repainted through eight tasks —
// a file the list does not know about is invisible to it, silently, and
// stays that way until someone remembers to add it by name. An EXCLUSION
// list can still miss a file, but only by naming it in ALLOW below, where
// the omission is a decision on the record, not a blind spot.
const EXCLUDE_DIRS = [join("src", "app", "(marketing)")];

function isExcludedDir(path: string): boolean {
  return EXCLUDE_DIRS.some((ex) => path === ex || path.startsWith(ex + "/"));
}

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (isExcludedDir(p)) continue;
    if (entry.isDirectory()) {
      walk(p, out);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.")
    ) {
      // Both extensions, not just .tsx: a className map (like
      // status-pill.tsx's STATUS_COPY, if it lived in a .ts file instead)
      // carries just as real a token literal, and an inclusion list that
      // only walked .tsx would be unable to see it.
      out.push(p);
    }
  }
}

const files: string[] = [];
walk("src/app", files);
walk("src/components", files);

// Genuine exceptions, allowed by specific file AND specific check, with the
// reason on the record — never by loosening a regex to stop matching a
// whole class of thing. Each is scoped to only the check it is actually an
// exception to, so a dialog that starts using a stray literal-grey class
// elsewhere still fails the literal-colour check; it just isn't flagged
// again for the one line it's already accounted for.
const ALLOW_LITERAL_COLOR = new Set<string>([
  // The modal overlay scrim. A fixed black wash behind a dialog is correct
  // in both themes — it dims whatever was on screen, not a themed surface —
  // so there is no token this could instead read from.
  join("src", "components", "ui", "dialog.tsx"),
]);
const ALLOW_RAW_HEX = new Set<string>([
  // Google's own brand mark, reproduced at the exact colours Google's brand
  // guidelines specify. These must never be tokenised — a themed "G" logo
  // is a broken "Sign in with Google" button, not a themed one.
  join("src", "components", "google-button.tsx"),
]);

describe("the app surface", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  // Wider than the marketing guard: the dashboard expressed teacher status in
  // raw emerald/amber/red before --success existed.
  it("takes its colour from tokens, not literals", () => {
    // white/black carry no numeric shade (bg-white, not bg-white-50), so they
    // get their own branch rather than joining the shaded families above —
    // folding them into that group would require the \d{2,3} suffix they
    // never have, silently matching nothing.
    const literal =
      /\b(bg|text|border|ring|from|to|via)-(gray|slate|teal|zinc|cyan|neutral|emerald|red|amber|green|blue|indigo|purple|orange|yellow|rose|stone)-\d{2,3}\b|\b(bg|text|border|ring|from|to|via)-(white|black)\b/;
    for (const f of files) {
      if (ALLOW_LITERAL_COLOR.has(f)) continue;
      expect(readFileSync(f, "utf8"), f).not.toMatch(literal);
    }
  });

  it("uses no emoji as iconography", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(emoji);
    }
  });

  // find/page.tsx's background grid carried stroke="#14B8A6" — Tailwind's
  // teal-500, the demo palette this whole cycle exists to remove — through
  // six repaint tasks. It survived because it was a raw SVG attribute, not
  // a Tailwind class: the literal-class check above only matches
  // `bg|text|border|...-<shade>` tokens, and theme.test.ts only guards
  // globals.css. Neither could see a hex sitting in a stroke="" attribute.
  // This asserts no raw hex colour literal reaches the app surface at all,
  // regardless of what attribute or property carries it.
  it("carries no raw hex colour literals", () => {
    // Exactly 3, 6 or 8 hex digits at a trailing word boundary, so this
    // matches real colours (#fff, #14B8A6, #00000080) but not SVG fragment
    // references like fill="url(#grid)" (g is not a hex digit) or ids that
    // merely start with hex-looking text.
    const rawHex = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/;
    for (const f of files) {
      if (ALLOW_RAW_HEX.has(f)) continue;
      expect(readFileSync(f, "utf8"), f).not.toMatch(rawHex);
    }
  });
});
