import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { contrastRatio } from "@/lib/contrast";

const css = readFileSync("src/app/globals.css", "utf8");

// A test rather than a lint rule, because what is worth preventing is
// specific: the demo's palette creeping back into the TOKENS while plans 2
// and 3 are still in flight and page-level hardcoded colours are legitimately
// everywhere. A blanket lint rule would fire on those and get switched off.
describe("the token system", () => {
  it("has no trace of the demo palette", () => {
    expect(css).not.toMatch(/0f766e/i);
  });

  it("has no trace of Geist", () => {
    expect(css).not.toMatch(/geist/i);
  });

  // A token defined in one theme and missing from the other renders that
  // theme's text on the other theme's ground — the classic unreadable-page
  // bug, invisible until somebody flips the switch.
  it("defines the same tokens in both themes", () => {
    const names = (block: string) =>
      new Set(
        (block.match(/--[a-z0-9-]+(?=:)/g) ?? []).filter(
          (n) => !n.startsWith("--color")
        )
      );
    const root = css.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const dark = css.match(/\.dark \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(root.length).toBeGreaterThan(0);
    expect(dark.length).toBeGreaterThan(0);
    expect([...names(root)].sort()).toEqual([...names(dark)].sort());
  });

  // The brand accent belongs on --primary. shadcn's --accent is a subtle hover
  // surface; putting gold there turns every hover state gold and leaves the
  // buttons grey. Pin it so a later edit cannot quietly swap them.
  it("keeps the brand accent on --primary, not --accent", () => {
    const root = css.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(root).toMatch(/--primary:\s*#8f5f2b/);
    expect(root).not.toMatch(/--accent:\s*#8f5f2b/);
  });
});

// Parses one theme block into { tokenName: hex }. Only hex values — the radius
// and font tokens are not colours and must not reach contrastRatio.
function palette(selector: string): Record<string, string> {
  const block = css.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

// Status colour is the one place where "it looks fine to me" is worth least:
// these are the pills a teacher reads at a glance to know whether students can
// see them. AA against BOTH the page ground and a card, because the pills
// appear on both. Tested against the strong colour rather than the /12 tint —
// the tint composites toward the ground, so this is the conservative check.
describe("status colour is legible in both themes", () => {
  const themes: Record<string, Record<string, string>> = {
    light: palette(":root"),
    dark: palette("\\.dark"),
  };

  for (const [theme, t] of Object.entries(themes)) {
    for (const key of ["success", "primary", "destructive"]) {
      it(`${theme}: --${key} meets AA on the ground and on a card`, () => {
        expect(t[key], `--${key} missing from ${theme}`).toBeTruthy();
        expect(contrastRatio(t[key], t.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t[key], t.card)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
