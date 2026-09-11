import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { collectFiles } from "@/test/design-guards";

// The product spells its own name five ways across the repo, and CLAUDE.md
// carries "pick one form and apply it everywhere" as an open decision. This
// settles it for PROSE: the human-readable name is "SMB Tutorials", plural,
// always. The other forms are not spellings of the name and are left alone —
// smbtutorials.com cannot carry a space, and the repo directory is
// smb-tutorials because that is what directories look like.
//
// Two singular instances reached production inside /terms, and they were the
// worst two possible: "all tutors at SMB Tutorial are held to a high standard"
// and "By creating a tutor account and accepting sessions on SMB Tutorial, you
// agree to the following as binding conditions". Both name the counterparty in
// the sentences that create obligations.
//
// WHITESPACE-COLLAPSED on read, which is the whole reason this file exists as
// a guard rather than a one-time fix. Both instances were invisible to a plain
// grep because JSX had wrapped them mid-name:
//
//     ...all tutors at SMB
//     Tutorial are held to...
//
// A literal search for "SMB Tutorial" found nothing and the error survived
// every review. Same reasoning as recording-claims.test.ts, which collapses
// whitespace for exactly this reason.
const files = [
  ...collectFiles("src/app"),
  ...collectFiles("src/components"),
];

const flatten = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

// Singular only when it is the NAME: "SMB Tutorial" not followed by another
// letter. "SMB Tutorials" passes; so would "SMB Tutorial-branded" if anyone
// ever wrote it, which is a hyphenated compound rather than a wrong name.
const SINGULAR = /SMB Tutorial(?![A-Za-z])/;

describe("the product spells its own name one way", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("never calls itself SMB Tutorial, singular", () => {
    for (const f of files) {
      const flat = flatten(f);
      const m = flat.match(SINGULAR);
      expect(
        m,
        m
          ? `${f} calls the product "SMB Tutorial" — the name is "SMB Tutorials". Context: ...${flat.slice(
              Math.max(0, (m.index ?? 0) - 70),
              (m.index ?? 0) + 70
            )}...`
          : ""
      ).toBeNull();
    }
  });

  // Pinned both ways, in the pattern this repo already uses: if the name is
  // ever deliberately changed, this fails and asks for the decision out loud
  // rather than letting half the product drift to a new one.
  it("still calls itself SMB Tutorials somewhere, so the guard is not vacuous", () => {
    const anywhere = files.some((f) => /SMB Tutorials/.test(flatten(f)));
    expect(anywhere).toBe(true);
  });
});
