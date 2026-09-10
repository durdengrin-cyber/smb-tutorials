import { describe, it, expect } from "vitest";
import { collapseGrades, summariseSubjects } from "./subject-summary";

// The tutor registered on production teaches 2 subjects across 4 grades — 8
// teacher_subjects rows. Rendered verbatim on /admin that became a paragraph of
// near-identical text and made one teacher a page tall.
const REAL = [
  { subject: "Physics", curriculum: "CBSE", grade: "9th", stream: "Science" },
  { subject: "Physics", curriculum: "CBSE", grade: "10th", stream: "Science" },
  { subject: "Physics", curriculum: "CBSE", grade: "11th", stream: "Science" },
  { subject: "Physics", curriculum: "CBSE", grade: "12th", stream: "Science" },
  { subject: "Chemistry", curriculum: "CBSE", grade: "9th", stream: "Science" },
  { subject: "Chemistry", curriculum: "CBSE", grade: "10th", stream: "Science" },
  { subject: "Chemistry", curriculum: "CBSE", grade: "11th", stream: "Science" },
  { subject: "Chemistry", curriculum: "CBSE", grade: "12th", stream: "Science" },
];

describe("collapseGrades", () => {
  it("turns a contiguous run into a range", () => {
    expect(collapseGrades(["9th", "10th", "11th", "12th"])).toBe("9th–12th");
  });

  it("keeps a gap explicit rather than implying grades that are not taught", () => {
    expect(collapseGrades(["9th", "11th"])).toBe("9th, 11th");
    expect(collapseGrades(["6th", "7th", "8th", "11th", "12th"])).toBe("6th–8th, 11th, 12th");
  });

  it("does not write a two-grade run as a range", () => {
    // "9th–10th" is no shorter than "9th, 10th" and reads as a range where
    // there is nothing worth naming.
    expect(collapseGrades(["9th", "10th"])).toBe("9th, 10th");
  });

  it("sorts by the taxonomy, not alphabetically", () => {
    // "10th" < "9th" as strings; the order must come from GRADES.
    expect(collapseGrades(["12th", "9th", "10th", "11th"])).toBe("9th–12th");
  });

  it("de-duplicates", () => {
    expect(collapseGrades(["9th", "9th", "10th"])).toBe("9th, 10th");
  });

  it("passes through a value outside the taxonomy rather than dropping it", () => {
    // A grade the database holds and this module does not know about is still
    // a fact the operator needs. Silently swallowing it would be worse.
    expect(collapseGrades(["9th", "PhD"])).toBe("9th, PhD");
  });

  it("handles an empty list", () => {
    expect(collapseGrades([])).toBe("");
  });
});

describe("summariseSubjects", () => {
  it("turns eight rows into two readable lines", () => {
    const lines = summariseSubjects(REAL);
    expect(lines).toEqual([
      { subject: "Chemistry", curriculum: "CBSE", stream: "Science", grades: "9th–12th" },
      { subject: "Physics", curriculum: "CBSE", stream: "Science", grades: "9th–12th" },
    ]);
  });

  it("never merges two curricula, because they are two listings to a student", () => {
    const lines = summariseSubjects([
      { subject: "Physics", curriculum: "CBSE", grade: "9th", stream: "Science" },
      { subject: "Physics", curriculum: "ICSE", grade: "9th", stream: "Science" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.curriculum)).toEqual(["CBSE", "ICSE"]);
  });

  it("keeps a null stream distinct from a named one", () => {
    const lines = summariseSubjects([
      { subject: "Maths", curriculum: "CBSE", grade: "9th", stream: null },
      { subject: "Maths", curriculum: "CBSE", grade: "10th", stream: "Science" },
    ]);
    expect(lines).toHaveLength(2);
  });

  it("handles a teacher with no subjects", () => {
    expect(summariseSubjects([])).toEqual([]);
  });
});
