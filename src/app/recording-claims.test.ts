import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { CONSENT_VERSION } from "@/lib/consent";
import { collectFiles } from "@/test/design-guards";

// Until 2026-09-10 this product published the opposite promise in six places:
// /privacy headed a section "Sessions are not recorded", the home, signup and
// about pages said "never recorded", and /waiting hedged to a parent at the
// moment of payment that sessions "may be recorded". Recording ships before
// public launch and every published page now states it as fact.
//
// Pinned both ways, in the pattern of profile-claims.test.ts. The denial sweep
// walks the WHOLE app rather than a list, because the first version of this
// file checked six hardcoded paths and a seventh page carrying the old promise
// would have passed it.
//
// Whitespace-collapsed on read: JSX wraps prose wherever the line runs out, so
// "Every session is recorded" is routinely split across two lines and a literal
// match would pass or fail on where a formatter broke it.
const read = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const P = (...p: string[]) => read(join("src", "app", ...p));

const PRIVACY_PATH = join("src", "app", "(marketing)", "privacy", "page.tsx");
const TERMS_PATH = join("src", "app", "(marketing)", "terms", "page.tsx");

const PRIVACY = read(PRIVACY_PATH);
const TERMS = read(TERMS_PATH);
const HOME = P("(marketing)", "page.tsx");
const SIGNUP = P("(marketing)", "signup", "page.tsx");
const ABOUT = P("(marketing)", "about", "page.tsx");
const WAITING = P("(app)", "(student)", "waiting", "[sessionId]", "waiting-client.tsx");
const CONSENT_FORM = P("(gate)", "consent", "consent-form.tsx");
const SIGNUP_FORM = P("(marketing)", "signup", "signup-form.tsx");
const TUTOR_FORM = P("(marketing)", "tutor-signup", "tutor-form.tsx");
const C = (...p: string[]) => read(join("src", "components", ...p));

