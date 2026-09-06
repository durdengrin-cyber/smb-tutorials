// Pure parsing/validation for the M1 auth + onboarding forms. No I/O — Server
// Actions call these before touching Supabase, so the rules stay unit-testable.

import {
  isCurriculum,
  isStream,
  isSubjectOf,
  type Curriculum,
  type Stream,
} from "./taxonomy";
// Grade comes from consent.ts (which re-exports it from taxonomy.ts) rather
// than straight from taxonomy.ts, because parseStudentSignUp needs consent.ts
// anyway for learnerGrade — importing the same names from both modules here
// would collide. parseTutorSignUp's grade checks reuse this same import.
import { isGrade, type Grade } from "./consent";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type TeachingLevel = "school" | "college" | "both";
export type HoursPerWeek = "5-10" | "10-20" | "20-30" | "30-40" | "40+";

const TEACHING_LEVELS: readonly string[] = ["school", "college", "both"];
const HOURS_PER_WEEK: readonly string[] = [
  "5-10",
  "10-20",
  "20-30",
  "30-40",
  "40+",
];

export interface SubjectRow {
  curriculum: Curriculum;
  grade: Grade;
  stream: Stream;
  subject: string;
}

// Shared by both sign-up shapes so that adding a student-only field (the
// learner) does not force TutorSignUp — a tutor has no learner — to carry it
// too, the way `TutorSignUp extends StudentSignUp` used to.
interface AccountBasics {
  fullName: string;
  email: string;
  password: string;
}

export interface StudentSignUp extends AccountBasics {
  learnerFirstName: string;
  learnerGrade: Grade;
}

// The profile half of a teacher account — everything both signup and
// editing must validate identically, so a rate or qualification cannot be
// "valid" at signup and rejected on edit, or vice versa.
export interface TeacherProfileFields {
  fullName: string;
  phone: string;
  experienceYears: number;
  qualification: string;
  specialization: string | null;
  teachingLevel: TeachingLevel | null;
  hourlyRate: number;
  hoursPerWeek: HoursPerWeek;
  demoVideoUrl: string;
  subjects: SubjectRow[];
}

export interface TutorSignUp extends AccountBasics, TeacherProfileFields {}

// `bio` exists only on the editable profile — signup collects no bio field
// today, so there is nothing for a shared helper to drift on there.
export interface TeacherProfile extends TeacherProfileFields {
  bio: string | null;
}

const fail = (error: string): Result<never> => ({ ok: false, error });
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
const raw = (fd: FormData, k: string) => (fd.get(k) ?? "").toString();
const all = (fd: FormData, k: string) => fd.getAll(k).map((v) => v.toString());

// Number("") is 0, so digits are checked before conversion.
const wholeNumber = (s: string): number | null =>
  /^\d+$/.test(s) ? Number(s) : null;

export function parseSignIn(
  fd: FormData
): Result<{ email: string; password: string }> {
  const email = str(fd, "email");
  const password = raw(fd, "password");
  if (!email.includes("@")) return fail("Enter a valid email address.");
  if (!password) return fail("Enter your password.");
  return { ok: true, value: { email, password } };
}

export function parseStudentSignUp(fd: FormData): Result<StudentSignUp> {
  const fullName = str(fd, "fullName");
  const email = str(fd, "email");
  const password = raw(fd, "password");
  const confirm = raw(fd, "confirmPassword");
  if (!fullName) return fail("Enter your full name.");
  if (!email.includes("@")) return fail("Enter a valid email address.");
  if (password.length < 8)
    return fail("Password must be at least 8 characters.");
  if (password !== confirm) return fail("Passwords do not match.");

  const learnerFirstName = str(fd, "learnerFirstName");
  if (!learnerFirstName) return fail("Enter the student's first name.");

  const learnerGrade = str(fd, "learnerGrade");
  if (!isGrade(learnerGrade)) return fail("Select the student's grade.");

  // Checked on the SERVER, not just by the browser. The box existed before
  // this but carried no `name`, so it never left the page: `required` stops a
  // human in a browser and stops nothing else. A consent record that any
  // non-browser client can skip is not a record.
  if (!fd.get("consent")) {
    return fail("Please confirm you're the parent or guardian, or 18 or older.");
  }
  return {
    ok: true,
    value: { fullName, email, password, learnerFirstName, learnerGrade },
  };
}

