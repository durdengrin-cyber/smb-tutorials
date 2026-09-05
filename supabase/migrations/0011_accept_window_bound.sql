-- Cycle 2, Task 14 (design spec §5.3). ACCEPT_WINDOW_SECONDS moves from 30 to
-- 60 in src/lib/session.ts, because 30s was sized for a teacher already
-- looking at the screen and does not fit a locked phone waking up (delivery,
-- noticing, unlocking, tapping). accept_deadline is computed on the app
-- server and then checked against Postgres's own now() here, so the insert
-- trigger's bound must widen too, or the skew margin shrinks — at 60s
-- unchanged against a 60s window it hits zero, and every session-request
-- insert would raise the instant the app server's clock ran even slightly
-- ahead of Supabase's: intermittent, environment-dependent, and would look
-- like nobody can request a teacher. The bound moves from 60s to 120s, which
-- doubles the margin (30s -> 60s) rather than merely preserving it — 90s
-- would have preserved the original 30s margin; 120s is the deliberately
-- larger, rounder bound this migration was asked to set.
--
-- Base: 0005_payments.sql's enforce_session_insert() (lines 76-139), which is
-- the LIVE definition — it superseded 0003_session_integrity.sql's version
-- (and 0004's identical carry-forward) with `create or replace function`.
-- Copied verbatim except the bound itself and the comment above it. In
-- particular this preserves, unchanged from 0005:
--   * the pending-status check (a session must start pending)
--   * the started_at/daily_room_url ban (a new request cannot already be in
--     a call)
--   * the payment-columns ban (payment_ref, payment_provider,
--     payment_checkout_url, amount_paid_paise, refund_ref must all be null on
--     insert) — the security control 0005 added that 0003 knows nothing
--     about; basing this migration on 0003 instead would have silently
--     reverted it
--   * the teacher/rate lookup and the hourly_rate match check
--   * the student_name snapshot
--
-- No new trigger: `create or replace function` keeps the existing
-- `sessions_enforce_insert` trigger's binding, so it does not need
-- recreating.

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

  -- The accept window belongs to the server (ACCEPT_WINDOW_SECONDS = 60, up
  -- from 30 — Task 14, design spec §5.3). The bound below gives a 60-second
  -- skew margin between the app server and Postgres (up from the original
  -- 30 seconds), so it still absorbs clock skew without letting a caller
  -- grant itself an hour to answer.
  if new.accept_deadline > now() + interval '120 seconds' then
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


-- PRE-FLIGHT, before applying:
-- select prosrc from pg_proc where proname = 'enforce_session_insert';
--   -- confirm the currently-live body still matches 0005's (nothing else has
--   -- redefined this function since); if it doesn't, stop and diff first.
