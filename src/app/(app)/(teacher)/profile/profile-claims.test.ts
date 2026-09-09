import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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

// The copy "Changing it sends your profile back for review" was written once
// before anything did that, and removed the same day for being untrue.
// Migration 0023 makes it true. This pins the two together so the sentence
// cannot outlive the mechanism again — and so that a migration reverted
// without the copy is caught here rather than by a teacher.
describe("the re-review promise has a migration behind it", () => {
  const MIGRATION = join("supabase", "migrations", "0023_revet_on_demo_video_change.sql");

  it("promises re-review only if 0023 exists", () => {
    const promised = /back for review/i.test(FORM);
    expect(existsSync(MIGRATION), "profile copy promises re-review").toBe(promised);
  });

  it("0023 actually resets the state on a demo video change", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(/demo_video_url is distinct from old\.demo_video_url/);
    expect(sql).toMatch(/new\.vetting_state\s*:=\s*'unvetted'/);
    // Only for a teacher who was actually cleared, or every profile save on an
    // unvetted teacher looks like a state change.
    expect(sql).toMatch(/old\.vetting_state = 'cleared'/);
  });

  // db push wraps each migration in its own transaction; an explicit commit
  // inside would end it early and run the rest unprotected.
  it("0023 carries no explicit transaction control", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).not.toMatch(/^\s*(begin|commit)\s*;/im);
  });
});
