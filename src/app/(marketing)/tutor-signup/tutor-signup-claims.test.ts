import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// For most of this product's life the tutor application ended with "Our team
// will review your application and contact you within 2-3 business days."
//
// Neither half was true. Nothing contacts an applicant — a cleared teacher
// simply becomes visible to students — and no mechanism holds anyone to 2-3
// days, because there is one operator and no SLA. It sat under the submit
// button and nobody caught it, which is the same shape as the bio and the demo
// video in profile-claims.test.ts: a promise on a form with nothing behind it.
//
// Pinned both ways. If we ever DO email applicants, or commit to a turnaround,
// this fails and asks for the mechanism to be named in the same commit.
// ORDER MATTERS, and getting it wrong cost a green run: comments are stripped
// while the newlines are still there, THEN whitespace is collapsed. Doing it
// the other way leaves the file on a single line, so /\/\/[^\n]*/ matches from
// the first "//" to the end of everything and the guard silently inspects an
// empty string — which passes every "does not contain" assertion it has.
//
// Comments are stripped because they quote the retired wording deliberately.
// A guard its own explanation trips is a guard someone deletes.
//
// Whitespace is collapsed because JSX wraps prose wherever the line runs out,
// and the sentence this guards was itself split across two lines. A literal
// match would pass or fail on where a formatter happened to break it — the
// same trap that hid "SMB Tutorial" from every grep until entity-name.test.ts.
const P = (...p: string[]) =>
  readFileSync(join("src", "app", "(marketing)", "tutor-signup", ...p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ");

const FORM = P("tutor-form.tsx");
const PAGE = P("page.tsx");
const PROSE = FORM + " " + PAGE;

describe("what the tutor application promises", () => {
  // "We'll be in touch" is the specific false expectation that was there. A
  // teacher who believes it waits for an email that never comes instead of
  // opening the dashboard that would have told them.
  it("does not promise to contact the applicant", () => {
    for (const claim of [
      /contact you/i,
      /we will (email|call|reach out)/i,
      /we'll (email|call|reach out)/i,
      /get back to you/i,
      /hear from us/i,
    ]) {
      expect(
        PROSE,
        `tutor-signup claims ${claim} — nothing contacts an applicant; a cleared teacher just becomes visible`
      ).not.toMatch(claim);
    }
  });

  // Any number here is a promise with no enforcer. One operator, no SLA, and
  // no code measures how long a review takes.
  it("names no review turnaround", () => {
    for (const claim of [
      /\d+\s*-\s*\d+\s*(business\s*)?days?/i,
      /within \d+ (hour|day|week)/i,
      /\d+ business days?/i,
    ]) {
      expect(
        PROSE,
        `tutor-signup names a turnaround (${claim}) — nothing enforces one`
      ).not.toMatch(claim);
    }
  });

  // The other half of the pin: having removed the false promise, the true one
  // must actually be there. Silence about review would be its own defect — an
  // applicant should know a human reads this before they fill the form.
  it("still tells the applicant a person checks them", () => {
    expect(PROSE).toMatch(/a person checks your ID/i);
    expect(PROSE).toMatch(/check your ID|checks? your ID/i);
  });

  // And that it is said BEFORE the fields, not only under the submit button.
  it("says what happens after applying on the page, not only in the form", () => {
    expect(PAGE).toMatch(/We check your ID/i);
    expect(PAGE).toMatch(/You go live/i);
  });
});
