// Shared by the auth Server Actions. It lives outside them because a
// "use server" module may only export async functions.
//
// React 19 resets an uncontrolled form when its `action` completes, so an
// action that returns only { error } hands the user back a BLANK form. On the
// tutor application that meant fifteen fields and four chip groups lost to one
// mistyped character; measured in a browser on 2026-09-09, every field came
// back empty. Next's own forms guide shows the same shape and does not mention
// it, so the values have to be carried back deliberately.
//
// NO ECHO TYPE BELOW CARRIES A PASSWORD, and none ever should. Echoing one
// would write it into the server-rendered HTML of the retry, which is a worse
// problem than retyping it.

/**
 * `V = never` is deliberate: an action that does not opt into echoing cannot
 * accidentally return values, because `values?: never` accepts only undefined.
 */
export type FormState<V = never> = { error: string; values?: V } | null;

/** Sign-in and the consent gate: nothing worth echoing, and nothing allowed. */
export type AuthState = FormState;

export interface TutorFormValues {
  fullName: string;
  email: string;
  phone: string;
  experience: string;
  qualification: string;
  specialization: string;
  teachingLevel: string;
  hourlyRate: string;
  hoursPerWeek: string;
  demoVideoUrl: string;
  curricula: string[];
  grades: string[];
  subjects: string[];
  consent: boolean;
}
export type TutorFormState = FormState<TutorFormValues>;

export interface StudentFormValues {
  fullName: string;
  learnerFirstName: string;
  learnerGrade: string;
  email: string;
  consent: boolean;
}
export type StudentFormState = FormState<StudentFormValues>;

export interface TeacherProfileValues {
  fullName: string;
  phone: string;
  experience: string;
  qualification: string;
  specialization: string;
  teachingLevel: string;
  hourlyRate: string;
  hoursPerWeek: string;
  demoVideoUrl: string;
  bio: string;
  curricula: string[];
  grades: string[];
  subjects: string[];
}
export type TeacherProfileState = FormState<TeacherProfileValues>;

const text = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const list = (fd: FormData, k: string): string[] =>
  fd.getAll(k).filter((v): v is string => typeof v === "string");
const texts = <K extends string>(fd: FormData, keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, text(fd, k)])) as Record<K, string>;

// Each builder reads back what was TYPED, not what was parsed — including the
// value that was rejected — so the user can see what the form objected to
// rather than guessing at a blank field.

const TUTOR_TEXT = [
  "fullName", "email", "phone", "experience", "qualification",
  "specialization", "teachingLevel", "hourlyRate", "hoursPerWeek",
  "demoVideoUrl",
] as const;

export function echoTutorForm(fd: FormData): TutorFormValues {
  return {
    ...texts(fd, TUTOR_TEXT),
    curricula: list(fd, "curricula"),
    grades: list(fd, "grades"),
    subjects: list(fd, "subjects"),
    consent: Boolean(fd.get("consent")),
  };
}

const STUDENT_TEXT = ["fullName", "learnerFirstName", "learnerGrade", "email"] as const;

export function echoStudentForm(fd: FormData): StudentFormValues {
  return {
    ...texts(fd, STUDENT_TEXT),
    consent: Boolean(fd.get("consent")),
  };
}

const PROFILE_TEXT = [
  "fullName", "phone", "experience", "qualification", "specialization",
  "teachingLevel", "hourlyRate", "hoursPerWeek", "demoVideoUrl", "bio",
] as const;

export function echoTeacherProfile(fd: FormData): TeacherProfileValues {
  return {
    ...texts(fd, PROFILE_TEXT),
    curricula: list(fd, "curricula"),
    grades: list(fd, "grades"),
    subjects: list(fd, "subjects"),
  };
}
