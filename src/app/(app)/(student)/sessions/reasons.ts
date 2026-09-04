// Mirrors the check constraint in migration 0016. Changing one without the
// other gives the user an opaque database error instead of a clean refusal.
//
// Deliberately NOT in actions.ts: that file is "use server", where only async
// functions may be exported. A const there empties the module at build time,
// and tsc does not catch it.
export const REPORT_REASONS = [
  "no_show", "left_early", "technical", "teaching_quality", "conduct", "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
