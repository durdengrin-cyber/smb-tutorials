-- The account holder is the guardian; the learner is recorded on their profile.
-- Spec §4. sessions.grade has been constrained to '6th'..'12th' since 0002, so
-- every student on this platform is a minor by construction and there is no
-- adult-learner case to branch on.
begin;

alter table public.profiles
  add column if not exists learner_first_name text,
  -- Same domain as sessions.grade (0002) and teacher_subjects.grade (0001).
  -- Restated rather than referenced: a check constraint cannot point at
  -- another table's, and this is the third copy of one rule, which is the
  -- price of keeping the database the thing that enforces it.
  add column if not exists learner_grade text
    check (learner_grade is null or learner_grade in
      ('6th','7th','8th','9th','10th','11th','12th')),
  -- Stamped when the guardian's phone is verified: by operator call for the
  -- pilot, by OTP later (spec §5). The column does not care which.
  add column if not exists guardian_phone_verified_at timestamptz;

-- 0004 snapshotted the account holder's full_name into sessions.student_name so
-- a teacher would see something other than "A student" -- the profiles SELECT
-- policy from 0001 returns zero rows when a teacher reads a student's profile.
-- That reasoning is unchanged and so is the mechanism: written by the trigger,
-- never by the caller, so it cannot be forged. It just snapshots the right name
-- now. coalesce keeps every pre-existing account working unchanged.
-- FULL BODY, carried verbatim from 0011 (the authoritative definition -- 0003,
-- 0004, 0005 and 0011 have each redefined this function; 0011 is the latest).
-- ONLY the student_name snapshot at the bottom changes. Every other rule below
-- is load-bearing and `create or replace` would silently drop any omission --
-- including 0011's payment-column ban, which exists because a student's own
-- POST could otherwise carry a forged amount_paid_paise and inflate the figure
-- the reconciliation script treats as truth.
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

  -- Payment columns are the webhook's alone (0011, C2/C3/I1).
  if new.payment_ref is not null
  or new.payment_provider is not null
  or new.payment_checkout_url is not null
  or new.amount_paid_paise is not null
  or new.refund_ref is not null then
    raise exception 'a new request cannot already carry payment data';
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

  -- 120 seconds, not 60: raised in 0011 when ACCEPT_WINDOW_SECONDS went to 60.
  if new.accept_deadline > now() + interval '120 seconds' then
    raise exception 'accept_deadline is out of range';
  end if;

  -- THE ONLY CHANGE IN THIS MIGRATION. 0004 snapshotted the account holder's
  -- full_name here so a teacher would see something other than "A student" --
  -- the profiles SELECT policy from 0001 returns zero rows when a teacher
  -- reads a student's profile. The reasoning and the mechanism are unchanged
  -- (written by the trigger, never the caller, so it cannot be forged); it
  -- just snapshots the right name now. coalesce keeps every pre-existing
  -- account, which has no learner_first_name, working exactly as before.
  select coalesce(nullif(learner_first_name, ''), full_name) as name into s
  from public.profiles
  where id = new.student_id;

  new.student_name := coalesce(s.name, 'A student');

  return new;
end;
$$;

commit;
