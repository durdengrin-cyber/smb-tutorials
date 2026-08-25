import { describe, it, expect } from "vitest";
import {
  CURRICULA,
  GRADES,
  STREAMS,
  SUBJECTS_BY_STREAM,
  isCurriculum,
  isGrade,
  isStream,
  isSubjectOf,
} from "./taxonomy";

describe("taxonomy", () => {
  it("matches the spec §7 values exactly", () => {
    expect(CURRICULA).toEqual(["CBSE", "State Board", "ICSE"]);
    expect(GRADES).toEqual(["6th", "7th", "8th", "9th", "10th", "11th", "12th"]);
    expect(STREAMS).toEqual(["Science", "Commerce", "Arts"]);
    expect(SUBJECTS_BY_STREAM.Science).toEqual([
      "Physics",
      "Chemistry",
      "Biology",
      "Mathematics",
    ]);
    expect(SUBJECTS_BY_STREAM.Commerce).toEqual([
      "Accountancy",
      "Business Studies",
      "Economics",
      "Mathematics",
    ]);
    expect(SUBJECTS_BY_STREAM.Arts).toEqual([
      "History",
      "Geography",
      "Political Science",
      "Economics",
      "Sociology",
    ]);
  });

  it("guards accept valid values and reject invalid ones", () => {
    expect(isCurriculum("CBSE")).toBe(true);
    expect(isCurriculum("IB")).toBe(false);
    expect(isGrade("6th")).toBe(true);
    expect(isGrade("5th")).toBe(false);
    expect(isStream("Arts")).toBe(true);
    expect(isStream("Sports")).toBe(false);
    expect(isSubjectOf("Science", "Physics")).toBe(true);
    expect(isSubjectOf("Science", "History")).toBe(false);
    expect(isSubjectOf("Sports", "Physics")).toBe(false);
  });
});
