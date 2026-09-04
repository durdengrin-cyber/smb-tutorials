// The grade domain has one TypeScript definition, in taxonomy.ts (a
// dependency-free leaf itself), mirroring three SQL check constraints
// (0001, 0002, 0018) that a check constraint cannot share across tables.
// Re-exported here so the consent path has a single obvious import.
export { GRADES, type Grade, isGrade } from "./taxonomy";

// Bump when the consent wording changes materially, so an old agreement is
// never silently read as agreement to new terms. "2026-09-05-guardian" is the
// guardian rewrite: the holder is now the parent or legal guardian, not
// "parent OR 18+".
//
// Lives here rather than in validation.ts so this module stays a
// dependency-free leaf: anything can import CONSENT_VERSION without dragging
// in the parsers.
export const CONSENT_VERSION = "2026-09-05-guardian";
