// The grade domain, in one place. The database states it three times already
// (sessions 0002, teacher_subjects 0001, profiles 0018) because a check
// constraint cannot reference another table's; this is the TypeScript copy the
// forms and parsers share, so there is exactly one more and not five.
export const GRADES = [
  "6th", "7th", "8th", "9th", "10th", "11th", "12th",
] as const;

export type Grade = (typeof GRADES)[number];

export function isGrade(value: string): value is Grade {
  return (GRADES as readonly string[]).includes(value);
}

// Bump when the consent wording changes materially, so an old agreement is
// never silently read as agreement to new terms. "2026-09-05-guardian" is the
// guardian rewrite: the holder is now the parent or legal guardian, not
// "parent OR 18+".
//
// Lives here rather than in validation.ts because validation.ts imports
// isGrade from this module; putting the constant there too would make the two
// files import each other.
export const CONSENT_VERSION = "2026-09-05-guardian";
