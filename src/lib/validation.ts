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

// Hosts YouTube actually serves videos from. Checked against URL.hostname and
// never by substring: "notyoutube.com" and "youtube.com.evil.tld" both
// contain "youtube.com", and a demo video is the one artefact a vetting
// operator opens for a stranger who wants to be put in front of a child.
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

// YouTube ids have been exactly 11 characters of [A-Za-z0-9_-] for the
// platform's entire life. Pinning the length is what turns a typo into a
// rejection at signup rather than a dead link in front of an operator.
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The video id in a YouTube URL, or null if this is not one.
 *
 * Accepts every shape a teacher can plausibly paste: watch links, youtu.be
 * short links, /shorts/ and /embed/, the mobile host, with or without www,
 * over http or https, and — importantly — carrying the ?si= tracking
 * parameter that YouTube's own "Share -> Copy link" appends. Rejecting that
 * last one would fail every teacher who followed our instructions exactly.
 */
export type DemoVideoRejection = "not-youtube" | "bad-id";

/**
 * Why a link was refused, or the id if it was accepted.
 *
 * The two failures need different words. Production held
 * "https://www.youtube.com/watch?v=abc123" — a real YouTube host carrying a
 * six-character id, where every real one is eleven. Telling that teacher to
 * "enter a YouTube link" is telling them to do what they have already done,
 * and they would reasonably conclude the form is broken rather than the link.
 */
export function inspectDemoVideoUrl(
  raw: string
): { ok: true; id: string } | { ok: false; reason: DemoVideoRejection } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "not-youtube" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "not-youtube" };
  }

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return { ok: false, reason: "not-youtube" };

  const segments = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;

  if (host === "youtu.be" || host === "www.youtu.be") {
    id = segments[0] ?? null;
  } else if (segments[0] === "watch") {
    id = url.searchParams.get("v");
  } else if (segments[0] === "shorts" || segments[0] === "embed" || segments[0] === "v") {
    id = segments[1] ?? null;
  }

  if (!id || !YOUTUBE_ID.test(id)) return { ok: false, reason: "bad-id" };
  return { ok: true, id };
}

/** The id, or null. Thin wrapper over inspectDemoVideoUrl. */
export function youTubeVideoId(raw: string): string | null {
  const r = inspectDemoVideoUrl(raw);
  return r.ok ? r.id : null;
}

/**
 * One stored shape for every accepted link. Storing canonical means /admin
 * always renders the same URL regardless of which form the teacher pasted,
 * and the share tracking parameter never reaches the database.
 */
export function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * curricula × grades × subject-pairs -> one teacher_subjects row per
 * combination, with the taxonomy checked.
 *
 * Extracted so signup and the 0027 subject-change request expand and validate
 * identically. A request that accepted something signup rejects would be a way
 * around signup.
 */
function expandSubjects(fd: FormData): Result<SubjectRow[]> {
  const curricula = all(fd, "curricula");
  if (curricula.length === 0) return fail("Select at least one curriculum.");
  if (!curricula.every(isCurriculum)) return fail("Select a valid curriculum.");

  const grades = all(fd, "grades");
  if (grades.length === 0) return fail("Select at least one grade.");
  if (!grades.every(isGrade)) return fail("Select a valid grade.");

  const pairs = all(fd, "subjects");
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
  return { ok: true, value: subjects };
}

