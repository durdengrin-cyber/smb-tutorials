import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

// sharp is not in package.json on purpose. It arrives as next@16's own
// optional dependency — Next needs it for image optimisation and the lock
// pins both darwin binaries — and declaring it would force a re-lock that,
// on this machine's npm, drags in 66 lines of unrelated @tailwindcss/oxide
// churn. If Next ever drops it this import fails loudly at collection time,
// which is the right failure: add it to devDependencies then.

// The bug this exists to catch has already happened once, and nothing
// noticed for nine days. On 2026-09-05 the brand accent moved to bronze in
// globals.css. The icons and the manifest were left at the teal they had
// been since the PWA cycle, so the installed app icon and the browser
// chrome contradicted every button inside the app — on the home screen,
// where it is the first thing a student sees and the last place anyone
// thinks to look. Type checking cannot see it, lint cannot see it, and the
// 713 other tests cannot see it, because a PNG holds no opinion about a
// CSS token. Somebody has to decode the PNG and compare. That is this file.
//
// Regenerate with `node scripts/generate-icons.mjs` after changing
// --primary; it renders from this same token, so a run always satisfies
// this test and a skipped run always fails it.

const root = resolve(process.cwd());

/** The `--primary` hex from the `:root` (light) block — the brand accent. */
function brandColour(): string {
  const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");
  const block = css.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? "";
  return (block.match(/--primary:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1] ?? "").toLowerCase();
}

type Manifest = {
  theme_color: string;
  icons: Array<{ src: string; sizes: string; purpose?: string }>;
};

const manifest: Manifest = JSON.parse(
  readFileSync(resolve(root, "public/manifest.webmanifest"), "utf8")
);

/**
 * The colour covering the most of an icon, ignoring anything transparent.
 * The wordmark is about 5% of the canvas and the rounded corners are cut
 * out, so the single most common opaque colour is the ground by a margin
 * of roughly eighteen to one — no threshold tuning required.
 */
async function groundColour(file: string): Promise<string> {
  const { data, info } = await sharp(resolve(root, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tally = new Map<string, number>();
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 128) continue;
    const hex = `#${[data[i], data[i + 1], data[i + 2]]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")}`;
    tally.set(hex, (tally.get(hex) ?? 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Share of the canvas that is opaque near-white — the wordmark. */
async function inkShare(file: string): Promise<number> {
  const { data, info } = await sharp(resolve(root, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let ink = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] > 128 && data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) ink++;
  }
  return ink / (info.width * info.height);
}

describe("the PWA identity agrees with the theme token", () => {
  it("reads a brand accent out of :root", () => {
    // Guards the two regexes above rather than the icons: if globals.css is
    // ever restructured so the match returns "", every assertion below
    // would compare "" to "" and pass while proving nothing.
    expect(brandColour()).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("sets manifest theme_color to the brand accent", () => {
    // theme_color paints the Android status bar and the splash screen. It
    // is the half of this pairing that a human can actually read, which is
    // exactly why it was the half that got fixed on its own.
    expect(manifest.theme_color.toLowerCase()).toBe(brandColour());
  });

  for (const icon of manifest.icons) {
    const file = `public${icon.src}`;

    it(`paints ${icon.src} on the brand accent`, async () => {
      expect(await groundColour(file)).toBe(brandColour());
    });

    it(`still has a legible wordmark on ${icon.src}`, async () => {
      // A solid rectangle of the right colour would satisfy the test above.
      // The wordmark occupies about 5% of the standard icons and 2% of the
      // maskable one, whose type is smaller to clear Android's crop.
      const share = await inkShare(file);
      expect(share).toBeGreaterThan(0.015);
      expect(share).toBeLessThan(0.12);
    });
  }
});
