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

// The whole product surface: everything under src/app and src/components,
// except (marketing) — which has its own guard, marketing.test.ts — and test
// files themselves. This used to be an INCLUSION list: three hand-named route
// groups under src/app, plus two hand-named files out of 27 in
// src/components. That is exactly the shape of bug that let the entire
// (fullscreen) route group render un-repainted through eight tasks — a file
// the list does not know about is invisible to it, silently, and stays that
// way until someone remembers to add it by name. An EXCLUSION list can still
// miss a file, but only by naming it in ALLOW below, where the omission is a
// decision on the record, not a blind spot.
//
// The rules themselves now live in @/test/design-guards, shared with
// marketing.test.ts. Splitting the surface in two was sound; letting the two
// halves define "literal colour" differently was not, and cost this project
// a teal gradient and six lines of literal blue on /tutor-signup.
const EXCLUDE_DIRS = [join("src", "app", "(marketing)")];

const files = [
  ...collectFiles("src/app", { exclude: EXCLUDE_DIRS }),
  ...collectFiles("src/components", { exclude: EXCLUDE_DIRS }),
];

// Genuine exceptions, allowed by specific file AND specific check, with the
// reason on the record — never by loosening a regex to stop matching a whole
// class of thing. Each is scoped to only the check it is actually an
// exception to, so a dialog that starts using a stray literal-grey class
// elsewhere still fails the literal-colour check; it just isn't flagged again
// for the one line it's already accounted for.
const ALLOW_LITERAL_COLOR = new Set<string>([
  // The modal overlay scrim. A fixed black wash behind a dialog is correct in
  // both themes — it dims whatever was on screen, not a themed surface — so
  // there is no token this could instead read from.
  join("src", "components", "ui", "dialog.tsx"),
]);
const ALLOW_RAW_HEX = new Set<string>([
  // Google's own brand mark, reproduced at the exact colours Google's brand
  // guidelines specify. These must never be tokenised — a themed "G" logo is
  // a broken "Sign in with Google" button, not a themed one.
  join("src", "components", "google-button.tsx"),
]);

describe("the app surface", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("takes its colour from tokens, not literals", () => {
    for (const f of files) {
      if (ALLOW_LITERAL_COLOR.has(f)) continue;
      expect(readFileSync(f, "utf8"), f).not.toMatch(LITERAL_COLOR);
    }
  });

  it("uses no emoji as iconography", () => {
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(EMOJI);
    }
  });

  // find/page.tsx's background grid carried stroke="#14B8A6" — Tailwind's
  // teal-500, the demo palette this whole cycle exists to remove — through six
  // repaint tasks. It survived because it was a raw SVG attribute, not a
  // Tailwind class.
  it("carries no raw hex colour literals", () => {
    for (const f of files) {
      if (ALLOW_RAW_HEX.has(f)) continue;
      expect(readFileSync(f, "utf8"), f).not.toMatch(RAW_HEX);
    }
  });

  it("carries no invisible characters", () => {
    for (const f of files) {
      const source = readFileSync(f, "utf8");
      expect(source, `${f} — ${describeInvisible(source) ?? ""}`).not.toMatch(
        INVISIBLE_CHAR
      );
    }
  });
});
