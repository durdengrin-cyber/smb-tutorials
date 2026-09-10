import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Three published pages assert that a government ID is checked against the name
// on the account before a teacher meets a child:
//
//   home     "Government ID, checked against the account"
//   /signup  "Every teacher's government ID is checked against the name on
//             their account before they teach"
//   /about   "verified against government ID before they meet a child"
//
// Until 2026-09-10 nothing stood behind them. The Clear button was a bare
// <button name="state" value="cleared"> in a form with no note field, so
// setVettingState's `formData.get("note")` was always null and every clear
// wrote teacher_vetting.note = NULL. Who cleared them and when was recorded;
// that an ID had been looked at was not, anywhere. The claim rested entirely on
// the operator remembering, with nothing prompting them and no trace after.
//
// This is the seventh promise-without-an-enforcer found in this repo, and the
// only one that is a child-safety claim. See
// _memory/promises-need-an-enforcer.md.
//
// What is pinned is an AFFIRMATION, not a verification. No code can confirm a
// view-once photo on WhatsApp showed a real ID. What it can do is refuse to
// record a clearance unless the operator states they made the check — turning
// an unrecorded habit into evidence, which is the same "keep the proof, not the
// payload" principle the child-safety spec already chose.
const read = (...p: string[]) => readFileSync(join(...p), "utf8").replace(/\s+/g, " ");

const ADMIN_PAGE = read("src", "app", "(app)", "admin", "page.tsx");
const ADMIN_ACTIONS = read("src", "app", "(app)", "admin", "actions.ts");
const HOME = read("src", "app", "(marketing)", "page.tsx");
const SIGNUP = read("src", "app", "(marketing)", "signup", "page.tsx");
const ABOUT = read("src", "app", "(marketing)", "about", "page.tsx");

const CLAIMS = { "the home page": HOME, "/signup": SIGNUP, "/about": ABOUT };
const CLAIMS_ID_CHECK = /government id/i;

describe("the ID-check claim has something behind it", () => {
  it("is still made on all three pages", () => {
    // If this fails, the claim was removed — then the mechanism below may go
    // too, but deliberately and in the same commit, not by drift.
    for (const [name, src] of Object.entries(CLAIMS)) {
      expect(src, `${name} no longer claims an ID check`).toMatch(CLAIMS_ID_CHECK);
    }
  });

  it("the Clear control asks the operator to affirm the check", () => {
    expect(ADMIN_PAGE, "no affirmation input beside Clear").toMatch(
      /name="idChecked"/
    );
    expect(ADMIN_PAGE, "the affirmation is optional — it must be required").toMatch(
      /name="idChecked"[^>]*required|required[^>]*name="idChecked"/
    );
  });

  it("the server refuses a clearance that does not affirm it", () => {
    // required= in the markup is browser-only decoration; the repo has been
    // bitten by exactly that before (the consent checkbox, 0014).
    expect(ADMIN_ACTIONS, "the action never reads idChecked").toMatch(/idChecked/);
    expect(
      ADMIN_ACTIONS,
      "the action does not refuse a clear without the affirmation"
    ).toMatch(/state === "cleared"[\s\S]{0,200}?throw/);
  });

  it("records the affirmation so it can be read back later", () => {
    expect(
      ADMIN_ACTIONS,
      "nothing is written to teacher_vetting.note, so the clearance leaves no trace of the check"
    ).toMatch(/ID_CHECK_NOTE|p_note: note/);
  });

  // The reason the ID is not stored at all, and must never start being stored:
  // the child-safety spec's "keep the proof, not the payload". A free-text note
  // invites an operator to type an ID number into the database.
  it("does not invite the operator to type ID details into the database", () => {
    expect(
      ADMIN_PAGE,
      "a free-text note beside Clear is where an ID number ends up"
    ).not.toMatch(/name="note"[^>]*type="text"/);
  });
});


// The operator decides whether a stranger teaches children, and could see four
// things about them: name, vetting badge, a demo video link and a WhatsApp
// link. Everything the teacher actually claimed — what they are qualified in,
// how long they have taught, what they charge, which subjects they would be
// listed for — was selected by nobody and rendered nowhere. Raised on
// 2026-09-10 after approving a real tutor and noticing there was nothing to
// approve ON.
//
// Note there is no resume or CV in this product at all: no upload, no storage,
// no column anywhere in the schema. What follows is the whole of what exists.
describe("the operator can see what they are approving", () => {
  const CLAIMED = [
    "qualification",
    "experience_years",
    "specialization",
    "teaching_level",
    "hourly_rate",
    "hours_per_week",
    "bio",
    "email",
  ];

  it("selects the whole claimed profile, not just a name and a video", () => {
    // Anchored on the select literal itself. A looser "everything up to the
    // next )" stopped inside a prose comment that happened to contain
    // parentheses, and reported a passing select as missing every field.
    const select =
      ADMIN_PAGE.match(/from\("profiles"\)[\s\S]*?\.select\("([^"]*)"\)/)?.[1] ?? "";
    for (const field of CLAIMED) {
      expect(select, `/admin never selects ${field}`).toContain(field);
    }
  });

  it("shows the subjects the teacher would be listed for", () => {
    expect(ADMIN_PAGE, "/admin never reads teacher_subjects").toMatch(
      /teacher_subjects/
    );
  });

  it("renders them, rather than selecting and dropping them", () => {
    for (const field of ["qualification", "experience_years", "hourly_rate"]) {
      expect(ADMIN_PAGE, `${field} is selected but never rendered`).toMatch(
        new RegExp(`t\\.${field}`)
      );
    }
  });
});
