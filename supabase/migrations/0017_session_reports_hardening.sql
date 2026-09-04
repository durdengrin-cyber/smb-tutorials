-- Cycle 3 follow-up, spec §8 items 4 and 5. Two independent problems with
-- session_reports, both found by the final review of the branch that created it.
begin;

-- ---------------------------------------------------------------------------
-- 1. A SECOND read control, so RLS is not the only one.
--
-- 0016 relies entirely on "RLS enabled, no select policy". That is correct and
-- the probe proves it — but `authenticated` still holds the SELECT PRIVILEGE
-- from Supabase's default grants, so one `disable row level security`, or one
-- future policy written slightly too wide, opens the table in a single step.
-- Spec §5's stated goal is that reports "must not be one policy mistake away
-- from being readable by other users"; today they are exactly one away.
--
-- This also fixes a leak at the root rather than in application code: Postgres
-- omits the "Failing row contains (…)" detail from constraint-violation errors
-- when the current role lacks SELECT on the table. That detail was carrying the
-- reporter's own words into Sentry (closed in app code already; this closes the
-- database half, which is the durable one).
revoke select on public.session_reports from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reports must survive the deletion of the person they are ABOUT.
--
-- The chain, all of it live today: 0001 has profiles.id -> auth.users on delete
-- cascade; 0002 has sessions.teacher_id -> profiles on delete cascade; 0016 has
-- session_reports.session_id -> sessions on delete cascade. So deleting the
-- REPORTED TEACHER's auth user — one click in the Supabase dashboard, no
-- product code involved — destroys every session they taught and every report
-- about them. Evidence destruction by the subject of the evidence.
--
-- Fixed by snapshotting what the report is ABOUT onto the report itself, then
-- letting the foreign keys go null instead of cascading.
alter table public.session_reports
  add column if not exists teacher_name text,
  add column if not exists subject      text,
  add column if not exists session_at   timestamptz;

-- Deliberately NOT snapshotting the reporter's name. The report is evidence
-- about a teacher; the reporter's identity is their own personal data, and a
-- person who deletes their account should not have their name preserved in a
-- table they can never see. reporter_id simply goes null.
comment on column public.session_reports.teacher_name is
  'Snapshot of the reported teacher at filing time. Survives the teacher''s deletion, which is the point.';

-- Fill the snapshot automatically, so the application cannot forget and a
-- direct insert cannot bypass it.
create or replace function public.session_reports_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  select p.full_name, s.subject, coalesce(s.started_at, s.created_at)
    into new.teacher_name, new.subject, new.session_at
    from public.sessions s
    join public.profiles p on p.id = s.teacher_id
   where s.id = new.session_id;
  return new;
end;
$fn$;

drop trigger if exists session_reports_snapshot on public.session_reports;
create trigger session_reports_snapshot
  before insert on public.session_reports
  for each row execute function public.session_reports_snapshot();

-- Backfill anything already filed.
update public.session_reports r
   set teacher_name = p.full_name,
       subject      = s.subject,
       session_at   = coalesce(s.started_at, s.created_at)
  from public.sessions s
  join public.profiles p on p.id = s.teacher_id
 where r.session_id = s.id
   and r.teacher_name is null;

-- Now the columns may go null without losing the record.
alter table public.session_reports
  alter column session_id  drop not null,
  alter column reporter_id drop not null;

-- Re-point both foreign keys at SET NULL. Constraint names are looked up rather
-- than assumed: 0016 did not name them, so they carry Postgres defaults, and a
-- hardcoded name that is wrong would abort this migration halfway.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.session_reports'::regclass and contype = 'f'
     and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'public.session_reports'::regclass
                            and attname = 'session_id')];
  if c is not null then
    execute format('alter table public.session_reports drop constraint %I', c);
  end if;
  alter table public.session_reports
    add constraint session_reports_session_id_fkey
    foreign key (session_id) references public.sessions (id) on delete set null;

  select conname into c from pg_constraint
   where conrelid = 'public.session_reports'::regclass and contype = 'f'
     and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'public.session_reports'::regclass
                            and attname = 'reporter_id')];
  if c is not null then
    execute format('alter table public.session_reports drop constraint %I', c);
  end if;
  alter table public.session_reports
    add constraint session_reports_reporter_id_fkey
    foreign key (reporter_id) references public.profiles (id) on delete set null;
end $$;

-- The insert policy still holds: with session_id null the exists() subquery is
-- false, so a report cannot be filed without naming a session the caller was in.

commit;
