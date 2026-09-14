#!/usr/bin/env node
/**
 * Regenerates the PWA icons from the one value that decides them: the
 * `--primary` token in `src/app/globals.css`.
 *
 * Why this script exists rather than three PNGs somebody exported once.
 * On 2026-09-05 the brand accent moved to bronze. The CSS changed alone —
 * the icons and the manifest stayed teal — and for nine days the installed
 * app icon and the browser chrome disagreed with every button inside the
 * app. Nothing caught it because nothing could: a PNG holds no opinion
 * about a CSS token. Here the token IS the input, so the only way the two
 * drift again is if somebody deletes this file, and `theme.test.ts` pins
 * the committed output against the token on every run.
 *
 * It writes all four artefacts that carry the brand colour — the three
 * PNGs and the manifest's `theme_color` — so there is no half of this that
 * can be done on its own. Run it after any change to `--primary` in
 * `:root`, and commit what it rewrites:
 *
 *   node scripts/generate-icons.mjs
 *
 * The glyphs come from the system Helvetica via librsvg, so the output is
 * only reproducible on a machine that has it — every mac here does. The
 * render is measured against the geometry below before it is written, so a
 * font resolving differently fails loudly instead of quietly shipping an
 * icon with the wrong letterforms.
 *
 * NOT covered: `src/app/favicon.ico`. It is still the Next.js starter
 * default and wants a mark that survives 16px, which "SMB" does not.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Helvetica's cap height as a fraction of its em. Used only to turn a
 * target cap height into a font-size; the render is measured afterwards,
 * so an inexact constant surfaces as a failure rather than as drift.
 */
const HELVETICA_CAP = 0.754;

/**
 * Measured off the icons shipped in the 09-05 PWA cycle, so that this
 * script reproduces that design exactly and changes only the colour.
 * Fractions of the canvas, so one set of numbers serves every size.
 *
 *   round     corner radius; 0 is full-bleed
 *   cap       cap height of "SMB"
 *   baseline  y of the text baseline
 *
 * The maskable icon is full-bleed with smaller type because Android crops
 * it to an arbitrary shape: everything outside the centre 80% circle can
 * be cut, and at this cap height the wordmark clears that by a wide margin.
 */
const GEOMETRY = {
  standard: { round: 0.18, cap: 0.227, baseline: 0.6065 },
  maskable: { round: 0, cap: 0.137, baseline: 0.5635 },
};

const MANIFEST = "public/manifest.webmanifest";

const ICONS = [
  { file: "public/icon-192.png", size: 192, shape: "standard" },
  { file: "public/icon-512.png", size: 512, shape: "standard" },
  { file: "public/icon-maskable-512.png", size: 512, shape: "maskable" },
];

/** The `--primary` hex from the `:root` (light) block of globals.css. */
export function brandColour() {
  const css = readFileSync(resolve(ROOT, "src/app/globals.css"), "utf8");
  const root = css.match(/:root \{([\s\S]*?)\n\}/)?.[1];
  if (!root) throw new Error("globals.css: no :root block — cannot read the brand colour");
  const hex = root.match(/--primary:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1];
  if (!hex) throw new Error("globals.css: :root defines no 6-digit hex --primary");
  return hex.toLowerCase();
}

function svg({ size, shape, colour }) {
  const g = GEOMETRY[shape];
  const r = (g.round * size).toFixed(2);
  const fontSize = ((g.cap * size) / HELVETICA_CAP).toFixed(2);
  const baseline = (g.baseline * size).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${colour}"/>
  <text x="${size / 2}" y="${baseline}" text-anchor="middle" fill="#ffffff"
        font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}">SMB</text>
</svg>`;
}

/**
 * Reads back a rendered buffer and reports what is actually on it: the
 * colour of the ground and the bounding box of the white glyphs. This is
 * the check that makes a missing font loud — no Helvetica means no ink,
 * and no ink means no glyph box.
 */
export async function inspect(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const px = (x, y) => { const i = (y * w + x) * c; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };

  const tally = new Map();
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y);
      if (a < 128) continue;
      const key = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
      if (r > 200 && g > 200 && b > 200) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  // The ground is whatever covers the most pixels; the glyphs are ~5%.
  const ground = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return {
    size: w,
    ground,
    glyph: x1 < 0 ? null : { width: x1 - x0 + 1, cap: y1 - y0 + 1, baseline: y1 + 1 },
  };
}

async function render({ size, shape, colour }) {
  const png = await sharp(Buffer.from(svg({ size, shape, colour }))).png({ compressionLevel: 9 }).toBuffer();
  const got = await inspect(png);
  const want = GEOMETRY[shape];

  if (got.ground !== colour) {
    throw new Error(`${size}px ${shape}: ground rendered ${got.ground}, expected ${colour}`);
  }
  if (!got.glyph) {
    throw new Error(`${size}px ${shape}: no white glyphs — Helvetica did not resolve for librsvg`);
  }
  // 2% of the canvas. Tight enough to catch a substituted face (they differ
  // by far more), loose enough to absorb hinting and antialias thresholds.
  const tol = size * 0.02;
  const off = (actual, expected, name) => {
    if (Math.abs(actual - expected * size) > tol) {
      throw new Error(
        `${size}px ${shape}: glyph ${name} is ${actual}px, expected ~${Math.round(expected * size)}px ` +
        `(±${tol.toFixed(1)}) — a different font is being substituted for Helvetica`
      );
    }
  };
  off(got.glyph.cap, want.cap, "cap height");
  off(got.glyph.baseline, want.baseline, "baseline");
  return png;
}

/**
 * Rewrites the manifest's `theme_color` in place. A targeted replacement
 * rather than a JSON round-trip, because re-serialising would reflow the
 * icons array onto twelve lines and bury a one-value change in it.
 */
function writeThemeColour(colour) {
  const file = resolve(ROOT, MANIFEST);
  const before = readFileSync(file, "utf8");
  const after = before.replace(
    /("theme_color"\s*:\s*")#[0-9a-fA-F]{6}(")/,
    `$1${colour}$2`
  );
  if (after === before && !before.includes(`"theme_color": "${colour}"`)) {
    throw new Error(`${MANIFEST}: no 6-digit hex "theme_color" to replace`);
  }
  // Parse what we are about to commit, not what we meant to write.
  const parsed = JSON.parse(after);
  if (parsed.theme_color.toLowerCase() !== colour) {
    throw new Error(`${MANIFEST}: theme_color is ${parsed.theme_color} after the rewrite, expected ${colour}`);
  }
  writeFileSync(file, after);
  return after !== before;
}

async function main() {
  const colour = brandColour();
  console.log(`brand colour from :root --primary: ${colour}`);
  for (const icon of ICONS) {
    const png = await render({ ...icon, colour });
    writeFileSync(resolve(ROOT, icon.file), png);
    const { ground, glyph } = await inspect(png);
    console.log(`  ${icon.file.padEnd(30)} ${icon.size}px  ground ${ground}  cap ${glyph.cap}px`);
  }
  const changed = writeThemeColour(colour);
  console.log(`  ${MANIFEST.padEnd(30)} theme_color ${colour}${changed ? "" : " (already current)"}`);
  console.log("\nsrc/lib/pwa-icons.test.ts pins all four against the token.");
}

export { ICONS, GEOMETRY, MANIFEST };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
