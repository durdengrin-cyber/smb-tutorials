import { describe, it, expect } from "vitest";
import { needsConsent, CONSENT_VERSION } from "./consent";

describe("needsConsent", () => {
  // Google sign-in mints an account with consent_accepted_at NULL: OAuth
  // carries no consent and handle_new_user has none to copy. One tap, full
  // access, no agreement. This is the hole the gate exists to close.
  it("is true for an account that has never consented", () => {
    expect(needsConsent({ consentVersion: null })).toBe(true);
  });

  it("is false for an account on the current version", () => {
    expect(needsConsent({ consentVersion: CONSENT_VERSION })).toBe(false);
  });

  // A material change to the wording is a NEW agreement. An old version must
  // never be read as consent to it -- which is the whole reason the column
  // holds a version rather than a boolean.
  it("is true for an account on a superseded version", () => {
    expect(needsConsent({ consentVersion: "2026-09-04" })).toBe(true);
  });
});
