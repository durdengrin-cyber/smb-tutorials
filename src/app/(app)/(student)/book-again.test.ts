import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// "Book X again" is a contract between two files that never import each other:
// /sessions builds a query string, /teachers reads it. A renamed parameter on
// either side breaks the feature SILENTLY — the link still works, the list
// still renders, and the teacher simply never gets pinned. Nothing else in the
// suite would notice, because both pages are individually fine.
//
// Comments are stripped before whitespace is collapsed. The other order leaves
// each file on one line, so /\/\/[^\n]*/ eats everything from the first "//"
// and every "does not contain" assertion then passes on an empty string. That
// exact mistake shipped a vacuous guard earlier the same day.
const read = (...p: string[]) =>
  readFileSync(join("src", "app", "(app)", "(student)", ...p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ");

const SESSIONS = read("sessions", "page.tsx");
const TEACHERS = read("teachers", "page.tsx");
const LIST = read("teachers", "online-list.tsx");

describe("book again survives the trip between /sessions and /teachers", () => {
  it("is not vacuous — all three files were actually read", () => {
    for (const [name, src] of [
      ["sessions", SESSIONS],
      ["teachers", TEACHERS],
      ["online-list", LIST],
    ] as const) {
      expect(src.length, `${name} read as empty`).toBeGreaterThan(500);
    }
  });

  it("sends every criterion /teachers filters on", () => {
    // stream is the one that was missing: /sessions never needed it until a
    // row became a way back, and without it the list arrives unfiltered and
    // "Start now" is refused by requestSession as an incomplete taxonomy.
    for (const param of ["curriculum", "grade", "stream", "subject", "again"]) {
      expect(
        SESSIONS,
        `/sessions does not put ${param} in the Book-again link`
      ).toMatch(new RegExp(`${param}:`));
    }
  });

  it("selects the columns that link is built from", () => {
    expect(SESSIONS).toMatch(/teacher_id/);
    expect(SESSIONS).toMatch(/stream/);
  });

  it("reads the same parameter name on the other side", () => {
    expect(TEACHERS, "/teachers never reads params.again").toMatch(
      /params\.again/
    );
    expect(TEACHERS, "/teachers does not pass it to the list").toMatch(
      /againTeacherId/
    );
    expect(LIST, "the list does not accept it").toMatch(/againTeacherId/);
  });

  it("actually pins with it rather than only accepting it", () => {
    expect(LIST).toMatch(/pinFirst\(\s*derived\s*,\s*againTeacherId\s*\)/);
  });
});
