# M1 — Auth, Profiles, Taxonomy, Tutor Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase Auth (email + Google) with student/teacher roles, the K-12 taxonomy, teacher onboarding writing `profiles` + `teacher_subjects`, and a real teacher-browse flow — with the demo's home/signin/signup/tutor-signup/find/teachers screens rebuilt faithfully in Next.js.

**Architecture:** Supabase (`@supabase/ssr` cookie-based auth) plugged into the existing Next.js 16 App Router app. A Postgres trigger creates a `profiles` row on every new auth user (role from signup metadata, default `student`). Server Actions handle all form submissions; RLS guards every table. UI screens are faithful Tailwind transcriptions of the demo (`/Users/Tyler/Downloads/SMB-Tutorial-main/src/App.js`), read-only reference.

**Tech Stack:** Next.js 16.3.2 (App Router, **`proxy.ts` not `middleware.ts`**), React 19, Tailwind v4, Supabase (Postgres + Auth + RLS), `@supabase/ssr` + `@supabase/supabase-js`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-smb-tutorials-design.md` (esp. §5 architecture, §7 taxonomy, §8 data model, §10 M1, §13 UI, §15 spike debts)

## Global Constraints

- **Next.js 16 has breaking changes.** Before writing app code, read the relevant guide under `node_modules/next/dist/docs/` (e.g. `01-app/02-guides/authentication.md`, `.../forms.md`, `01-app/03-api-reference/03-file-conventions/proxy.md`). Key facts already verified: `middleware.ts` is **deprecated → `proxy.ts`** (export a function named `proxy`); layouts type as `LayoutProps<"/">`; Server Actions + `useActionState` are the form idiom.
- Serverless only — no always-on server. All server logic = Server Actions / route handlers.
- Secrets live in `.env.local` (gitignored) + Vercel env vars. **Never commit keys.**
- Sync before every push: `git fetch origin main` + rebase. Confirm branch `main` via `git branch --show-current`.
- Demo at `~/Downloads/SMB-Tutorial-main/src/App.js` is **read-only reference**. Transcribe its JSX (Tailwind classes, copy, Unsplash URLs, emoji) faithfully; only the deltas called out per task are allowed.
- New runtime deps limited to: `@supabase/supabase-js`, `@supabase/ssr`. Plain Tailwind for these screens (demo is plain Tailwind; shadcn/ui not needed for M1).
- Visual language: teal→cyan gradients (`from-teal-500 to-cyan-600`), "One Student, One Teacher", `₹{rate}/hr`.
- Taxonomy (exact values, spec §7): Curricula `CBSE, State Board, ICSE` · Grades `6th…12th` · Streams `Science, Commerce, Arts` · Subjects — Science: Physics, Chemistry, Biology, Mathematics; Commerce: Accountancy, Business Studies, Economics, Mathematics; Arts: History, Geography, Political Science, Economics, Sociology.
- Commit style follows repo history (`feat:`/`fix:`/`state:` prefixes), each task ends in a green `npm run test` + commit.

## Decisions locked during planning (with user)

1. **Home page rebuilt in M1** (faithful transcription).
2. **Tutor signup = one form**: demo's tutor-signup + a Password field → creates auth account (`role=teacher`), updates profile, inserts `teacher_subjects`.
3. **Google OAuth included**; one-time manual Google Cloud + Supabase config documented in Task 0.
4. Deliberate deviations from demo (all required by spec §8/§13 or honesty about missing data):
   - Tutor form's free-text "Subjects You Teach" → **structured picker** (curricula × grades × subjects checkboxes) feeding `teacher_subjects` rows.
   - Find screen (demo `form`) drops **date/time** fields (instant-first model; scheduled tier deferred).
   - Teacher cards show **no fake rating/availability** (no ratings exist yet; presence arrives in M2). "Book Now" renders disabled with `title="Instant booking arrives with presence (M2)"`.
   - Taxonomy is **code constants + SQL CHECK constraints**, not a seeded table — no query needs a taxonomy table (YAGNI); DB still rejects invalid values.

## File Structure

```
supabase/migrations/0001_profiles_teacher_subjects.sql   -- schema + RLS + trigger
src/lib/taxonomy.ts            -- taxonomy constants + helpers (tested)
src/lib/taxonomy.test.ts
src/lib/validation.ts          -- pure form-parsing/validation for all M1 forms (tested)
src/lib/validation.test.ts
src/lib/supabase/client.ts     -- browser client
src/lib/supabase/server.ts     -- server client (cookies)
src/lib/supabase/proxy-session.ts  -- updateSession helper used by proxy.ts
src/proxy.ts                   -- Next 16 proxy: session refresh (lives in src/, beside app/)
src/lib/form-state.ts          -- AuthState type shared by both action files
src/components/site-header.tsx -- shared SMB logo header (plain component, no "use client")
src/app/auth/callback/route.ts -- OAuth code exchange
src/app/auth/actions.ts        -- signIn / signUpStudent / signOut Server Actions
src/components/google-button.tsx   -- client: OAuth kickoff button
src/app/signin/page.tsx        -- server: layout + left panel (demo 1300–1448)
src/app/signin/signin-form.tsx -- client: the white card (useActionState)
src/app/signup/page.tsx        -- server: layout + left panel (demo 1451–1614)
src/app/signup/signup-form.tsx -- client: the white card
src/app/tutor-signup/page.tsx  -- server: header + hero (demo 1617–1884)
src/app/tutor-signup/tutor-form.tsx    -- client: the form (+password field)
src/app/tutor-signup/subject-picker.tsx -- client: structured taxonomy checkboxes
src/app/tutor-signup/actions.ts        -- signUpTutor Server Action
src/app/find/page.tsx          -- client: demo 'form' screen 919–1134 (minus date/time)
src/app/teachers/page.tsx      -- server: demo 798–917, real data
src/app/teachers/teacher-card.tsx
src/app/terms/page.tsx         -- demo lines 1887–2120 (static)
src/app/page.tsx               -- home, demo lines 2122–2386 (replaces placeholder)
src/app/api/rooms/route.ts     -- MODIFY: auth gate (spec §15 interim hardening)
```

Two structural rules that shaped this layout — follow them, they are easy to get wrong:

- **Interactive screens split page/form.** `useActionState` requires `"use client"`, and a Client Component cannot render a Server Component child. So each auth screen is a Server Component page (awaits `searchParams`, renders static demo chrome) wrapping a Client Component form. Pages are typed `PageProps<"/signin">` etc. — the Next 16 generated-types idiom already used by `src/app/layout.tsx` (`LayoutProps<"/">`).
- **`SiteHeader` is a plain component** — no `"use client"`, not `async`, no server-only imports (just JSX + `next/link`). That is what lets both Server pages (teachers, terms) and Client pages (find) render it.

Naming: demo's "field"/"Core Field" = spec's **stream** — DB and code use `stream`; UI label stays "Core Field".

---

### Task 0: Manual prerequisites (user, one-time — no code)

**These are dashboard steps the developer performs; the plan cannot automate them. Everything later assumes they're done.**

- [ ] **Step 1: Create Supabase project** at https://supabase.com/dashboard → New project (name `smb-tutorials`, region closest to India, e.g. `ap-south-1`). Save the DB password in a password manager.
- [ ] **Step 2: Collect keys** from Project Settings → API: Project URL, `anon` public key, `service_role` key.
- [ ] **Step 3: `.env.local`** (append; file already exists with `DAILY_API_KEY`):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>   # no M1 code reads this; stored for M2+
```

