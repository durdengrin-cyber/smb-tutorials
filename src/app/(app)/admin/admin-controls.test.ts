import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VETTING_STATES, isVettingState } from "@/lib/vetting";

// The Suspend button on this page submitted state="suspended" and threw
// "invalid state: suspended" on every click. It was not typed wrong — it was
// correct against the FOUR-state model, and stayed behind when suspension
// moved to teacher_suspensions and VETTING_STATES narrowed to two. Nothing
// connected the button to the enum it feeds, so nothing failed.
//
// This reads the page and checks that every state the form can submit is one
// the validator accepts. It is deliberately a source-level assertion: the bug
// lived in the gap between a JSX literal and a TypeScript union, which is
// exactly where type-checking cannot reach.
const PAGE = readFileSync(join("src", "app", "(app)", "admin", "page.tsx"), "utf8");

describe("the admin page's vetting controls", () => {
  const submitted = [...PAGE.matchAll(/name="state"\s+value="([^"]+)"/g)].map((m) => m[1]);

  it("submits at least one vetting state", () => {
    expect(submitted.length).toBeGreaterThan(0);
  });

  it("submits only states the validator accepts", () => {
    for (const state of submitted) {
      expect(isVettingState(state), `button submits state="${state}"`).toBe(true);
    }
  });

  // The specific regression. "suspended" is not a vetting state and has not
  // been one since suspension got its own table; a button offering it is dead
  // on click, and worse, tells the operator a lever exists that does not.
  it("offers no button for a state that was removed from the model", () => {
    expect(submitted).not.toContain("suspended");
    expect(submitted).not.toContain("removed");
    expect(VETTING_STATES).toEqual(["unvetted", "cleared"]);
  });

  // Suspension is lifted through reinstate_teacher, never by writing a
  // vetting state, and the page must reach for the right one.
  it("lifts a suspension through reinstateTeacher, not setVettingState", () => {
    expect(PAGE).toMatch(/action=\{reinstateTeacher\}/);
    expect(PAGE).toMatch(/name="outcome"\s+value="reinstated"/);
  });

  // A teacher off the roster for a conduct report must not be shown a Clear
  // button, which would imply clearing them puts them back. It does not:
  // available_teachers excludes an open suspension regardless of vetting.
  it("reads open suspensions, so a suspended teacher is not shown as clearable", () => {
    expect(PAGE).toMatch(/teacher_suspensions/);
    expect(PAGE).toMatch(/\.is\("lifted_at", null\)/);
  });
});

// The badge is a claim about what students can reach, so it must apply the
// SAME conjunction available_teachers applies. It once read vetting and
// suspension only and printed "live" beside a cleared teacher who had never
// gone online — checked against production on 2026-09-09, where Task13 Tutor
// Verify showed "live" with availability of null.
describe("the live badge tells the truth about the roster", () => {
  it("requires all three gates, not two", () => {
    expect(PAGE).toMatch(/const pickable = cleared && !suspended && isOnline/);
  });

  // Narrowed in SQL, not in the component: a second clock in JavaScript is a
  // second clock to disagree with the database's, and reading "now" during
  // render is impure besides.
  it("reads availability, and lets the database rule on a lapsed lease", () => {
    expect(PAGE).toMatch(/from\("teacher_availability"\)/);
    expect(PAGE).toMatch(/\.eq\("declared", true\)/);
    expect(PAGE).toMatch(/\.gt\("declared_until"/);
    expect(PAGE).not.toMatch(/Date\.now\(\)/);
  });

  // Cleared-but-offline is not the operator's problem to fix, and must not
  // look like an un-cleared teacher waiting on them.
  it("distinguishes offline from not-cleared", () => {
    expect(PAGE).toMatch(/offline/);
  });
});
