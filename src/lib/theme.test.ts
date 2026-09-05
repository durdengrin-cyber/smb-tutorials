import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

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
