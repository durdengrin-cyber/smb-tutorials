-- M3 payments (design spec §3.1, §3.3, §4).
-- Statuses and transitions mirror ALLOWED in src/lib/session.ts. They must
-- change together: a status added here without a matching trigger rule
-- silently widens what a user token can write.
--
-- Wrapped in one transaction (I3, fix round 1): without it, a mid-file abort
-- can leave the status CHECK already widened to accept 'paid' while the new
-- trigger that guards who may set it is not yet installed — a live window
-- where 'paid' is writable by a user token, produced by the very migration
-- meant to prevent that.
begin;

alter table public.sessions
  add column payment_deadline  timestamptz,
  add column payment_ref       text,
  add column payment_provider  text,
  add column amount_paid_paise integer check (amount_paid_paise > 0),
  add column refund_ref        text,
  -- Stored so a student who backs out of checkout and taps Pay again resumes
  -- the SAME charge rather than opening a second one (design spec §7).
  add column payment_checkout_url text;

-- if exists: a partially-applied prior run may already have dropped this.
alter table public.sessions drop constraint if exists sessions_status_check;
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

-- Money that moved must say how much. NOT VALID (C1, fix round 1): the live
-- table already holds a `completed` row from a previous milestone's
-- verification run, written before this migration existed and so with no
-- amount_paid_paise at all. `add constraint ... check` validates every
-- existing row by default, and that row would abort the whole migration on a
-- CHECK payments never had a chance to satisfy. NOT VALID still enforces the
-- rule for every future insert and update — it only skips the retroactive
-- pass over history predating the column.
alter table public.sessions add constraint paid_has_amount
  check (status not in ('paid','active','completed') or amount_paid_paise is not null) not valid;

-- Money that moved must also say which charge it was, or reconciliation has
-- nothing to match against the provider's own record. Scoped to 'paid' only
-- (mirrors refunded_has_ref below), not 'active'/'completed' too: payment_ref
-- is write-once (see the trigger) so once a row is paid, active/completed
-- rows carry it forward without this constraint needing to re-check them —
-- unlike amount_paid_paise, which paid_has_amount checks across all three
-- because it has no write-once guard of its own.
alter table public.sessions add constraint paid_has_ref
  check (status <> 'paid' or payment_ref is not null);

-- Money that came back must say so.
alter table public.sessions add constraint refunded_has_ref
  check (status <> 'refunded' or refund_ref is not null);

-- Unique (I2, fix round 1), not just indexed: two rows sharing a charge
-- reference means a webhook resolving by that reference either errors or,
-- worse, marks both paid. Partial on "is not null" because every row starts
-- with no charge yet and null <> null for uniqueness purposes anyway.
-- if not exists: a partially-applied prior run may already have created this.
create unique index if not exists sessions_payment_ref_idx
  on public.sessions (payment_ref)
  where payment_ref is not null;

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

  -- Payment columns are the webhook's alone (C2/C3/I1, fix round 1): the
  -- insert trigger was never extended for M3, so a student's own POST could
  -- carry a forged amount_paid_paise and inflate the figure the
  -- reconciliation script treats as truth. A session is always born pending
  -- with no payment history yet, so this is an outright ban, not a
  -- service-role exception — mirrors the started_at/daily_room_url check
  -- above, which bans a request from already being in a call.
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

  -- Every payment column moves only through the payment webhook (service
  -- role) — on every path, not just the same-status one (C2/C3/I1, fix round
  -- 1). Before this fix, the same-status branch guarded amount_paid_paise /
  -- refund_ref / payment_provider, but the write-once check for payment_ref /
  -- payment_checkout_url lived only *inside* that branch — unreachable during
  -- pending -> accepted, the one transition a self-serve, untrusted teacher
  -- controls. A teacher could set payment_checkout_url in their own accept
  -- call and point the student at an off-platform payment page. Checking all
  -- six here, unconditionally, before any branching on status, closes both
  -- that gap and the mismatch where payment_provider was service-role-only
  -- while payment_ref, set by the same webhook call, was not.
  if (new.payment_ref          is distinct from old.payment_ref
   or new.payment_provider     is distinct from old.payment_provider
   or new.payment_checkout_url is distinct from old.payment_checkout_url
   or new.amount_paid_paise    is distinct from old.amount_paid_paise
   or new.refund_ref           is distinct from old.refund_ref)
     and uid is not null then
    raise exception 'payment columns are set by the payment webhook only';
  end if;

  -- Even the service role does not get to silently repoint an open charge —
  -- once a reference is recorded it is final, whoever is asking.
  if (old.payment_ref is not null
      and new.payment_ref is distinct from old.payment_ref)
  or (old.payment_checkout_url is not null
      and new.payment_checkout_url is distinct from old.payment_checkout_url) then
    raise exception 'a payment reference cannot be rewritten once set';
  end if;

  if new.status = old.status then
    -- Outside a transition, session timing does not move on its own.
    if new.started_at      is distinct from old.started_at
    or new.daily_room_url  is distinct from old.daily_room_url
    or new.payment_deadline is distinct from old.payment_deadline then
      raise exception 'session timing is set by a transition only';
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

  -- I4, fix round 1: requiring non-null was not enough on its own. The
  -- payment window belongs to the server (PAYMENT_WINDOW_SECONDS = 120), the
  -- same way ACCEPT_WINDOW_SECONDS belongs to the insert trigger's bound
  -- above. Both ends matter here, unlike accept_deadline's single upper
  -- bound: too short (e.g. now() + 1 second) and the student's Pay button is
  -- dead before checkout can even render; too long (e.g. now() + 10 years)
  -- and the accepting teacher has frozen their own availability for the life
  -- of the row. The margin absorbs clock skew between the app server and
  -- Postgres, matching 0003's accept_deadline idiom.
  if new.status = 'accepted'
     and new.payment_deadline not between now() + interval '60 seconds'
                                       and now() + interval '180 seconds' then
    raise exception 'payment_deadline is out of range';
  end if;

  -- Without this the read-time rule has no clock and the row is active forever.
  if new.status = 'active' and new.started_at is null then
    raise exception 'an active session must record started_at';
  end if;

  return new;
end;
$$;

commit;

-- PRE-FLIGHT, before applying:
-- select conname from pg_constraint where conrelid='public.sessions'::regclass and contype='c';
--   -- confirm the status CHECK is really named sessions_status_check
-- select status, count(*) from public.sessions group by status;
--   -- any paid/active/completed rows are why paid_has_amount is NOT VALID
