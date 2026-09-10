import { GRADES, type Grade } from "./taxonomy";

/**
 * Collapses teacher_subjects rows into something a person can read.
 *
 * A teacher who teaches two subjects across four grades has EIGHT rows, and
 * rendering them verbatim produced a wall of near-identical text on /admin —
 * "Physics · CBSE · 9th · Science · Physics · CBSE · 10th · Science · …" — that
 * made a single teacher a page tall and buried the decision the operator was
 * there to make.
 *
 * Grades are the only axis that repeats, so they are the only axis collapsed:
 * contiguous runs become "9th–12th", gaps stay explicit as "9th, 11th". Subject,
 * curriculum and stream identify the listing and are never merged, because two
 * curricula are two different listings to a student.
 */
export interface SubjectRow {
  curriculum: string;
  grade: string;
  stream: string | null;
  subject: string;
}

const GRADE_ORDER = new Map<string, number>(GRADES.map((g, i) => [g, i]));

/** "9th, 10th, 11th, 12th" -> "9th–12th"; "9th, 11th" stays "9th, 11th". */
export function collapseGrades(grades: string[]): string {
  const known = [...new Set(grades)]
    .filter((g): g is Grade => GRADE_ORDER.has(g))
    .sort((a, b) => GRADE_ORDER.get(a)! - GRADE_ORDER.get(b)!);
  // Anything outside the taxonomy is passed through rather than dropped: a
  // value the database holds and this module does not know about is a fact the
  // operator still needs to see.
  const unknown = [...new Set(grades)].filter((g) => !GRADE_ORDER.has(g)).sort();

  const parts: string[] = [];
  let runStart = 0;
  for (let i = 0; i <= known.length; i++) {
    const isEnd =
      i === known.length ||
      GRADE_ORDER.get(known[i])! !== GRADE_ORDER.get(known[i - 1])! + 1;
    if (i > 0 && isEnd) {
      const from = known[runStart];
      const to = known[i - 1];
      // A run of two is written out: "9th–10th" is no shorter than "9th, 10th"
      // and reads as a range where there is none worth naming.
      parts.push(
        from === to
          ? from
          : i - 1 - runStart >= 2
            ? `${from}–${to}`
            : `${from}, ${to}`
      );
      runStart = i;
    }
  }
  return [...parts, ...unknown].join(", ");
}

export interface SubjectSummaryLine {
  subject: string;
  curriculum: string;
  stream: string | null;
  grades: string;
}

/** One line per (subject, curriculum, stream), grades collapsed. */
export function summariseSubjects(rows: SubjectRow[]): SubjectSummaryLine[] {
  const groups = new Map<string, { row: SubjectRow; grades: string[] }>();
  for (const r of rows) {
    const key = `${r.subject}|${r.curriculum}|${r.stream ?? ""}`;
    const existing = groups.get(key);
    if (existing) existing.grades.push(r.grade);
    else groups.set(key, { row: r, grades: [r.grade] });
  }
  return [...groups.values()]
    .map(({ row, grades }) => ({
      subject: row.subject,
      curriculum: row.curriculum,
      stream: row.stream,
      grades: collapseGrades(grades),
    }))
    .sort(
      (a, b) =>
        a.subject.localeCompare(b.subject) ||
        a.curriculum.localeCompare(b.curriculum)
    );
}
