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

// 0025 gave the admin a suspension that is not a conduct report. It must stay
// distinct from "Send back to review": both take a teacher off the roster, but
// one says "nobody has checked this person" and the other says "I looked and
// stopped them". Conflating them loses the only record of which happened.
describe("admin-initiated suspension", () => {
  it("suspends through suspendTeacher, never by writing a vetting state", () => {
    expect(PAGE).toMatch(/action=\{suspendTeacher\}/);
    // "suspended" is still not a vetting state and must never be submitted as one.
    expect(PAGE).not.toMatch(/name="state"\s+value="suspended"/);
  });

  it("requires a reason in the form, as the RPC does in SQL", () => {
    expect(PAGE).toMatch(/name="reason"/);
    expect(PAGE).toMatch(/required/);
  });

  it("is not offered for a teacher who is already suspended", () => {
    expect(PAGE).toMatch(/\{suspended \? null : \(/);
  });
});

// 0024 sends a teacher back to the queue on any profile change, which on its
// own leaves /admin showing a name and the word "unvetted" — the admin then
// opens the profile and compares it against memory. 0026 keeps the diff the
// trigger already computed, and this is the surface that reads it.
describe("the queue says what changed", () => {
  it("reads the diff rather than making the admin hunt for it", () => {
    expect(PAGE).toMatch(/from\("teacher_revet_events"\)/);
    expect(PAGE).toMatch(/changed since you approved them/);
  });

  // Shown only for a teacher awaiting a decision. A cleared teacher's old
  // diffs are history and would just be noise beside a Send-back button.
  it("shows it only while the teacher is unvetted", () => {
    expect(PAGE).toMatch(/!cleared && \(changesSince/);
  });

  // A teacher cleared, edited, cleared, edited again presents ONE decision.
  it("scopes the diff to changes since the last approval", () => {
    expect(PAGE).toMatch(/from\("teacher_vetting"\)/);
    expect(PAGE).toMatch(/approvedAt/);
    expect(PAGE).toMatch(/<= since\) continue/);
  });

  // An unlabelled field is still a field the admin must see; falling back to
  // the column name is right, hiding it is not.
  it("falls back to the column name for a field it has no label for", () => {
    expect(PAGE).toMatch(/FIELD_LABEL\[field\] \?\? field/);
  });
});

// 0027 took subjects out of self-service. A teacher was cleared to teach the
// subjects an admin saw them demonstrate; adding one with a PATCH and being
// picked for it the same minute is the hole this closes.
describe("subject change requests", () => {
  const ACTIONS = readFileSync(join("src", "app", "(app)", "admin", "actions.ts"), "utf8");
  const MIGRATION = readFileSync(
    join("supabase", "migrations", "0027_subject_change_requests.sql"),
    "utf8"
  );

  it("the admin page shows pending requests with the video to watch", () => {
    expect(PAGE).toMatch(/from\("subject_change_requests"\)/);
    expect(PAGE).toMatch(/\.eq\("status", "pending"\)/);
    expect(PAGE).toMatch(/Watch the new demo video/);
  });

  it("decides through the RPC, in one transaction", () => {
    expect(ACTIONS).toMatch(/rpc\("decide_subject_change"/);
    // Never by writing the tables directly: approval replaces subjects, adopts
    // the video, clears the teacher and stamps teacher_vetting, and doing that
    // in four round trips leaves half-states.
    expect(ACTIONS).not.toMatch(/from\("teacher_subjects"\)/);
  });

  // The whole point of a request over a re-vet: the admin gets something new
  // to watch. A request with no video is not reviewable.
  it("requires a demo video, in SQL and not only in the form", () => {
    expect(MIGRATION).toMatch(/demo_video_url text not null/);
    expect(MIGRATION).toMatch(/a demo video is required for the new subjects/);
  });

  // The direct write path has to be gone, or the request flow is optional.
  it("drops the policies that let a teacher write subjects directly", () => {
    expect(MIGRATION).toMatch(/drop policy if exists "teacher manages own subjects"/);
    expect(MIGRATION).toMatch(/drop policy if exists "teacher deletes own subjects"/);
  });

  // ...but signup still has to work, and it inserted subjects with the
  // teacher's own session.
  it("leaves signup a way in, used once", () => {
    expect(MIGRATION).toMatch(/function public\.set_initial_subjects/);
    expect(MIGRATION).toMatch(/subjects are already set; request a change instead/);
    const SIGNUP = readFileSync(
      join("src", "app", "(marketing)", "tutor-signup", "actions.ts"),
      "utf8"
    );
    expect(SIGNUP).toMatch(/rpc\("set_initial_subjects"/);
    // Reading teacher_subjects is still fine and still needed — the history
    // check counts them to decide whether an account may convert. What must be
    // gone is the WRITE.
    expect(SIGNUP).not.toMatch(/from\("teacher_subjects"\)[\s\S]{0,120}\.insert\(/);
  });

  // Approving must not trip 0024's re-vet on the demo video it is adopting,
  // and must not leave the flag on for the rest of the transaction.
  it("guards the vetting flag on both sides of the approval", () => {
    expect(MIGRATION).toMatch(/set_config\('app\.allow_vetting_change', 'on', true\)/);
    expect(MIGRATION).toMatch(/set_config\('app\.allow_vetting_change', 'off', true\)/);
  });
});