// Every one of these is a statement about what WE do. Deliberately not a bare
// /not record/, which would also match the terms clause forbidding a *user*
// from recording — that clause is still true and has to stay. "may be
// recorded" is here too: a hedge is as wrong now as a denial, and it is the
// exact wording that sat on the payment screen.
const CONTRADICTS_RECORDING = [
  /not recorded/i,
  /never recorded/i,
  /n[o']t recorded/i,
  /we do ?n[o']t record/i,
  /not store a copy/i,
  /nothing is stored or replayed/i,
  /may be recorded/i,
];

describe("no page anywhere in the app denies or hedges that we record", () => {
  // skipTests defaults true, so this file's own regexes are not swept.
  const files = collectFiles(join("src", "app"), { extensions: [".tsx", ".ts"] });

  it("has a meaningful number of files to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("carries no surviving claim that a session goes unrecorded", () => {
    for (const f of files) {
      const src = read(f);
      for (const pattern of CONTRADICTS_RECORDING) {
        expect(src, `${f} carries ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

// Each of the six pages must positively SAY it, not merely fail to deny it.
// Three of them carry the claim as one entry in an array or half a sentence —
// the easiest things in the change to delete by accident, and the first
// version of this file would have stayed green if they were.
describe("every surface states recording positively", () => {
  const RECORDS = /(every|each) (session|lesson) is recorded|we record every/i;

  for (const [name, src] of Object.entries({
    "/privacy": PRIVACY,
    "/terms": TERMS,
    "the home page": HOME,
    "/signup": SIGNUP,
    "/about": ABOUT,
    "/waiting": WAITING,
  })) {
    it(`${name} says it`, () => {
      expect(src, `${name} no longer claims recording at all`).toMatch(RECORDS);
    });
  }
});

describe("/privacy states the whole of what was decided", () => {
  it("lists recordings among what we collect", () => {
    expect(PRIVACY).toMatch(/session recordings:/i);
  });

  // The commitments the copy makes on our behalf. None is built yet; naming
  // them here is what makes them requirements the recording feature has to
  // meet rather than sentences someone wrote once. project_state.md
  // "Recording policy" carries the same list.
  it("names the access rule, the encryption and the log", () => {
    expect(PRIVACY, "no encryption claim").toMatch(/encrypted/i);
    expect(PRIVACY, "no report-gated access rule").toMatch(/unless a report/i);
    expect(PRIVACY, "no access log").toMatch(/access to a recording is logged/i);
  });

  it("names the retention period and the exception for an open report", () => {
    expect(PRIVACY).toMatch(/30 days/);
    expect(PRIVACY).toMatch(/kept until that report is resolved/i);
  });

  // A policy saying "we hold video of your child" has to say who else holds
  // it. The processors section used to claim everything lived in Supabase.
  it("says who actually holds the video", () => {
    expect(PRIVACY, "Daily.co is not named as holding recordings").toMatch(
      /Daily\.co[^.]*records and stores it/i
    );
  });

  // Deleting an account does not beat the 30-day timer, and the person most
  // likely to delete an account is the one who most needs to know that.
  it("says recordings outlive a deleted account", () => {
    expect(PRIVACY).toMatch(/Recordings, for up to 30 days/i);
  });

  // "Withdraw consent at any time" against "no lesson can be taken
  // unrecorded" is a contradiction unless the page says what withdrawal means.
  it("says what withdrawing consent actually does", () => {
    expect(PRIVACY).toMatch(/withdrawing it means closing the account/i);
  });
});

describe("/terms binds both parties, not just the student", () => {
  it("states that we record every session", () => {
    expect(TERMS).toMatch(/every session is recorded/i);
  });

  it("still forbids the user from making their own recording", () => {
    expect(TERMS).toMatch(/may not record/i);
  });

  // The tutor is the adult in the video and is linked straight to
  // #tutor-agreement from their own signup form. The recording clause first
  // shipped inside the Student Code of Conduct only.
  it("tells the tutor they are recorded too, in the tutor agreement", () => {
    const tutorAgreement = TERMS.split(/Student Code of Conduct/)[0];
    expect(tutorAgreement, "the tutor agreement never mentions recording").toMatch(
      /You Are Recorded Too/i
    );
  });
});

describe("the payment step", () => {
  it("states recording as fact, not as a possibility", () => {
    expect(WAITING).toMatch(/every session is recorded/i);
  });

  // The recording sentence and the guardian confirmation shared one paragraph,
  // so rewriting the first must not drop the second — and must not leave the
  // "or 18 or older" half that 2026-09-05-guardian retired, which an earlier
  // version of this assertion was loose enough to accept.
  it("takes a guardian confirmation with no 18-or-older escape", () => {
    expect(WAITING).toMatch(/parent or legal guardian/i);
    expect(WAITING, "the pre-guardian wording survived the rewrite").not.toMatch(
      /18 or older/i
    );
  });
});

// A guardian signed up on 2026-09-10 and reported never seeing the recording
// policy before submitting. They were right: the signup page carried it in an
// ASSURANCES column beside the form, and the consent checkbox only linked to
// /privacy and /terms. The tick is the moment consent is recorded, so the
// substance has to be next to the tick — not one column over, and not behind a
// link.
describe("every form that takes consent states the policy on the page", () => {
  const NOTICE = C("recording-notice.tsx");

  it("the notice carries the substance, not just a heading", () => {
    expect(NOTICE, "no encryption claim").toMatch(/encrypted/i);
    expect(NOTICE, "no report-gated access rule").toMatch(/unless a report/i);
    expect(NOTICE, "no retention period").toMatch(/30 days/);
  });

  for (const [name, src] of Object.entries({
    "the student signup form": SIGNUP_FORM,
    "the tutor application form": TUTOR_FORM,
    "the consent gate": CONSENT_FORM,
  })) {
    it(`${name} renders it`, () => {
      expect(src, `${name} takes consent without showing the policy`).toMatch(
        /<RecordingNotice/
      );
    });
  }

  // One source of truth. Three hand-written copies of a policy sentence is how
  // they drift, and drift in THIS sentence is a consent record that misstates
  // what was agreed to.
  it("is not duplicated by hand in any form", () => {
    for (const [name, src] of Object.entries({
      "the student signup form": SIGNUP_FORM,
      "the tutor application form": TUTOR_FORM,
      "the consent gate": CONSENT_FORM,
    })) {
      expect(src, `${name} inlines the policy text instead of using the notice`).not.toMatch(
        /deleted after 30 days/i
      );
    }
  });
});

describe("the consent screen delivers the change it is gating on", () => {
  // Re-gating every account to collect agreement, on a screen that never says
  // what changed, produces a consent_events row asserting agreement to a
  // policy the user was shown no word of.
  it("tells a returning user what changed", () => {
    expect(CONSENT_FORM).toMatch(/What changed: we now record every session/i);
    expect(CONSENT_FORM, "the notice must be for returning users only").toMatch(
      /returning &&/
    );
  });

  it("does not tell a tutor we need their parent's agreement", () => {
    expect(CONSENT_FORM).toMatch(/role === "student"[\s\S]*parent or guardian/);
  });
});

// The policy text and the consent version are pinned to each other by
// fingerprint, not by a phrase. The first version of this file asserted only
// that CONSENT_VERSION contained "recording" — true forever after this commit,
// so the NEXT material change (retention 30 -> 90 days, widening the access
// rule) would have shipped with no bump and a green suite.
//
// Editing /privacy or /terms now fails this test by design. That failure is
// the question "is this material?" being asked out loud: if it is, bump
// CONSENT_VERSION so every account re-agrees; if it is genuinely cosmetic,
// update the fingerprint in the same commit and say why.
describe("the published policy and the consent version move together", () => {
  const POLICY_FINGERPRINT = "ab882f154809e2fd";
  const CONSENT_VERSION_AT_FINGERPRINT = "2026-09-10-recording";

  const actual = createHash("sha256")
    .update(PRIVACY.trim() + " " + TERMS.trim())
    .digest("hex")
    .slice(0, 16);

  it("has not changed /privacy or /terms without a decision about consent", () => {
    expect(
      actual,
      `/privacy or /terms changed. If the change is MATERIAL, bump CONSENT_VERSION (currently "${CONSENT_VERSION}") so every existing account re-agrees, and update POLICY_FINGERPRINT to ${actual}. If it is cosmetic, update POLICY_FINGERPRINT to ${actual} alone and note why in the commit.`
    ).toBe(POLICY_FINGERPRINT);
  });

  it("records which consent version the fingerprinted policy belongs to", () => {
    expect(CONSENT_VERSION).toBe(CONSENT_VERSION_AT_FINGERPRINT);
  });
});