// Subjects arrive as repeated "subjects" entries encoded "Stream|Subject";
// curricula and grades as repeated checkbox entries. The three are expanded into
// one row per (curriculum, grade, stream, subject) — the shape teacher_subjects
// stores, and what the browse filter queries against.
//
// Shared by parseTutorSignUp and parseTeacherProfile so signup and editing
// validate a rate, a qualification, or a subject list identically — this is
// the ONLY place either one may define what "valid" means for these fields.
function parseTeacherProfileFields(
  fd: FormData,
  // Signup collects subjects; the profile editor no longer does. 0027 made
  // subjects changeable only through a request an admin approves, so the
  // profile form shows them read-only and submits nothing — and requiring
  // them here would reject every profile save.
  { requireSubjects = true }: { requireSubjects?: boolean } = {}
): Result<TeacherProfileFields> {
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

  // Was /^https?:\/\//, which accepted any URL on the internet. Google Drive
  // is deliberately no longer accepted: a Drive link can be un-shared after
  // an operator approves it, so what was vetted and what a student later sees
  // are not the same artefact.
  const inspected = inspectDemoVideoUrl(str(fd, "demoVideoUrl"));
  if (!inspected.ok)
    return fail(
      inspected.reason === "bad-id"
        ? "That YouTube link has no video in it. Open the video on YouTube, press Share, then Copy, and paste what you get — the link ends in an 11-character video id."
        : "Enter a YouTube link for your demo video (youtube.com or youtu.be). Other hosts aren't accepted."
    );
  const demoVideoUrl = canonicalYouTubeUrl(inspected.id);

  // requireSubjects is checked BEFORE expanding, so signup's specific
  // "you won't appear in search" wording survives — expandSubjects has no way
  // to know which caller it is serving.
  if (requireSubjects && all(fd, "subjects").length === 0)
    return fail("Select at least one subject — with none, you won't appear in search.");

  const expanded = expandSubjects(fd);
  if (!expanded.ok) return expanded;
  const subjects = expanded.value;

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

// Order is pinned by a test: fullName, then consent, email and password,
// before any of the profile fields (phone onward) get a chance to fail. That
// is the order this function checked them in before parseTeacherProfileFields
// existed — the extraction below moved consent/email/password to run AFTER
// every profile field instead, so a signup missing several things silently
// started reporting a different first error. Restoring it costs one
// duplicated line (the fullName-empty check also runs inside
// parseTeacherProfileFields): a trivial, unlikely-to-drift rule, unlike the
// rate/qualification/hours-per-week rules that extraction exists to keep in
// one place, which stay defined only there.
// fullName and consent, checked BEFORE anything else and in this order.
//
// The ordering is load-bearing and has regressed once already: an earlier
// extraction moved consent/email/password to run AFTER every profile field,
// and a signup missing several things silently began reporting a different
// first error. Keeping the preamble separate from parseTeacherProfileFields
// costs one duplicated fullName check — trivial and unlikely to drift, unlike
// the rate/qualification/hours rules that extraction exists to keep in one
// place, which stay defined only there.
function parseTutorPreamble(fd: FormData): string | null {
  if (!str(fd, "fullName")) return "Enter your full name.";

  // Checked on the SERVER, exactly as parseStudentSignUp does, and for the
  // same reason: 0014 fixed the student box and missed this one, so tutor
  // consent stayed browser-only decoration and was never recorded at all.
  // Requiring it here is what makes a missing `name` on the checkbox fail
  // loudly instead of shipping silently a second time.
  if (!fd.get("consent")) {
    return "Please agree to the Terms of Service and Tutor Agreement.";
  }
  return null;
}

/**
 * The signed-OUT route: this form creates the account, so it needs
 * credentials. Their checks sit between the preamble and the profile fields,
 * which is where they have always sat.
 */
export function parseTutorSignUp(fd: FormData): Result<TutorSignUp> {
  const preamble = parseTutorPreamble(fd);
  if (preamble) return fail(preamble);

  const email = str(fd, "email");
  if (!email.includes("@")) return fail("Enter a valid email address.");

  const password = raw(fd, "password");
  if (password.length < 8)
    return fail("Password must be at least 8 characters.");

  const fields = parseTeacherProfileFields(fd);
  if (!fields.ok) return fields;

  return { ok: true, value: { email, password, ...fields.value } };
}

/**
 * The signed-IN route: signUpTutor upgrades the existing account through
 * become_teacher and never reads an email or a password, so demanding them
 * made a signed-in student invent a throwaway password — one they could
 * reasonably believe had replaced their real one.
 *
 * Which parser runs is decided by the SERVER from the session, never by a
 * field the client sends, so a signed-out caller cannot reach this one and
 * skip creating credentials.
 */
export function parseTutorUpgrade(fd: FormData): Result<TeacherProfileFields> {
  const preamble = parseTutorPreamble(fd);
  if (preamble) return fail(preamble);
  return parseTeacherProfileFields(fd);
}

const MAX_BIO_LENGTH = 1000;

// Editing, not signup: email is auth-managed and role is immutable by design
// (migration 0013), so neither is read here even if a form sent them.
export function parseTeacherProfile(fd: FormData): Result<TeacherProfile> {
  const fields = parseTeacherProfileFields(fd, { requireSubjects: false });
  if (!fields.ok) return fields;

  const bioRaw = str(fd, "bio");
  if (bioRaw.length > MAX_BIO_LENGTH)
    return fail(`Bio must be ${MAX_BIO_LENGTH} characters or fewer.`);

  return { ok: true, value: { ...fields.value, bio: bioRaw || null } };
}

// Setting a password after a recovery link. Same floor as signup: a reset that
// accepted something weaker would be the cheapest way to downgrade an account.
//
// raw(), not str(): a password is not trimmed. Leading and trailing spaces are
// legitimate characters, and stripping them stores something the person did not
// type — which then fails to sign them in, with no visible reason.
export function parseNewPassword(
  fd: FormData
): Result<{ password: string }> {
  const password = raw(fd, "password");
  const confirm = raw(fd, "confirmPassword");
  if (password.length < 8)
    return fail("Password must be at least 8 characters.");
  if (password !== confirm) return fail("Passwords do not match.");
  return { ok: true, value: { password } };
}

export interface SubjectChangeRequest {
  subjects: SubjectRow[];
  demoVideoUrl: string;
}

/**
 * A teacher's request to change what they teach (0027).
 *
 * Validates exactly as signup does — same taxonomy expansion, same YouTube
 * rule — because a request that could carry something the signup form rejects
 * would be a way around the signup form. The demo video is REQUIRED and is the
 * point: the admin is being asked to approve a claim to teach something new,
 * and needs to watch the teacher teach it.
 */
export function parseSubjectChangeRequest(
  fd: FormData
): Result<SubjectChangeRequest> {
  const inspected = inspectDemoVideoUrl(str(fd, "demoVideoUrl"));
  if (!inspected.ok)
    return fail(
      inspected.reason === "bad-id"
        ? "That YouTube link has no video in it. Open the video on YouTube, press Share, then Copy, and paste what you get — the link ends in an 11-character video id."
        : "Add a YouTube link showing you teaching the new subjects (youtube.com or youtu.be)."
    );

  const subjects = expandSubjects(fd);
  if (!subjects.ok) return subjects;
  if (subjects.value.length === 0)
    return fail("Select at least one subject to request.");

  return {
    ok: true,
    value: {
      subjects: subjects.value,
      demoVideoUrl: canonicalYouTubeUrl(inspected.id),
    },
  };
}
