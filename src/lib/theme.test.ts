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
  // surface; putting the brand colour there turns every hover state teal and
  // leaves the buttons grey. Pin it so a later edit cannot quietly swap them.
  //
  // The value is teal as of 2026-09-14 and was bronze (#8f5f2b) before it.
  // Light and dark no longer share a hue, which is a decision and not drift —
  // globals.css records why beside the token.
  it("keeps the brand accent on --primary, not --accent", () => {
    const root = css.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(root).toMatch(/--primary:\s*#186a63/);
    expect(root).not.toMatch(/--accent:\s*#186a63/);
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
// NOT because that is the conservative check. It is the opposite: a
// translucent bg-token/12 tint moves the composited background TOWARD the
// token's own colour, so contrast against that same token can only fall
// versus the solid case, never rise. The dedicated composite describe block
// below covers that weaker case explicitly, because this one does not.
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

// --- alpha-composite helper -------------------------------------------
// Tailwind's bg-<token>/12 is a translucent fill: the browser paints it at
// 12% opacity over whatever is already there, so what a reader actually sees
// is not the token's hex but that hex blended into its parent surface. This
// mirrors the browser's own compositing (sRGB channels, not linear light —
// the same space Tailwind's opacity modifier blends in), so the result is
// the real on-screen colour, not an approximation of it.
function toRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function toHex(rgb: number[]): string {
  return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
function tintOver(tokenHex: string, surfaceHex: string, alpha = 0.12): string {
  const fg = toRgb(tokenHex);
  const bg = toRgb(surfaceHex);
  return toHex(fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]));
}

// The bug this exists to catch: text-<token> set on bg-<token>/12 reads fine
// by eye (same hue, "obviously" on-brand) while failing AA, because the tint
// eats into the very headroom the solid check above measured. --primary in
// light theme is exactly this case — 4.91 solid, 0.41 of headroom over the
// 4.5 floor, and the tint costs about 0.7, so it fails where success and
// destructive (more headroom) do not.
//
// Scoped to the token/surface pairings actually rendered as
// bg-<token>/12 + text-<token> in the product, not the full 3-token ×
// 3-surface cross product — some combinations legitimately don't occur:
//   - success/12 over --card: sessions/page.tsx's "Refunded" badge (inside
//     Card/CardContent, which does not override Card's own bg-card), and
//     status-pill.tsx's "available" tone (rendered inside a Card in
//     availability-toggle.tsx).
//   - primary/12 over --card: status-pill.tsx's "in_session" tone (same
//     Card).
//   - destructive/12 over --card: status-pill.tsx's "unreachable" tone
//     (same Card).
//   - destructive/12 over --background: incoming-request.tsx's error
//     banner. It renders `<Card className="... bg-destructive/12 ...">` —
//     bg-destructive/12 and Card's own bg-card are the same Tailwind utility
//     group, so cn()'s tailwind-merge keeps the later class and drops
//     bg-card entirely. What the tint actually composites over is whatever
//     is behind the Card in the DOM: the dashboard page's bg-background div.
// Not present anywhere in the app: any bg-<token>/12 + text-<token> pairing
// against --muted, and primary/12 + text-primary against --background —
// online-list.tsx has a bg-primary/12 banner on --background, but its text
// is text-foreground (fixed by this same commit), not text-primary, so it
// is not a token-against-its-own-tint pairing and is out of scope here.
// (Confirmed while diagnosing this: primary/12 over --background is 4.20
// and over --muted is 3.91 in light theme, both below 4.5 — the numbers
// that would have made this test fail had either pairing still existed.)
describe("the 12% tint still clears AA against its own token", () => {
  const themes: Record<string, Record<string, string>> = {
    light: palette(":root"),
    dark: palette("\\.dark"),
  };

  const used: Array<{ token: "success" | "primary" | "destructive"; surface: "card" | "background" }> = [
    { token: "success", surface: "card" },
    { token: "primary", surface: "card" },
    { token: "destructive", surface: "card" },
    { token: "destructive", surface: "background" },
  ];

  for (const [theme, t] of Object.entries(themes)) {
    for (const { token, surface } of used) {
      it(`${theme}: --${token}/12 over --${surface} clears 4.5 against --${token}`, () => {
        const composite = tintOver(t[token], t[surface]);
        expect(contrastRatio(t[token], composite)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
