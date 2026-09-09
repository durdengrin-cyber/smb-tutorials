// Shared by the auth Server Actions. It lives outside them because a
// "use server" module may only export async functions.

/**
 * Everything the tutor application collected, echoed back so a validation
 * error does not erase it.
 *
 * React 19 resets an uncontrolled form when its `action` completes, so a
 * rejected submission returned a blank form: a teacher who mistyped one
 * character of a YouTube link had to retype fifteen fields, including every
 * curriculum, grade and subject chip. Measured on 2026-09-09 — every single
 * field came back empty. Next's own forms guide shows the same shape and does
 * not mention it, so this is not a misuse of the API; the values have to be
 * carried back deliberately.
 *
 * There is no `password` field here, and there must never be one. Echoing a
 * password would write it into the server-rendered HTML of the retry, which is
 * a worse problem than retyping it.
 */
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

export type AuthState = { error: string; values?: TutorFormValues } | null;

const TEXT_FIELDS = [
  "fullName",
  "email",
  "phone",
  "experience",
  "qualification",
  "specialization",
  "teachingLevel",
  "hourlyRate",
  "hoursPerWeek",
  "demoVideoUrl",
] as const;

/**
 * Reads the submitted form back out for re-display. Deliberately does NOT
 * validate or coerce: the point is to hand the teacher back exactly what they
 * typed, including the part that was wrong, so they can see and correct it
 * rather than guess what the form rejected.
 */
export function echoTutorForm(fd: FormData): TutorFormValues {
  const text = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : "";
  };
  const list = (k: string) =>
    fd.getAll(k).filter((v): v is string => typeof v === "string");

  const values = Object.fromEntries(
    TEXT_FIELDS.map((k) => [k, text(k)])
  ) as Record<(typeof TEXT_FIELDS)[number], string>;

  return {
    ...values,
    curricula: list("curricula"),
    grades: list("grades"),
    subjects: list("subjects"),
    consent: Boolean(fd.get("consent")),
  };
}
