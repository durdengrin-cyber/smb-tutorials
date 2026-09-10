// The grade domain has one TypeScript definition, in taxonomy.ts (a
// dependency-free leaf itself), mirroring three SQL check constraints
// (0001, 0002, 0018) that a check constraint cannot share across tables.
// Re-exported here so the consent path has a single obvious import.
export { GRADES, type Grade, isGrade } from "./taxonomy";

// Bump when the consent wording changes materially, so an old agreement is
// never silently read as agreement to new terms. "2026-09-05-guardian" was
// the guardian rewrite: the holder became the parent or legal guardian, not
// "parent OR 18+".
//
// "2026-09-10-recording" is the recording policy. /privacy and /terms now
// state that every session is recorded and that this is a condition of use —
// about as material as a change gets on a product used by children, so every
// existing agreement predates it and every account is sent back to /consent.
// The pages and this constant are pinned to each other by
// src/app/recording-claims.test.ts: the claim may not outlive the version.
//
// Lives here rather than in validation.ts so this module avoids depending on
// validation.ts and the parsers: anything can import CONSENT_VERSION without
// pulling them in.
export const CONSENT_VERSION = "2026-09-10-recording";

// The one question every entry path asks. A version rather than a boolean,
// because a material change to the wording is a new agreement and an old one
// must not be silently read as consent to it.
export function needsConsent(profile: { consentVersion: string | null }): boolean {
  return profile.consentVersion !== CONSENT_VERSION;
}
