import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/app/(marketing)";
const files: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".tsx")) files.push(p);
  }
})(DIR);

// These three regressions come back one page at a time and nobody notices
// until the surface is mixed again. Cheap to pin, expensive to re-do by hand.
describe("the marketing surface", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  // Matches a hotlink, not a mention. The comments that record WHY the stock
  // photos were removed legitimately name the host, and a test that forbade
  // the word would push people into deleting the explanation.
  it("hotlinks no stock photography", () => {
    const hotlink = /https?:\/\/[^"'\s]*(unsplash|pexels|shutterstock|gettyimages)/i;
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(hotlink);
    }
  });

  // Emoji were the demo's icon set. Structure and mono labels replaced them —
  // nothing to commission, and nothing that renders differently on every
  // device a parent might own.
  it("uses no emoji as iconography", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(emoji);
    }
  });

  it("takes its colour from tokens, not literals", () => {
    const literal = /\b(bg|text|border)-(gray|slate|teal|zinc|cyan|neutral)-\d{2,3}\b/;
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(literal);
    }
  });
});
