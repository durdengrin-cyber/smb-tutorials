import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// This guard is src-wide on purpose, and so it lives at the root of src
// rather than beside either surface guard. A no-op hover is not a property
// of the marketing surface or the app surface — it is a property of a
// className, and it arrived on both. app-surface.test.ts excludes
// (marketing) and marketing.test.ts only walks it, so a rule split across
// those two files would have to be written twice and could drift once.
const files: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (
      (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) &&
      !e.name.includes(".test.")
    )
      files.push(p);
  }
})("src");

describe("hover states", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  // `text-primary hover:text-primary` reached 16 sites across two route
  // groups. It renders as a link with no hover feedback at all: the hover
  // class sets the colour the element already has, so the pointer changes
  // and nothing else does. Nine of the sixteen carried no underline either,
  // so they had no affordance in any state.
  //
  // Generalised past that one pairing deliberately. The same mistake in
  // bg-, border- or ring- is the identical bug and would not have been
  // caught by a rule naming text-primary; per CLAUDE.md a fix strengthens
  // the infrastructure rather than closing the one instance we happened to
  // find. The backreference means the pair must be the SAME utility and the
  // SAME value — `text-primary hover:text-accent` is a real hover and
  // passes.
  //
  // The lookbehind stops the match starting at the `text-primary` inside
  // `hover:text-primary` itself, which is what makes a lone
  // `hover:text-primary` (a real hover, on a muted base — the footer links)
  // legal. The trailing (?![\w\-/]) stops `text-primary-foreground` from
  // matching as `text-primary`.
  it("never restates a colour the element already has", () => {
    const noOp =
      /(?<!hover:)\b(text|bg|border|ring|decoration)-([a-z][a-z0-9-]*?)(?![\w\-/])[^"'`]*hover:\1-\2(?![\w\-/])/;
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(noOp);
    }
  });
});
