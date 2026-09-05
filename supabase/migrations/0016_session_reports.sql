-- Cycle 3, spec §5. The first reporting path in this product.
--
-- Until now a student or parent had no way to tell anyone that something went
-- wrong in a lesson: no report button, no block, nowhere for it to go. That is
-- part of the child-safety gap, and a session row already naming the teacher,
-- the subject and the date is the cheapest place to close it.

create table if not exists public.session_reports (
  id          uuid primary key default gen_random_uuid(),
  -- cascade: a report about a deleted session has nothing left to describe.
  session_id  uuid not null references public.sessions (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  -- Fixed list, enforced here, so a report cannot arrive carrying a reason
  -- nothing knows how to triage. 'conduct' is the one this feature exists for.
  reason      text not null check (reason in (
                'no_show', 'left_early', 'technical',
                'teaching_quality', 'conduct', 'other'
              )),
  -- The reporter's own words, optional. NEVER lesson content.
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists session_reports_session_idx
  on public.session_reports (session_id);

alter table public.session_reports enable row level security;

-- INSERT only, and only for a session the caller was actually in. Without the
-- subquery, any signed-in user could file a report against any session id they
-- guessed, and the report names a teacher.
create policy session_reports_insert on public.session_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
       where s.id = session_id
         and s.student_id = (select auth.uid())
    )
  );

-- NO SELECT POLICY, deliberately. With RLS on and no policy, every ordinary
-- client is refused and only the service role can read. A report may describe
-- a child; it must not be one policy mistake away from being readable by other
-- users — including by the teacher it is about. Reports are read by an
-- operator script until admin exists (spec §8 item 2).

