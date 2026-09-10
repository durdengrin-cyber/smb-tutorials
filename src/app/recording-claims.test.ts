import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONSENT_VERSION } from "@/lib/consent";

// Until 2026-09-10 this product published the opposite promise in six places:
// /privacy headed a section "Sessions are not recorded", the home, signup and
// about pages said "never recorded", and /waiting hedged to a parent at the
// moment of payment that sessions "may be recorded". Recording ships before
// public launch and every published page now states it as fact.
//
// Pinned both ways, in the pattern of profile-claims.test.ts. One direction
// stops the old denial creeping back into a page nobody thought to check; the
// other stops the recording claim outliving the CONSENT_VERSION under which a
// user actually agreed to it. A material change to a policy about children's
// video calls is exactly what consent versioning exists for — see
// docs/superpowers/specs/2026-09-04-child-safety-and-consent-design.md §"It
// cannot be re-obtained on a version bump".
// Whitespace-collapsed on read. JSX wraps prose wherever the line runs out,
// so "Every session is recorded" is routinely split across two lines and a
// literal match would pass or fail on where a formatter broke it.
const P = (...p: string[]) =>
  readFileSync(join("src", "app", ...p), "utf8").replace(/\s+/g, " ");

const PAGES = {
  "/privacy": P("(marketing)", "privacy", "page.tsx"),
  "/terms": P("(marketing)", "terms", "page.tsx"),
  "the home page": P("(marketing)", "page.tsx"),
  "/signup": P("(marketing)", "signup", "page.tsx"),
  "/about": P("(marketing)", "about", "page.tsx"),
  "/waiting": P("(app)", "(student)", "waiting", "[sessionId]", "waiting-client.tsx"),
};
const { "/privacy": PRIVACY, "/terms": TERMS, "/waiting": WAITING } = PAGES;

// Every one of these is a statement about what WE do. Deliberately not a bare
// /not record/, which would also match the terms clause forbidding a *user*
// from recording — that clause is still true and has to stay. "may be
// recorded" is here too: a hedge is as wrong now as a denial, and it is the
// exact wording that sat on the payment screen.
const CONTRADICTS_RECORDING = [
  /not recorded/i,
  /never recorded/i,
  /we do not record/i,
  /not store a copy/i,
  /nothing is stored or replayed/i,
  /may be recorded/i,
];

describe("no published page denies or hedges that we record", () => {
  for (const [name, src] of Object.entries(PAGES)) {
    it(`${name} makes no claim that a session goes unrecorded`, () => {
      for (const pattern of CONTRADICTS_RECORDING) {
        expect(src, `${name} still carries ${pattern}`).not.toMatch(pattern);
      }
    });
  }
});

describe("/privacy states the whole of what was decided", () => {
  it("says every session is recorded", () => {
    expect(PRIVACY).toMatch(/every session is recorded/i);
  });

  it("lists recordings among what we collect", () => {
    expect(PRIVACY).toMatch(/session recordings:/i);
  });

  // The three commitments the copy makes on our behalf. None of them is built
  // yet; naming them here is what makes them a requirement the recording
  // feature has to meet rather than a sentence someone wrote once.
  it("names the access rule, the encryption and the log", () => {
    expect(PRIVACY, "no encryption claim").toMatch(/encrypted/i);
    expect(PRIVACY, "no report-gated access rule").toMatch(/unless a report/i);
    expect(PRIVACY, "no access log").toMatch(/access\b[^.]*\blogged/i);
  });

  it("names the retention period and the exception for an open report", () => {
    expect(PRIVACY).toMatch(/30 days/);
    expect(PRIVACY).toMatch(/kept until that report is resolved/i);
  });
});

describe("/terms separates what we do from what a user may do", () => {
  it("states that we record every session", () => {
    expect(TERMS).toMatch(/every session is recorded/i);
  });

  it("still forbids the user from making their own recording", () => {
    expect(TERMS).toMatch(/may not record/i);
  });
});

describe("the payment step", () => {
  it("states recording as fact, not as a possibility", () => {
    expect(WAITING).toMatch(/every session is recorded/i);
  });

  // The recording sentence and the guardian confirmation shared one paragraph.
  // Rewriting the first must not drop the second.
  it("still takes the guardian confirmation", () => {
    expect(WAITING).toMatch(/parent or guardian/i);
  });
});

describe("the recording claim and the consent version move together", () => {
  const claimed = /every session is recorded/i.test(PRIVACY);

  it("CONSENT_VERSION covers recording exactly when the pages claim it", () => {
    expect(
      /recording/i.test(CONSENT_VERSION),
      claimed
        ? `/privacy says every session is recorded, but CONSENT_VERSION is "${CONSENT_VERSION}" — nobody has agreed to a policy that includes recording. Bump it.`
        : `CONSENT_VERSION is "${CONSENT_VERSION}" but no page claims recording — a half-reverted policy change.`
    ).toBe(claimed);
  });

  it("is not the version that predates the recording policy", () => {
    expect(CONSENT_VERSION).not.toBe("2026-09-05-guardian");
  });
});
