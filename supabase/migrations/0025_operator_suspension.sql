-- Admin-initiated suspension.
--
-- Until now a suspension could only be created by the trigger on conduct
-- reports: teacher_suspensions.session_report_id was NOT NULL, so a suspension
-- literally could not exist without a report to hang it on. The admin's only
-- lever was set_vetting_state(..., 'unvetted') -- "Send back to review" -- which
-- does remove a teacher from the roster, but says "nobody has checked this
-- person yet", which is a different statement from "I have stopped this person".
--
-- Two provenances, one table, and every row must have exactly one of them:
--
--   automatic  session_report_id set   -- a student filed a report
--   manual     suspended_by set        -- an admin decided
--
-- The CHECK below is what makes "a suspension with no origin" unrepresentable
-- rather than merely unlikely.
--
-- The teacher-facing copy needs no change: STATUS_COPY.suspended already reads
-- "Account under review" and deliberately names neither the report nor the
-- session, because a teacher who learns which session was reported learns who
-- reported them. That reticence happens to be exactly right for a manual
-- suspension too.

alter table public.teacher_suspensions
  alter column session_report_id drop not null;

alter table public.teacher_suspensions
  add column if not exists suspended_by uuid
    -- set null, not cascade, for the same reason lifted_by uses it: deleting
    -- an admin account must not delete the evidence that a teacher was
    -- suspended.
    references public.profiles (id) on delete set null,
  add column if not exists suspended_reason text;

alter table public.teacher_suspensions
  drop constraint if exists teacher_suspensions_provenance_check;
alter table public.teacher_suspensions
  add constraint teacher_suspensions_provenance_check
  check (session_report_id is not null or suspended_by is not null);

comment on column public.teacher_suspensions.suspended_by is
  'The admin who suspended this teacher by hand. NULL for a suspension opened '
  'automatically by a conduct report, which carries session_report_id instead.';

-- One open suspension per teacher, enforced rather than assumed. reinstate_teacher
-- lifts only the most recent one, so a second open row would keep a teacher off
-- the roster after the admin believed they had reinstated them -- invisibly,
-- because nothing in the UI counts them.
create unique index if not exists teacher_suspensions_one_open_idx
  on public.teacher_suspensions (teacher_id)
  where lifted_at is null;

create or replace function public.suspend_teacher(
  p_teacher_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_actor and role = 'admin'
  ) then
    raise exception 'not an admin';
  end if;

  -- A suspension with no stated reason is a decision nobody can review later,
  -- including the admin who made it. Required here rather than in the form,
  -- so it is required of every caller.
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to suspend a teacher';
  end if;

  if not exists (
    select 1 from public.profiles where id = p_teacher_id and role = 'teacher'
  ) then
    raise exception 'no teacher with id %', p_teacher_id;
  end if;

  -- Loudly, rather than silently stacking a second open row. The unique index
  -- above would refuse it anyway; this turns that into a message an admin can
  -- act on instead of a constraint violation.
  if exists (
    select 1 from public.teacher_suspensions
    where teacher_id = p_teacher_id and lifted_at is null
  ) then
    raise exception 'teacher % already has an open suspension', p_teacher_id;
  end if;

  insert into public.teacher_suspensions (teacher_id, suspended_by, suspended_reason)
  values (p_teacher_id, v_actor, btrim(p_reason));
end;
$$;

-- Revoked from anon AND authenticated BY NAME before granting back, not only
-- from public: Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on new public
-- functions to both roles explicitly, and `revoke ... from public` does not
-- remove a grant a named role holds. That is the bug 0012 shipped and 0013,
-- 0019 and 0020 have each restated since.
--
-- Granted back to authenticated because the admin page calls this with the
-- admin's own session, exactly as it calls set_vetting_state. The function is
-- SECURITY DEFINER, so the admin check INSIDE it is the control -- not the
-- grant.
revoke all on function public.suspend_teacher(uuid, text)
  from public, anon, authenticated;
grant execute on function public.suspend_teacher(uuid, text) to authenticated;
