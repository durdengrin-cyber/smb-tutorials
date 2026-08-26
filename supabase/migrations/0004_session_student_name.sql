-- M2 review, Important 3. The profiles SELECT policy from 0001 reads
--   using (role = 'teacher' or id = (select auth.uid()))
-- so a TEACHER querying a STUDENT's profile gets zero rows. Verified against
-- this project: teacher -> student profile returns 200 [].
--
-- Every teacher-facing screen therefore fell back silently: the incoming
-- request read "A student wants Physics now", the in-call context bar read
-- "Your session", and session history could not show a student column at all.
--
-- Snapshotted onto the row rather than fixed by widening the profiles policy.
-- It matches the hourly_rate precedent from design spec §4 (history records
-- what was true at the time, so a later rename cannot rewrite the past), and
-- it does not open every student's profile to every teacher on the platform.
--
-- Written by the trigger, never by the caller, so it cannot be forged and
-- requestSession needs no change.

alter table public.sessions add column student_name text;

create or replace function public.enforce_session_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  s record;
begin
  if new.status <> 'pending' then
    raise exception 'a session must start pending, not %', new.status;
  end if;

  if new.started_at is not null or new.daily_room_url is not null then
    raise exception 'a new request cannot already be in a call';
  end if;

  -- The rate is the teacher's, read here rather than trusted from the caller.
  select role, hourly_rate into t
  from public.profiles
  where id = new.teacher_id;

  if t is null or t.role <> 'teacher' or t.hourly_rate is null then
    raise exception 'that teacher is unavailable';
  end if;

  if new.hourly_rate <> t.hourly_rate then
    raise exception 'hourly_rate must match the teacher profile';
  end if;

  -- The accept window belongs to the server (ACCEPT_WINDOW_SECONDS = 30).
  -- The margin absorbs clock skew between the app server and Postgres without
  -- letting a caller grant itself an hour to answer.
  if new.accept_deadline > now() + interval '60 seconds' then
    raise exception 'accept_deadline is out of range';
  end if;

  -- Snapshot the student's name for the teacher's screens. Read under
  -- security definer because the teacher's own token cannot see this row.
  select full_name into s
  from public.profiles
  where id = new.student_id;

  new.student_name := coalesce(s.full_name, 'A student');

  return new;
end;
$$;

create or replace function public.enforce_session_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
begin
  -- The terms of the deal are fixed once the row exists.
  if new.student_id      is distinct from old.student_id
  or new.teacher_id      is distinct from old.teacher_id
  or new.curriculum      is distinct from old.curriculum
  or new.grade           is distinct from old.grade
  or new.stream          is distinct from old.stream
  or new.subject         is distinct from old.subject
  or new.type            is distinct from old.type
  or new.hourly_rate     is distinct from old.hourly_rate
  or new.duration_minutes is distinct from old.duration_minutes
  or new.accept_deadline is distinct from old.accept_deadline
  or new.created_at      is distinct from old.created_at
  or new.student_name    is distinct from old.student_name then
    raise exception 'session terms are immutable';
  end if;

  if new.status = old.status then
    -- Timing is set by the accept transition, never by a bare update.
    if new.started_at is distinct from old.started_at
    or new.daily_room_url is distinct from old.daily_room_url then
      raise exception 'session timing is set by the accept transition only';
    end if;
    return new;
  end if;

  -- Mirrors ALLOWED in src/lib/session.ts.
  if not (
       (old.status = 'pending'  and new.status in ('active','accepted','declined','timed_out','cancelled'))
    or (old.status = 'accepted' and new.status in ('active','cancelled'))
    or (old.status = 'active'   and new.status = 'completed')
  ) then
    raise exception 'illegal session transition % -> %', old.status, new.status;
  end if;

  -- Answering a request is the teacher's move alone.
  if new.status in ('active','accepted','declined')
     and uid is distinct from old.teacher_id then
    raise exception 'only the teacher may answer a request';
  end if;

  if new.status = 'cancelled' and uid is distinct from old.student_id then
    raise exception 'only the student may cancel a request';
  end if;

  if new.status = 'completed'
     and uid is distinct from old.student_id
     and uid is distinct from old.teacher_id then
    raise exception 'only a participant may complete a session';
  end if;

  -- A request times out because its deadline passed, not because someone says so.
  if new.status = 'timed_out'
     and (old.accept_deadline is null or old.accept_deadline > now()) then
    raise exception 'a request can only time out after its deadline';
  end if;

  -- Without this the read-time rule has no clock and the row is active forever.
  if new.status = 'active' and new.started_at is null then
    raise exception 'an active session must record started_at';
  end if;

  return new;
end;
$$;
