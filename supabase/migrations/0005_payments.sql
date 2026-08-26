-- M3 payments (design spec §3.1, §3.3, §4).
-- Statuses and transitions mirror ALLOWED in src/lib/session.ts. They must
-- change together: a status added here without a matching trigger rule
-- silently widens what a user token can write.

alter table public.sessions
  add column payment_deadline  timestamptz,
  add column payment_ref       text,
  add column payment_provider  text,
  add column amount_paid_paise integer check (amount_paid_paise > 0),
  add column refund_ref        text,
  -- Stored so a student who backs out of checkout and taps Pay again resumes
  -- the SAME charge rather than opening a second one (design spec §7).
  add column payment_checkout_url text;

alter table public.sessions drop constraint sessions_status_check;
alter table public.sessions add constraint sessions_status_check
  check (status in (
    'pending','accepted','paid','active','completed',
    'declined','timed_out','cancelled','payment_expired','refunded'
  ));

-- The payment window's equivalent of pending_has_deadline: effectiveStatus()
-- can only expire an accepted row that carries a deadline, so a null-deadline
-- accepted row would hold its teacher hostage forever.
alter table public.sessions add constraint accepted_has_payment_deadline
  check (status <> 'accepted' or payment_deadline is not null);

-- Money that moved must say how much, and money that came back must say so.
alter table public.sessions add constraint paid_has_amount
  check (status not in ('paid','active','completed') or amount_paid_paise is not null);
alter table public.sessions add constraint refunded_has_ref
  check (status <> 'refunded' or refund_ref is not null);

create index sessions_payment_ref_idx on public.sessions (payment_ref);

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

  -- Money columns are writable only by the service role, i.e. only by the
  -- signature-verified webhook. A user token can never say what it paid.
  if (new.amount_paid_paise is distinct from old.amount_paid_paise
   or new.refund_ref        is distinct from old.refund_ref
   or new.payment_provider  is distinct from old.payment_provider)
     and uid is not null then
    raise exception 'payment columns are set by the payment webhook only';
  end if;

  if new.status = old.status then
    -- Outside a transition, only payment_ref may move, and only forward from
    -- null — that is checkout creation recording which charge it opened.
    if new.started_at      is distinct from old.started_at
    or new.daily_room_url  is distinct from old.daily_room_url
    or new.payment_deadline is distinct from old.payment_deadline then
      raise exception 'session timing is set by a transition only';
    end if;
    if (new.payment_ref is distinct from old.payment_ref and old.payment_ref is not null)
    or (new.payment_checkout_url is distinct from old.payment_checkout_url
        and old.payment_checkout_url is not null) then
      raise exception 'payment_ref cannot be rewritten once set';
    end if;
    return new;
  end if;

  -- Mirrors ALLOWED in src/lib/session.ts (M3 design spec §3.1).
  if not (
       (old.status = 'pending'  and new.status in ('accepted','declined','timed_out','cancelled'))
    or (old.status = 'accepted' and new.status in ('paid','payment_expired','cancelled'))
    or (old.status = 'paid'     and new.status in ('active','refunded'))
    or (old.status = 'active'   and new.status = 'completed')
  ) then
    raise exception 'illegal session transition % -> %', old.status, new.status;
  end if;

  -- THE security property (design spec §3.3): a student cannot mark themselves
  -- paid, and a teacher cannot mint themselves a room. Only the service role
  -- reaches these, and only the webhook holds the service role.
  if new.status in ('paid','active','refunded') and uid is not null then
    raise exception 'only the payment webhook may set %', new.status;
  end if;

  -- Answering a request is the teacher's move alone.
  if new.status in ('accepted','declined') and uid is distinct from old.teacher_id then
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

  -- Deadlines expire because time passed, not because someone said so.
  if new.status = 'timed_out'
     and (old.accept_deadline is null or old.accept_deadline > now()) then
    raise exception 'a request can only time out after its deadline';
  end if;
  if new.status = 'payment_expired'
     and (old.payment_deadline is null or old.payment_deadline > now()) then
    raise exception 'a payment can only expire after its deadline';
  end if;

  -- An accepted session must carry the clock the read-time rule needs.
  if new.status = 'accepted' and new.payment_deadline is null then
    raise exception 'an accepted session must record payment_deadline';
  end if;

  -- Without this the read-time rule has no clock and the row is active forever.
  if new.status = 'active' and new.started_at is null then
    raise exception 'an active session must record started_at';
  end if;

  return new;
end;
$$;

-- VERIFY, in the SQL Editor, after applying:
-- select count(*) from public.sessions where status = 'paid';  -- expect 0, column+status exist
-- select conname from pg_constraint where conrelid = 'public.sessions'::regclass
--   and conname in ('accepted_has_payment_deadline','paid_has_amount','refunded_has_ref');  -- expect 3
-- FAIL: accepted row with no payment_deadline
-- update public.sessions set status = 'accepted' where false;  -- (no rows; constraint proven by probe instead)
