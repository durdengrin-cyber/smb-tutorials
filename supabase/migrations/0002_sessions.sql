-- M2 sessions (design spec §4). Status values mirror src/lib/session.ts.

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  curriculum text not null check (curriculum in ('CBSE', 'State Board', 'ICSE')),
  grade text not null check (grade in ('6th','7th','8th','9th','10th','11th','12th')),
  stream text not null check (stream in ('Science', 'Commerce', 'Arts')),
  subject text not null,
  type text not null default 'instant' check (type in ('instant', 'request', 'scheduled')),
  status text not null default 'pending'
    check (status in ('pending','accepted','active','completed','declined','timed_out','cancelled')),
  accept_deadline timestamptz,
  duration_minutes int not null default 60 check (duration_minutes > 0),
  started_at timestamptz,
  -- Snapshot, not a join: a teacher changing their rate must not alter what a
  -- past session cost.
  hourly_rate int not null check (hourly_rate > 0),
  daily_room_url text,
  created_at timestamptz not null default now(),
  constraint different_parties check (student_id <> teacher_id),
  -- effectiveStatus() can only expire a pending row that carries a deadline.
  -- Without this, a null-deadline pending row would never time out and could
  -- be accepted arbitrarily later — the exact failure the read-time rule exists
  -- to prevent.
  constraint pending_has_deadline
    check (status <> 'pending' or accept_deadline is not null)
);

create index sessions_teacher_status_idx on public.sessions (teacher_id, status);
create index sessions_student_status_idx on public.sessions (student_id, status);

alter table public.sessions enable row level security;

-- A session is visible only to its two participants.
create policy "participants read own sessions" on public.sessions
  for select using (
    student_id = (select auth.uid()) or teacher_id = (select auth.uid())
  );

-- Only the student creates the request, only for themselves.
create policy "student creates own session" on public.sessions
  for insert with check (student_id = (select auth.uid()));

-- Either participant may update; which transitions are legal is enforced in
-- the Server Actions (they hold the state machine).
create policy "participants update own sessions" on public.sessions
  for update using (
    student_id = (select auth.uid()) or teacher_id = (select auth.uid())
  ) with check (
    student_id = (select auth.uid()) or teacher_id = (select auth.uid())
  );

-- Required for postgres_changes subscriptions on this table.
alter publication supabase_realtime add table public.sessions;
-- Realtime sends old-row data for UPDATE/DELETE only with a replica identity.
alter table public.sessions replica identity full;
