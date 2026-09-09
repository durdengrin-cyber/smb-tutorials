import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LITERAL_COLOR,
  RAW_HEX,
  EMOJI,
  INVISIBLE_CHAR,
  describeInvisible,
  collectFiles,
} from "@/test/design-guards";

const DIR = join("src", "app", "(marketing)");
const files = collectFiles(DIR, { extensions: [".tsx", ".ts"] });

// The colour, emoji, hex and invisible-character rules come from
// @/test/design-guards, shared with app-surface.test.ts. They used to be
// written out here, narrower, and that drift is what let /tutor-signup keep
// the demo's teal gradient and six lines of literal blue while both guards
// reported green. The stock-photo rule below stays local because it is the
// one rule genuinely specific to this surface.
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
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(EMOJI);
    }
  });

  it("takes its colour from tokens, not literals", () => {
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(LITERAL_COLOR);
    }
  });

  it("carries no raw hex colour literals", () => {
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(RAW_HEX);
    }
  });

  // A joiner on a surface with no emoji has nothing to join: it is the
  // residue of an emoji that lost its other codepoints, and it renders as
  // dead space no reviewer can see.
  it("carries no invisible characters", () => {
    for (const f of files) {
      const source = readFileSync(f, "utf8");
      expect(source, `${f} — ${describeInvisible(source) ?? ""}`).not.toMatch(
        INVISIBLE_CHAR
      );
    }
  });
});
