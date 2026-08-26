-- M2 review, Critical 2. The 0002 policies are row-level and therefore
-- column-blind: "participants update own sessions" lets either party PATCH
-- *any* column straight through PostgREST with the anon key and their own JWT.
-- The Server Actions hold the state machine, but they are not the only writer.
--
-- Two reachable consequences, both closed here:
--   * A student sets status = 'active' and leaves started_at null. The
--     read-time rule cannot expire a row it has no clock for, so that row is
--     `active` forever and its teacher can never accept another request.
--   * hourly_rate is snapshotted at request time (design spec §4) precisely so
--     a later rate change cannot rewrite what a past session was worth — and
--     then left mutable by both parties. M3 puts Stripe on that column.
--
-- Enforced with triggers rather than column grants so the Server Actions keep
-- writing through the user's token: the rule is about which transition, by
-- whom, not which role.

create or replace function public.enforce_session_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
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
  or new.created_at      is distinct from old.created_at then
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

create trigger sessions_enforce_insert
  before insert on public.sessions
  for each row execute function public.enforce_session_insert();

create trigger sessions_enforce_update
  before update on public.sessions
  for each row execute function public.enforce_session_update();