// Subjects arrive as repeated "subjects" entries encoded "Stream|Subject";
// curricula and grades as repeated checkbox entries. The three are expanded into
// one row per (curriculum, grade, stream, subject) — the shape teacher_subjects
// stores, and what the browse filter queries against.
//
// Shared by parseTutorSignUp and parseTeacherProfile so signup and editing
// validate a rate, a qualification, or a subject list identically — this is
// the ONLY place either one may define what "valid" means for these fields.
function parseTeacherProfileFields(fd: FormData): Result<TeacherProfileFields> {
  const fullName = str(fd, "fullName");
  if (!fullName) return fail("Enter your full name.");

  const phone = str(fd, "phone");
  if (!/^\d{10}$/.test(phone)) return fail("Enter a 10-digit phone number.");

  const experienceYears = wholeNumber(str(fd, "experience"));
  if (experienceYears === null)
    return fail("Years of experience must be a whole number.");

  const qualification = str(fd, "qualification");
  if (!qualification) return fail("Enter your highest qualification.");

  const specialization = str(fd, "specialization") || null;

  const level = str(fd, "teachingLevel");
  if (level && !TEACHING_LEVELS.includes(level))
    return fail("Select a valid teaching level.");
  const teachingLevel = (level || null) as TeachingLevel | null;

  const hourlyRate = wholeNumber(str(fd, "hourlyRate"));
  if (hourlyRate === null || hourlyRate <= 0)
    return fail("Hourly rate must be a positive whole number.");

  const hoursPerWeek = str(fd, "hoursPerWeek");
  if (!HOURS_PER_WEEK.includes(hoursPerWeek))
    return fail("Select your available hours per week.");

  const demoVideoUrl = str(fd, "demoVideoUrl");
  if (!/^https?:\/\//.test(demoVideoUrl))
    return fail("Enter a valid demo video link.");

  const curricula = all(fd, "curricula");
  if (curricula.length === 0) return fail("Select at least one curriculum.");
  if (!curricula.every(isCurriculum)) return fail("Select a valid curriculum.");

  const grades = all(fd, "grades");
  if (grades.length === 0) return fail("Select at least one grade.");
  if (!grades.every(isGrade)) return fail("Select a valid grade.");

  const pairs = all(fd, "subjects");
  // A teacher with zero subjects is invisible in search and has no other way
  // to find out why (this rejection is reachable from the profile-editing
  // form as well as signup, so it has to explain itself both times).
  if (pairs.length === 0)
    return fail("Select at least one subject — with none, you won't appear in search.");

  const subjects: SubjectRow[] = [];
  const seen = new Set<string>();
  for (const pair of pairs) {
    const [stream, subject] = pair.split("|");
    if (!isStream(stream) || !isSubjectOf(stream, subject ?? "")) {
      return fail(`"${pair}" is not a subject we offer.`);
    }
    for (const curriculum of curricula as Curriculum[]) {
      for (const grade of grades as Grade[]) {
        const key = `${curriculum}|${grade}|${stream}|${subject}`;
        if (seen.has(key)) continue;
        seen.add(key);
        subjects.push({ curriculum, grade, stream, subject });
      }
    }
  }

  return {
    ok: true,
    value: {
      fullName,
      phone,
      experienceYears,
      qualification,
      specialization,
      teachingLevel,
      hourlyRate,
      hoursPerWeek: hoursPerWeek as HoursPerWeek,
      demoVideoUrl,
      subjects,
    },
  };
}

export function parseTutorSignUp(fd: FormData): Result<TutorSignUp> {
  const fields = parseTeacherProfileFields(fd);
  if (!fields.ok) return fields;

  // Checked on the SERVER, exactly as parseStudentSignUp does, and for the
  // same reason: 0014 fixed the student box and missed this one, so tutor
  // consent stayed browser-only decoration and was never recorded at all.
  // Requiring it here is what makes a missing `name` on the checkbox fail
  // loudly instead of shipping silently a second time.
  if (!fd.get("consent")) {
    return fail("Please agree to the Terms of Service and Tutor Agreement.");
  }

  const email = str(fd, "email");
  if (!email.includes("@")) return fail("Enter a valid email address.");

  const password = raw(fd, "password");
  if (password.length < 8)
    return fail("Password must be at least 8 characters.");

  return { ok: true, value: { email, password, ...fields.value } };
}

const MAX_BIO_LENGTH = 1000;

// Editing, not signup: email is auth-managed and role is immutable by design
// (migration 0013), so neither is read here even if a form sent them.
export function parseTeacherProfile(fd: FormData): Result<TeacherProfile> {
  const fields = parseTeacherProfileFields(fd);
  if (!fields.ok) return fields;

  const bioRaw = str(fd, "bio");
  if (bioRaw.length > MAX_BIO_LENGTH)
    return fail(`Bio must be ${MAX_BIO_LENGTH} characters or fewer.`);

  return { ok: true, value: { ...fields.value, bio: bioRaw || null } };
}
