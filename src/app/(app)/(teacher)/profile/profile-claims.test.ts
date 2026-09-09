import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The profile editor told teachers their bio was "shown to students", and the
// page above it said "Students see your rate, subjects and bio when they pick
// a teacher". Neither was true: bio is written to profiles and read by
// nothing. available_teachers does not return it, the teachers page does not
// select it, and teacher-card.tsx does not render it. A teacher could write a
// bio and reasonably believe students were reading it.
//
// This is the third promise-without-an-enforcer found in this codebase in one
// day, so it is pinned rather than merely corrected. The check runs BOTH ways:
// the day someone renders bio on the card, this fails and asks for the copy
// back.
const CARD = readFileSync(
  join("src", "app", "(app)", "(student)", "teachers", "teacher-card.tsx"),
  "utf8"
);
const FORM = readFileSync(
  join("src", "app", "(app)", "(teacher)", "profile", "profile-form.tsx"),
  "utf8"
);
const PAGE = readFileSync(
  join("src", "app", "(app)", "(teacher)", "profile", "page.tsx"),
  "utf8"
);

/** Does the student's teacher card actually render this profile field? */
function cardRenders(field: string): boolean {
  return new RegExp(`teacher\\.${field}\\b`).test(CARD);
}

describe("what the profile editor promises matches what a student sees", () => {
  it("renders the fields the page names", () => {
    // Named in the page description, so each must actually reach the card.
    for (const field of ["hourly_rate", "qualification", "experience_years"]) {
      expect(cardRenders(field), `page names it but card omits ${field}`).toBe(true);
    }
  });

  // The specific regression, stated as an invariant rather than a string match:
  // bio may be promised only while bio is rendered.
  it("promises the bio only if the card renders it", () => {
    const promised =
      /shown to students/i.test(FORM) || /\band bio\b/i.test(PAGE);
    expect(
      promised,
      promised && !cardRenders("bio")
        ? "the profile copy says students see the bio, but teacher-card.tsx never renders teacher.bio — either render it or correct the copy"
        : ""
    ).toBe(cardRenders("bio"));
  });

  it("still collects a bio, so correcting the copy did not delete the field", () => {
    expect(FORM).toMatch(/name="bio"/);
  });
});
