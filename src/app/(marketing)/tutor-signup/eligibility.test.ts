import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canBecomeTeacher } from "@/lib/routes";

// /tutor-signup invited a signed-in student to "convert that account into a
// tutor account", took fifteen fields, and only then let become_teacher refuse
// them — because the page checked the ROLE half of canBecomeTeacher and left
// the session/subject-count half to the action. Tyler, a real student with
// four completed lessons, would have hit exactly that.
//
// The page now runs the same predicate. These assertions exist so it keeps
// running the SAME one: a second, hand-rolled copy of the rule on the page is
// how the two drift into disagreeing about who may apply.
const dir = join("src", "app", "(marketing)", "tutor-signup");
const PAGE = readFileSync(join(dir, "page.tsx"), "utf8");
const ACTION = readFileSync(join(dir, "actions.ts"), "utf8");

describe("who may apply is decided in one place", () => {
  it("the page imports the predicate rather than reimplementing it", () => {
    expect(PAGE).toMatch(/canBecomeTeacher/);
    expect(PAGE).toMatch(/from "@\/lib\/routes"/);
  });

  it("the action still enforces it, because the page is only a courtesy", () => {
    expect(ACTION).toMatch(/canBecomeTeacher/);
  });

  it("the page counts the same two things the action counts", () => {
    for (const source of [PAGE, ACTION]) {
      expect(source).toMatch(/from\("sessions"\)/);
      expect(source).toMatch(/eq\("student_id"/);
      expect(source).toMatch(/from\("teacher_subjects"\)/);
      expect(source).toMatch(/eq\("teacher_id"/);
    }
  });

  // The page must fail OPEN and the action CLOSED. If the count query breaks,
  // showing the form costs a wasted submission; hiding it turns away a
  // legitimate applicant with no way through. The action, which writes the
  // row, must do the opposite.
  it("the action fails closed on a broken count query", () => {
    expect(ACTION).toMatch(/sessionRes\.error \|\| subjectRes\.error/);
    expect(ACTION).toMatch(/Couldn't verify this account/);
  });

  it("the page fails open on a broken count query", () => {
    expect(PAGE).toMatch(/history === null \|\|/);
  });
});

// The predicate itself, at the boundaries the page now depends on.
describe("canBecomeTeacher", () => {
  const fresh = { sessionCount: 0, subjectCount: 0 };

  it("admits a fresh student", () => {
    expect(canBecomeTeacher({ role: "student", ...fresh })).toBe(true);
  });

  it("refuses a student who has taken a lesson", () => {
    expect(
      canBecomeTeacher({ role: "student", sessionCount: 1, subjectCount: 0 })
    ).toBe(false);
  });

  it("refuses a student who already has subjects", () => {
    expect(
      canBecomeTeacher({ role: "student", sessionCount: 0, subjectCount: 1 })
    ).toBe(false);
  });

  it("refuses an admin outright", () => {
    expect(canBecomeTeacher({ role: "admin", ...fresh })).toBe(false);
  });
});
