-- M1 schema (spec §8). Taxonomy enforced by CHECK constraints, mirroring
-- src/lib/taxonomy.ts — change one and the other must follow.

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
