// Indian K-12 taxonomy (spec §7). The DB mirrors these values as CHECK
// constraints in supabase/migrations/0001_profiles_teacher_subjects.sql —
// change one and the other must follow.

export const CURRICULA = ["CBSE", "State Board", "ICSE"] as const;
export const GRADES = ["6th", "7th", "8th", "9th", "10th", "11th", "12th"] as const;
export const STREAMS = ["Science", "Commerce", "Arts"] as const;

export type Curriculum = (typeof CURRICULA)[number];
export type Grade = (typeof GRADES)[number];
export type Stream = (typeof STREAMS)[number];

export const SUBJECTS_BY_STREAM: Record<Stream, readonly string[]> = {
  Science: ["Physics", "Chemistry", "Biology", "Mathematics"],
  Commerce: ["Accountancy", "Business Studies", "Economics", "Mathematics"],
  Arts: ["History", "Geography", "Political Science", "Economics", "Sociology"],
};

export const isCurriculum = (x: string): x is Curriculum =>
  (CURRICULA as readonly string[]).includes(x);

export const isGrade = (x: string): x is Grade =>
  (GRADES as readonly string[]).includes(x);

export const isStream = (x: string): x is Stream =>
  (STREAMS as readonly string[]).includes(x);

export const isSubjectOf = (stream: string, subject: string): boolean =>
  isStream(stream) && SUBJECTS_BY_STREAM[stream].includes(subject);