- [ ] **Step 4: Vercel env vars** — add the same three in Vercel → Project → Settings → Environment Variables (all environments). `NEXT_PUBLIC_*` are safe to expose; service-role is server-only — never referenced from client code.
- [ ] **Step 5: Disable email confirmation** (for now): Supabase Dashboard → Authentication → Sign In / Up → Email → toggle **"Confirm email" OFF**. Rationale: M1 has no custom SMTP; Supabase's built-in sender is rate-limited (~2/hr) and would block testing. Revisit when Resend lands (M4) — recorded in Task 12's state update as an open hardening item.
- [ ] **Step 6: Google OAuth setup**:
  1. https://console.cloud.google.com → create project `smb-tutorials` → APIs & Services → OAuth consent screen (External, app name SMB Tutorials, your email).
  2. Credentials → Create Credentials → OAuth Client ID → Web application. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
  3. Supabase Dashboard → Authentication → Sign In / Up → Google → enable, paste Client ID + Client Secret.

---

### Task 1: Taxonomy module

**Files:**
- Create: `src/lib/taxonomy.ts`
- Test: `src/lib/taxonomy.test.ts`

**Interfaces:**
- Produces: `CURRICULA: readonly string[]`, `GRADES: readonly string[]`, `STREAMS: readonly string[]`, `SUBJECTS_BY_STREAM: Record<Stream, readonly string[]>`, types `Curriculum | Grade | Stream`, and guards `isCurriculum(x: string): x is Curriculum`, `isGrade`, `isStream`, `isSubjectOf(stream: string, subject: string): boolean`. Used by validation (Task 3), tutor picker (Task 7), find page (Task 8), teachers page (Task 9).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/taxonomy.test.ts
import { describe, it, expect } from "vitest";
import {
  CURRICULA, GRADES, STREAMS, SUBJECTS_BY_STREAM,
  isCurriculum, isGrade, isStream, isSubjectOf,
} from "./taxonomy";

describe("taxonomy", () => {
  it("matches the spec §7 values exactly", () => {
    expect(CURRICULA).toEqual(["CBSE", "State Board", "ICSE"]);
    expect(GRADES).toEqual(["6th", "7th", "8th", "9th", "10th", "11th", "12th"]);
    expect(STREAMS).toEqual(["Science", "Commerce", "Arts"]);
    expect(SUBJECTS_BY_STREAM.Science).toEqual(["Physics", "Chemistry", "Biology", "Mathematics"]);
    expect(SUBJECTS_BY_STREAM.Commerce).toEqual(["Accountancy", "Business Studies", "Economics", "Mathematics"]);
    expect(SUBJECTS_BY_STREAM.Arts).toEqual(["History", "Geography", "Political Science", "Economics", "Sociology"]);
  });

  it("guards accept valid values and reject invalid ones", () => {
    expect(isCurriculum("CBSE")).toBe(true);
    expect(isCurriculum("IB")).toBe(false);
    expect(isGrade("6th")).toBe(true);
    expect(isGrade("5th")).toBe(false);
    expect(isStream("Arts")).toBe(true);
    expect(isStream("Sports")).toBe(false);
    expect(isSubjectOf("Science", "Physics")).toBe(true);
    expect(isSubjectOf("Science", "History")).toBe(false);
    expect(isSubjectOf("Sports", "Physics")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm run test -- src/lib/taxonomy.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement**

```ts
// src/lib/taxonomy.ts
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
```

- [ ] **Step 4: Run test to verify it passes** — `npm run test -- src/lib/taxonomy.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/taxonomy.ts src/lib/taxonomy.test.ts && git commit -m "feat: K-12 taxonomy constants + guards (spec §7)"`

---

### Task 2: Database schema, RLS, signup trigger

**Files:**
- Create: `supabase/migrations/0001_profiles_teacher_subjects.sql`

**Interfaces:**
- Produces tables `public.profiles` and `public.teacher_subjects` exactly as below; trigger `handle_new_user` creates a profile from `raw_user_meta_data` (`role`, `full_name`, `phone`) on every auth signup (email or OAuth; role defaults to `student`). Later tasks rely on: profile row **already exists** when a Server Action runs after `signUp`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0001_profiles_teacher_subjects.sql
-- M1 schema (spec §8). Taxonomy enforced by CHECK constraints (mirror src/lib/taxonomy.ts).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'student' check (role in ('student', 'teacher')),
  full_name text not null default '',
  email text not null default '',
  phone text,
  -- teacher-only fields (null for students)
  qualification text,
  experience_years int check (experience_years >= 0),
  specialization text,
  teaching_level text check (teaching_level in ('school', 'college', 'both')),
  hourly_rate int check (hourly_rate > 0),
  hours_per_week text check (hours_per_week in ('5-10', '10-20', '20-30', '30-40', '40+')),
  bio text,
  demo_video_url text,
  created_at timestamptz not null default now()
);

create table public.teacher_subjects (
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  curriculum text not null check (curriculum in ('CBSE', 'State Board', 'ICSE')),
  grade text not null check (grade in ('6th','7th','8th','9th','10th','11th','12th')),
  stream text not null check (stream in ('Science', 'Commerce', 'Arts')),
  subject text not null,
  primary key (teacher_id, curriculum, grade, stream, subject)
);
create index teacher_subjects_filter_idx
  on public.teacher_subjects (subject, curriculum, grade, stream);

alter table public.profiles enable row level security;
alter table public.teacher_subjects enable row level security;

-- Anyone (including anonymous browse) can read teacher profiles; users read their own.
create policy "read teacher profiles or own" on public.profiles
  for select using (role = 'teacher' or id = (select auth.uid()));
create policy "update own profile" on public.profiles
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "read teacher_subjects" on public.teacher_subjects
  for select using (true);
create policy "teacher manages own subjects" on public.teacher_subjects
  for insert with check (teacher_id = (select auth.uid()));
create policy "teacher deletes own subjects" on public.teacher_subjects
  for delete using (teacher_id = (select auth.uid()));

-- Profile creation is trigger-only (security definer) — no INSERT policy on profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name, email, phone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'student'),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 2: Apply it** — Supabase Dashboard → SQL Editor → paste the file's contents → Run. (Alternative if the CLI is set up later: `npx supabase db push`.)
- [ ] **Step 3: Verify** — in SQL Editor run:

```sql
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('profiles','teacher_subjects');
select polname from pg_policies where schemaname = 'public';
insert into public.teacher_subjects (teacher_id, curriculum, grade, stream, subject)
 values (gen_random_uuid(), 'IB', '6th', 'Science', 'Physics'); -- expect: CHECK violation
```
Expected: both tables listed, 5 policies, and the bad insert **fails** on the curriculum CHECK.
- [ ] **Step 4: Commit** — `git add supabase/migrations/0001_profiles_teacher_subjects.sql && git commit -m "feat: profiles + teacher_subjects schema, RLS, signup trigger (spec §8)"`

---

### Task 3: Form validation module

**Files:**
- Create: `src/lib/validation.ts`
- Test: `src/lib/validation.test.ts`

**Interfaces:**
- Consumes: taxonomy guards from Task 1.
- Produces (used by Server Actions in Task 5 and tutor action in Task 7):

```ts
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
parseSignIn(fd: FormData): Result<{ email: string; password: string }>
parseStudentSignUp(fd: FormData): Result<{ fullName: string; email: string; password: string }>
parseTutorSignUp(fd: FormData): Result<TutorSignUp>
// TutorSignUp = { fullName, email, password, phone, experienceYears: number,
//   qualification, specialization: string | null, teachingLevel: 'school'|'college'|'both'|null,
//   hourlyRate: number, hoursPerWeek: '5-10'|'10-20'|'20-30'|'30-40'|'40+',
//   demoVideoUrl: string,
//   subjects: Array<{ curriculum: Curriculum; grade: Grade; stream: Stream; subject: string }> }
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/validation.test.ts
import { describe, it, expect } from "vitest";
import { parseSignIn, parseStudentSignUp, parseTutorSignUp } from "./validation";

const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o))
    (Array.isArray(v) ? v : [v]).forEach((x) => f.append(k, x));
  return f;
};

describe("parseSignIn", () => {
  it("accepts email+password", () => {
    const r = parseSignIn(fd({ email: "a@b.com", password: "secret123" }));
    expect(r).toEqual({ ok: true, value: { email: "a@b.com", password: "secret123" } });
  });
  it("rejects missing fields", () => {
    expect(parseSignIn(fd({ email: "a@b.com" })).ok).toBe(false);
  });
});

describe("parseStudentSignUp", () => {
  it("accepts valid input and trims name", () => {
    const r = parseStudentSignUp(fd({ fullName: " Asha ", email: "a@b.com", password: "secret123", confirmPassword: "secret123" }));
    expect(r.ok && r.value.fullName).toBe("Asha");
  });
  it("rejects password mismatch", () => {
    const r = parseStudentSignUp(fd({ fullName: "A", email: "a@b.com", password: "secret123", confirmPassword: "nope" }));
    expect(!r.ok && r.error).toMatch(/match/i);
  });
  it("rejects short password", () => {
    expect(parseStudentSignUp(fd({ fullName: "A", email: "a@b.com", password: "abc", confirmPassword: "abc" })).ok).toBe(false);
  });
});

describe("parseTutorSignUp", () => {
  const base = {
    fullName: "Dr. Rao", email: "rao@x.com", password: "secret123",
    phone: "9876543210", experience: "8", qualification: "PhD Physics",
    specialization: "Mechanics", teachingLevel: "school", hourlyRate: "500",
    hoursPerWeek: "10-20", demoVideoUrl: "https://youtu.be/abc",
    curricula: ["CBSE"], grades: ["11th", "12th"],
    subjects: ["Science|Physics", "Science|Chemistry"],
  };
  it("expands curricula × grades × subjects into rows", () => {
    const r = parseTutorSignUp(fd(base));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.subjects).toHaveLength(4); // 1 curriculum × 2 grades × 2 subjects
      expect(r.value.subjects).toContainEqual({ curriculum: "CBSE", grade: "12th", stream: "Science", subject: "Physics" });
      expect(r.value.experienceYears).toBe(8);
      expect(r.value.hourlyRate).toBe(500);
    }
  });
  it("rejects a subject not in its stream", () => {
    expect(parseTutorSignUp(fd({ ...base, subjects: ["Science|History"] })).ok).toBe(false);
  });
  it("rejects invalid curriculum, empty grades, empty subjects, bad rate", () => {
    expect(parseTutorSignUp(fd({ ...base, curricula: ["IB"] })).ok).toBe(false);
    expect(parseTutorSignUp(fd({ ...base, grades: [] })).ok).toBe(false);
    expect(parseTutorSignUp(fd({ ...base, subjects: [] })).ok).toBe(false);
    expect(parseTutorSignUp(fd({ ...base, hourlyRate: "0" })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm run test -- src/lib/validation.test.ts`.
- [ ] **Step 3: Implement** — pure functions, no I/O:

```ts
// src/lib/validation.ts
import {
  isCurriculum, isGrade, isStream, isSubjectOf,
  type Curriculum, type Grade, type Stream,
} from "./taxonomy";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type TeachingLevel = "school" | "college" | "both";
export type HoursPerWeek = "5-10" | "10-20" | "20-30" | "30-40" | "40+";

const TEACHING_LEVELS: readonly string[] = ["school", "college", "both"];
const HOURS_PER_WEEK: readonly string[] = ["5-10", "10-20", "20-30", "30-40", "40+"];

export interface SubjectRow {
  curriculum: Curriculum;
  grade: Grade;
  stream: Stream;
  subject: string;
}

export interface StudentSignUp {
  fullName: string;
  email: string;
  password: string;
}

export interface TutorSignUp extends StudentSignUp {
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

const fail = (error: string): Result<never> => ({ ok: false, error });
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
const raw = (fd: FormData, k: string) => (fd.get(k) ?? "").toString();
const all = (fd: FormData, k: string) => fd.getAll(k).map((v) => v.toString());

// Number("") is 0, so digits are checked before conversion.
const wholeNumber = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

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
  if (password.length < 8) return fail("Password must be at least 8 characters.");
  if (password !== confirm) return fail("Passwords do not match.");
  return { ok: true, value: { fullName, email, password } };
}

// Subjects arrive as repeated "subjects" entries encoded "Stream|Subject"; curricula
// and grades as repeated checkbox entries. The three are expanded into one row per
// (curriculum, grade, stream, subject) combination — the shape teacher_subjects stores.
export function parseTutorSignUp(fd: FormData): Result<TutorSignUp> {
  const fullName = str(fd, "fullName");
  if (!fullName) return fail("Enter your full name.");

  const email = str(fd, "email");
  if (!email.includes("@")) return fail("Enter a valid email address.");

  const password = raw(fd, "password");
  if (password.length < 8) return fail("Password must be at least 8 characters.");

  const phone = str(fd, "phone");
  if (!/^\d{10}$/.test(phone)) return fail("Enter a 10-digit phone number.");

  const experienceYears = wholeNumber(str(fd, "experience"));
  if (experienceYears === null) return fail("Years of experience must be a whole number.");

  const qualification = str(fd, "qualification");
  if (!qualification) return fail("Enter your highest qualification.");

  const specialization = str(fd, "specialization") || null;

  const level = str(fd, "teachingLevel");
  if (level && !TEACHING_LEVELS.includes(level)) return fail("Select a valid teaching level.");
  const teachingLevel = (level || null) as TeachingLevel | null;

  const hourlyRate = wholeNumber(str(fd, "hourlyRate"));
  if (hourlyRate === null || hourlyRate <= 0) return fail("Hourly rate must be a positive whole number.");

  const hoursPerWeek = str(fd, "hoursPerWeek");
  if (!HOURS_PER_WEEK.includes(hoursPerWeek)) return fail("Select your available hours per week.");

  const demoVideoUrl = str(fd, "demoVideoUrl");
  if (!/^https?:\/\//.test(demoVideoUrl)) return fail("Enter a valid demo video link.");

  const curricula = all(fd, "curricula");
  if (curricula.length === 0) return fail("Select at least one curriculum.");
  if (!curricula.every(isCurriculum)) return fail("Select a valid curriculum.");

  const grades = all(fd, "grades");
  if (grades.length === 0) return fail("Select at least one grade.");
  if (!grades.every(isGrade)) return fail("Select a valid grade.");

  const pairs = all(fd, "subjects");
  if (pairs.length === 0) return fail("Select at least one subject.");

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
      fullName, email, password, phone, experienceYears, qualification,
      specialization, teachingLevel, hourlyRate,
      hoursPerWeek: hoursPerWeek as HoursPerWeek,
      demoVideoUrl, subjects,
    },
  };
}
```
- [ ] **Step 4: Run to verify PASS** — `npm run test -- src/lib/validation.test.ts`, then full `npm run test`.
- [ ] **Step 5: Commit** — `git commit -am "feat: pure form validation for M1 auth + tutor onboarding"`

---

### Task 4: Supabase clients + session-refresh proxy

**Files:**
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/proxy-session.ts`, `src/proxy.ts`
- Modify: `package.json` (deps)

**Interfaces:**
- Produces: `createClient()` (browser, from `client.ts`), `async createClient()` (server, from `server.ts`) — every later task gets its Supabase client from these two files only.

- [ ] **Step 1: Install** — `npm install @supabase/supabase-js @supabase/ssr`
- [ ] **Step 2: Browser client**

```ts
// src/lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 3: Server client**

```ts
// src/lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — proxy refresh handles it.
          }
        },
      },
    }
  );
}
```

- [ ] **Step 4: Proxy (Next 16 rename of middleware — see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`)**

```ts
// src/lib/supabase/proxy-session.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  // Refreshes the auth token if expired; do not remove.
  await supabase.auth.getUser();
  return response;
}
```

```ts
// src/proxy.ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy-session";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 5: Verify** — `npm run build` succeeds; `npm run dev`, load `/` — no errors, response sets no cookie yet (not signed in) but proxy runs without crashing.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: Supabase browser/server clients + session-refresh proxy"`

---

### Task 5: Auth Server Actions + OAuth callback + shared header

**Files:**
- Create: `src/lib/form-state.ts`, `src/app/auth/actions.ts`, `src/app/auth/callback/route.ts`, `src/components/site-header.tsx`

**Interfaces:**
- Consumes: `parseSignIn`/`parseStudentSignUp` (Task 3), server `createClient` (Task 4).
- Produces:
  - `AuthState = { error: string } | null` from `@/lib/form-state`.
  - `signIn(prev: AuthState, fd: FormData): Promise<AuthState>` and `signUpStudent(...)` — `useActionState`-compatible; on success `redirect("/")`.
  - `signOut(): Promise<void>` — signs out, `redirect("/")`.
  - `GET /auth/callback?code=...&next=...` — exchanges OAuth code, redirects to `next` (default `/`) or `/signin?error=oauth` on failure.
  - `<SiteHeader action?: ReactNode>` — demo's white sticky header (SMB gradient logo block, "SMB Tutorials", "One Student, One Teacher") with a right-side slot.

- [ ] **Step 1: Shared state type** — a `"use server"` file may only export async functions, so `AuthState` gets its own module rather than riding along in `actions.ts`:

```ts
// src/lib/form-state.ts
export type AuthState = { error: string } | null;
```

- [ ] **Step 2: Actions**

```ts
// src/app/auth/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseSignIn, parseStudentSignUp } from "@/lib/validation";
import type { AuthState } from "@/lib/form-state";

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parseSignIn(formData);
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.value);
  if (error) return { error: "Invalid email or password." };
  redirect("/");
}

export async function signUpStudent(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parseStudentSignUp(formData);
  if (!parsed.ok) return { error: parsed.error };
  const { email, password, fullName } = parsed.value;
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { role: "student", full_name: fullName } },
  });
  if (error) return { error: error.message };
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
```

- [ ] **Step 3: OAuth callback route**

```ts
// src/app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/signin?error=oauth`);
}
```

- [ ] **Step 4: SiteHeader** — transcribe the demo's header block (App.js lines 802–822: white bg, `shadow-sm sticky top-0 z-50`, gradient `w-11 h-11` SMB square, name + tagline); logo wraps in `<Link href="/">`; render `{action}` on the right. **No `"use client"`, not `async`, no server-only imports** — Task 8's client page renders it too.
- [ ] **Step 5: Verify** — `npm run build` passes (actions/route compile). Behavior is exercised in Tasks 6–8.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: auth server actions, OAuth callback, shared site header"`

---

### Task 6: Sign-in + sign-up pages (faithful rebuild)

**Files:**
- Create: `src/app/signin/page.tsx`, `src/app/signin/signin-form.tsx`, `src/app/signup/page.tsx`, `src/app/signup/signup-form.tsx`, `src/components/google-button.tsx`

**Interfaces:**
- Consumes: `signIn`, `signUpStudent` (Task 5), browser `createClient` (Task 4), `AuthState` (Task 5).
- Produces: `<SignInForm initialError?: string>` and `<SignUpForm>` — the white card, client-side.

- [ ] **Step 1: GoogleButton (client component)** — the demo's Google button JSX (App.js 1366–1377: white bordered button with the 4-color G SVG). `"use client"`; prop `label` ("Continue with Google" / "Sign up with Google"); onClick:

```tsx
const supabase = createClient();
await supabase.auth.signInWithOAuth({
  provider: "google",
  options: { redirectTo: `${location.origin}/auth/callback` },
});
```

- [ ] **Step 2: SignInForm (client)** — transcribe the demo's white card, App.js **1354–1443**: logo block, "Sign In" / "Access your account", Google button, "Or sign in with email" divider, the two inputs, remember-me row, gradient submit, sign-up link. Deltas:
  - `"use client"`; `const [state, formAction, isPending] = useActionState(signIn, null)`; wrap the inputs in `<form action={formAction}>`; `name="email"` / `name="password"`; submit becomes `type="submit"` with `disabled={isPending}` (drop the demo's `alert`).
  - Render `state?.error ?? initialError` in a `text-red-600 text-sm` line above the submit.
  - Links → `<Link href="/signup">`; "Forgot password?" stays a dead button (parity with demo).
  - Google button → `<GoogleButton label="Continue with Google" />`.
- [ ] **Step 3: Sign-in page (server)** — transcribe the outer layout, App.js **1300–1353** + **1444–1448**: split-screen with the Unsplash left panel (`photo-1523240795612…`, teal/cyan overlay, "Welcome Back!" + three ✓ rows) and the "← Back to Home" `<Link href="/">`. Then:

```tsx
export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const { error } = await searchParams;
  const initialError = error === "oauth" ? "Google sign-in failed — try again." : undefined;
  // ...left panel..., then <SignInForm initialError={initialError} />
}
```

- [ ] **Step 4: Sign-up page + form** — same split against App.js **1451–1614** (Unsplash `photo-1522202176988…`, "Start Learning Today!" with 🎯/📅/💪 rows). `SignUpForm` is the client card wired to `signUpStudent`; inputs named `fullName,email,password,confirmPassword`; terms checkbox `required`, links to `/terms`; sign-in links → `<Link href="/signin">`. The page takes no `searchParams`.
- [ ] **Step 5: Verify manually** — `npm run dev`:
  1. `/signup` → create `student1@test.com` → redirected to `/`.
  2. Supabase Dashboard → Table Editor → `profiles`: row exists, `role=student`, `full_name` set (trigger worked).
  3. `/signin` wrong password → inline error; right password → redirect `/`.
  4. Google button → full OAuth roundtrip lands back on `/`; a `profiles` row with `role=student` exists for the Google user.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: signin/signup pages wired to Supabase auth (demo-faithful)"`

---

### Task 7: Tutor signup — one form creating account + profile + subjects

**Files:**
- Create: `src/app/tutor-signup/page.tsx`, `src/app/tutor-signup/tutor-form.tsx`, `src/app/tutor-signup/subject-picker.tsx`, `src/app/tutor-signup/actions.ts`

**Interfaces:**
- Consumes: `parseTutorSignUp` (Task 3), server `createClient` (Task 4), `SiteHeader` + `AuthState` (Task 5), taxonomy (Task 1).
- Produces: `signUpTutor(prev: AuthState, fd: FormData): Promise<AuthState>`.

**Depends on Task 0 Step 5** (email confirmation OFF). With confirmation on, `signUp` returns no session, so the profile `update` and subject `insert` below would be rejected by RLS.

- [ ] **Step 1: Action**

```ts
// src/app/tutor-signup/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseTutorSignUp } from "@/lib/validation";
import type { AuthState } from "@/lib/form-state";

export async function signUpTutor(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parseTutorSignUp(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email: v.email,
    password: v.password,
    options: { data: { role: "teacher", full_name: v.fullName, phone: v.phone } },
  });
  if (error || !data.user) return { error: error?.message ?? "Sign up failed." };
  const teacherId = data.user.id;

  // The trigger already created the profile row; this enriches it (RLS: own row).
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      qualification: v.qualification,
      experience_years: v.experienceYears,
      specialization: v.specialization,
      teaching_level: v.teachingLevel,
      hourly_rate: v.hourlyRate,
      hours_per_week: v.hoursPerWeek,
      demo_video_url: v.demoVideoUrl,
    })
    .eq("id", teacherId);
  if (profileError) return { error: "Account created but profile save failed — sign in and retry." };

  const { error: subjectsError } = await supabase
    .from("teacher_subjects")
    .insert(v.subjects.map((s) => ({ teacher_id: teacherId, ...s })));
  if (subjectsError) return { error: "Account created but subjects save failed — sign in and retry." };

  redirect("/");
}
```

- [ ] **Step 2: SubjectPicker (client component)** — replaces the demo's three free-text-ish fields (Subjects You Teach) with structured checkboxes, styled with the demo's chip pattern (App.js 961–973: `rounded-lg border-2`, selected = `border-teal-600 bg-teal-50 text-teal-600`):
  - **Curriculum** — 3 chips (checkbox behavior, `name="curricula"`).
  - **Grades** — 7 chips (`name="grades"`).
  - **Subjects** — three labeled groups (Science / Commerce / Arts headings), each subject a chip; hidden value `name="subjects"` value=`"${stream}|${subject}"`.
  - Chips are `<label>`s wrapping visually-hidden `<input type="checkbox">` so plain FormData submission carries repeated entries — no JS state needed beyond CSS `peer-checked` styling.
- [ ] **Step 3: TutorForm (client)** — transcribe the demo's `<form>`, App.js **1652–1879**: Personal Information / Education & Qualifications / Teaching Preferences / Demo Video sections, the blue "How to Upload" and teal "Demo Video Tips" info boxes, terms checkbox, spinner submit button, "2-3 business days" note. Deltas:
  - `"use client"`; `const [state, formAction, isPending] = useActionState(signUpTutor, null)`; `<form action={formAction}>` (drop the demo's `onSubmit`, `alert`, and Google Sheets `fetch`).
  - Add a **Password** field (`name="password"`, `type="password"`, `minLength={8}`) beside Email in Personal Information, label "Password * (you'll use this to sign in)".
  - "Subjects You Teach *" text input → `<SubjectPicker />`.
  - Inputs are uncontrolled with `name=` attrs matching `parseTutorSignUp`: `fullName,email,password,phone,experience,qualification,specialization,teachingLevel,hourlyRate,hoursPerWeek,demoVideoUrl` (the demo's `useState`-per-field wiring is unnecessary — FormData carries them).
  - The existing spinner button keys off `disabled={isPending}`; show `state?.error` in a `text-red-600 text-sm` line above it.
  - Terms checkbox links → `/terms`.
- [ ] **Step 4: Page (server)** — transcribe App.js **1617–1651** + closing markup: gradient background, `<SiteHeader action={<Link href="/">← Back to Home</Link>} />`, 👨‍🏫 "Join as a Tutor" hero, then `<TutorForm />`.
- [ ] **Step 5: Verify manually** —
  1. `/tutor-signup` → fill everything, pick CBSE + 11th/12th + Physics/Chemistry → submit → redirect `/`.
  2. Table Editor: `profiles` row `role=teacher` with rate/qualification set; `teacher_subjects` has 4 rows (1×2×2).
  3. Submit with a bad phone (e.g. `12345`) → inline error, and no new row appears in `auth.users`.
- [ ] **Step 6: Run tests + commit** — `npm run test` green; `git add -A && git commit -m "feat: tutor signup creates account, teacher profile, structured subjects"`

---

### Task 8: Find-a-teacher page (demo 'form' screen)

**Files:**
- Create: `src/app/find/page.tsx` (client component)

**Interfaces:**
- Consumes: taxonomy (Task 1).
- Produces: navigation to `/teachers?curriculum=..&grade=..&stream=..&subject=..` (exact param names Task 9 reads).

- [ ] **Step 1: Transcribe** App.js **919–1134**: grid-pattern background, "Tell Us What You Need", progressive disclosure (curriculum chips → grade select → Core Field chips → subject select) with the `animate-fadeIn` keyframes (put the keyframes in `globals.css` instead of a `<style>` tag). Deltas:
  - Options come from `CURRICULA/GRADES/STREAMS/SUBJECTS_BY_STREAM` — not inline arrays.
  - **Drop the Preferred Date & Time block and the "Now" button** (decision #4): once subject is chosen, show the "Find Available Teachers →" submit directly.
  - Submit = `router.push('/teachers?' + new URLSearchParams({curriculum, grade, stream, subject}))`.
  - The two "Request a Custom Subject" panels: keep the JSX, but the button links nowhere yet — render it disabled with `title="Custom requests arrive with the request tier (M4)"`.
  - Header: `<SiteHeader />` (logo already links home).
- [ ] **Step 2: Verify** — `/find`: chips reveal progressively; selecting Science → subject dropdown shows exactly Physics/Chemistry/Biology/Mathematics; submit lands on `/teachers?curriculum=CBSE&grade=11th&stream=Science&subject=Physics`.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: find-a-teacher subject selection page (demo 'form', instant-first)"`

---

### Task 9: Teachers browse page (real data)

**Files:**
- Create: `src/app/teachers/page.tsx` (server component), `src/app/teachers/teacher-card.tsx`

**Interfaces:**
- Consumes: server `createClient` (Task 4), taxonomy guards (Task 1), `SiteHeader` (Task 5). Reads searchParams `curriculum, grade, stream, subject`.

- [ ] **Step 1: Query (in the server component)**

```tsx
export default async function TeachersPage({ searchParams }: PageProps<"/teachers">) {
  const params = await searchParams; // Next 16: searchParams is a Promise
  // Values are string | string[] | undefined — collapse to a single string first.
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  const curriculum = one(params.curriculum);
  const grade = one(params.grade);
  const stream = one(params.stream);
  const subject = one(params.subject);

  const supabase = await createClient();
  let query = supabase
    .from("profiles")
    .select(
      "id, full_name, qualification, specialization, experience_years, hourly_rate, " +
        "teacher_subjects!inner(curriculum, grade, stream, subject)"
    )
    .eq("role", "teacher");

  // Each filter applies only when present AND valid — a junk query param is ignored,
  // never passed through to the database.
  if (isCurriculum(curriculum)) query = query.eq("teacher_subjects.curriculum", curriculum);
  if (isGrade(grade)) query = query.eq("teacher_subjects.grade", grade);
  if (isStream(stream)) query = query.eq("teacher_subjects.stream", stream);
  if (isSubjectOf(stream, subject)) query = query.eq("teacher_subjects.subject", subject);

  const { data: teachers, error } = await query;
  // ...render
}
```

No filters (direct visit / "Browse Teachers" CTA) = all teachers. If `error` is set, render the empty-state panel with "Couldn't load teachers — refresh to try again." instead of the card grid.
- [ ] **Step 2: Render** — transcribe App.js **798–917**: `<SiteHeader action={<Link href="/find">← Back to Search</Link>} />`, "Available Teachers" heading, subheader `Showing teachers for {subject} • {curriculum} • {grade}` (spec §13 format; omit missing parts), 3-col card grid, bottom "Didn't find what you're looking for?" panel (its "Request a Teacher" button disabled, `title="Teacher requests arrive in M4"`). Per card (from demo card JSX 840–894), with honest-data deltas (decision #4):
  - Emoji header: static `🧑‍🏫` placeholder; name; teal subject line = the card's matched subject (filtered subject, else first of its `teacher_subjects`).
  - `{experience_years} yrs exp.` where the demo shows experience; **no ⭐ rating row, no green availability dot** (deferred to real data / M2 presence).
  - Education ← `qualification`; Specialization ← `specialization` (hide block when null).
  - `₹{hourly_rate}/hour`; "Book Now" button rendered `disabled` with `title="Instant booking arrives with presence (M2)"`.
  - Empty state (no teachers match): centered panel "No teachers for {subject} yet — check back soon." (spec §13's request/schedule empty-state panel arrives with those tiers).
- [ ] **Step 3: Verify** — with the Task 7 teacher in the DB: `/teachers?curriculum=CBSE&grade=11th&stream=Science&subject=Physics` shows the card; `.../subject=Biology` shows the empty state; `/teachers` bare shows all teachers; anonymous (signed-out) browsing works (RLS public read).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: teacher browse with live Supabase data + taxonomy filters"`

---

### Task 10: Home page rebuild (auth-aware header)

**Files:**
- Modify: `src/app/page.tsx` (replace placeholder entirely)

**Interfaces:**
- Consumes: server `createClient` (Task 4), `signOut` (Task 5).

- [ ] **Step 1: Transcribe** App.js **2122–2386** as a server component: grid pattern + blurred teal/cyan circles, header (this screen keeps the demo's own header layout — solid `bg-teal-600` w-12 logo, not SiteHeader), hero ("Learn Anything, **Anytime**", 🎓 badge, benefits row), Unsplash collage (`photo-1522071820081…`) with floating "One-on-One Sessions" card, features grid, "Become a tutor" recruitment split-panel (`photo-1522202176988…`). Deltas:
  - "Find a Teacher →" → `<Link href="/find">`; "Browse Teachers" → `<Link href="/teachers">`; "Become a tutor →" → `<Link href="/tutor-signup">`.
  - Header right side: `const { data: { user } } = await supabase.auth.getUser();` — signed out → "Sign In" `<Link href="/signin">` (demo styling); signed in → `Hi, {full_name or email}` + a "Sign Out" button (`<form action={signOut}>`, same gradient button styling).
  - "How our platform works →" dead-alert button → plain non-interactive text link placeholder (keep copy, no alert).
- [ ] **Step 2: Verify** — `/` signed out shows demo landing + Sign In; after signing in, name + Sign Out appear; Sign Out returns to signed-out header. All three CTAs navigate.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: rebuild demo home page with auth-aware header"`

---

### Task 11: Terms page + /api/rooms auth gate

**Files:**
- Create: `src/app/terms/page.tsx`
- Modify: `src/app/api/rooms/route.ts`
- Test: `src/lib/daily.test.ts` (unchanged — gate is route-level; verified manually)

- [ ] **Step 1: Terms** — transcribe App.js **1887–2120** as a static server component (`<SiteHeader action={<Link href="/">← Back to Home</Link>} />` + the sections incl. `support@smbtutorial.com` contact box). Pure transcription; signup/tutor-signup links now resolve.
- [ ] **Step 2: Gate /api/rooms** (spec §15 interim hardening — the *root-cause* close is M2's server-side room-on-accept; this stops anonymous cost abuse now):

```ts
// src/app/api/rooms/route.ts — add before room creation
import { createClient } from "@/lib/supabase/server";
// inside POST:
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  return NextResponse.json({ error: "Sign in required" }, { status: 401 });
}
```

- [ ] **Step 3: Update spec §15** — in `docs/superpowers/specs/2026-08-24-smb-tutorials-design.md`, annotate the first bullet: *"(M1: route now requires a signed-in Supabase user — anonymous abuse closed. Full close — server-side mint on authenticated teacher-accept tied to a session row — remains M2.)"*
- [ ] **Step 4: Verify** — signed out, `curl -X POST localhost:3000/api/rooms` → 401. Signed in (browser, via `/call`) → room still created, video works.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: terms page; harden /api/rooms behind auth (spec §15 interim)"`

---

### Task 12: Finish — full verification, state update, deploy

- [ ] **Step 1: Full test suite** — `npm run test` (all green: 5 existing + taxonomy + validation) and `npm run build` (clean).
- [ ] **Step 2: End-to-end pass** (`npm run dev`), the M1 acceptance list:
  1. Home renders demo-faithfully; Sign In / Find a Teacher / Browse Teachers / Become a tutor all navigate.
  2. Student signup → profile row (`role=student`) → sign out → sign in.
  3. Google OAuth roundtrip → student profile.
  4. Tutor signup → teacher profile + correct `teacher_subjects` cross-product.
  5. `/find` → `/teachers` filter shows that tutor; unmatched subject shows empty state; anonymous browse works.
  6. `/api/rooms` anonymous → 401; signed-in `/call` still does two-browser video.
- [ ] **Step 3: Update `project_state.md`** — M1 complete; next: **M2 presence + instant pick** (in-call + teacher-dashboard screens need just-in-time design first, spec §13). Record these open items explicitly, each with the milestone that closes it:
  - Email confirmation is **disabled** in Supabase — re-enable when Resend lands (M4). Until then anyone can sign up with an address they don't own.
  - `/api/rooms` is auth-gated but still client-triggered — spec §15 full close (server-side mint on teacher-accept, scoped join tokens) is M2.
  - **Google OAuth always creates a `student`** — the role comes from signup metadata that OAuth has no form to carry. Teachers must use email signup in M1; a post-OAuth role-picker is M2 work if teachers want Google.
  - "Book Now" (teachers) and "Request a Teacher" / "Request a Custom Subject" render disabled — they light up in M2 and M4 respectively.
- [ ] **Step 4: Push** — `git branch --show-current` = main; `git fetch origin main && git rebase origin/main && git push origin main`.
- [ ] **Step 5: Verify production** — Vercel deploy green; on the prod URL: signup/signin work (Supabase env vars present), `/teachers` lists the tutor, `/api/rooms` anonymous → 401. **Note:** Google OAuth on prod requires the Vercel domain in Supabase Auth → URL Configuration → Redirect URLs (`https://<prod-domain>/auth/callback`) — add it during this step.

## Verification (overall)

- Automated: `npm run test` (taxonomy, validation, existing daily/share tests), `npm run build`.
- Manual: Task 12 Step 2 checklist locally, Step 5 on production.
- Data: inspect `profiles` / `teacher_subjects` in Supabase Table Editor after each signup flow; confirm the CHECK-constraint rejection from Task 2 Step 3.
