-- Cycle 2, spec §4.4. The roster read, as ONE function.
--
-- Why a security definer function rather than a view or a join in the client:
-- 0008 makes teacher_devices readable only by its owner, because an endpoint
-- is a capability. But the student's list needs to know whether a teacher has
-- a working device. The derived answer is published; the thing that produced
-- it is not. Never add an endpoint, a key, or a device count to this result.
--
-- What it deliberately does NOT do: exclude teachers without a device. This
-- function is SQL and cannot see presence — presence lives in the Realtime
-- service, not in Postgres. A teacher who declared, has the dashboard open
-- and declined notifications is reachable right now, and hiding them here
-- would refuse work to someone able to take it. has_device is PUBLISHED, not
-- APPLIED; the client does the final AND against its presence roster,
-- because the client is the only place both facts exist at once.
begin;

create or replace function public.available_teachers(
  p_curriculum text,
  p_grade      text,
  p_stream     text,
  p_subject    text
)
returns table (teacher_id uuid, has_device boolean)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    exists (select 1 from public.teacher_devices d where d.teacher_id = p.id)
  from public.profiles p
  join public.teacher_availability a on a.teacher_id = p.id
  where p.role = 'teacher'
    and a.declared
    and a.declared_until > now()
    -- A NULL or empty argument means "any", NOT "none". /teachers renders
    -- legitimately with no criteria — that is why online-list carries a
    -- canStart guard — and such a student today sees every teacher, filtered
    -- by presence. Matching strictly here would hand them an empty list and
    -- call it honest.
    and exists (
      select 1 from public.teacher_subjects s
      where s.teacher_id = p.id
        and (coalesce(p_curriculum, '') = '' or s.curriculum = p_curriculum)
        and (coalesce(p_grade, '')      = '' or s.grade      = p_grade)
        and (coalesce(p_stream, '')     = '' or s.stream     = p_stream)
        and (coalesce(p_subject, '')    = '' or s.subject    = p_subject)
    )
    -- The in-session exclusion. Until this cycle, hiding a busy teacher was a
    -- SIDE EFFECT of presence untracking when they navigated into the call.
    -- That no longer suffices: a push-only teacher has no presence to drop,
    -- so without this a teacher would be listed as startable mid-lesson and
    -- pushed a fresh request while teaching.
    --
    -- This mirrors hasOpenRequest / effectiveStatus in src/lib/session.ts.
    -- One rule, two languages — the probe asserts they agree, status by
    -- status. If you change one, change both, or the probe goes red.
    and not exists (
      select 1 from public.sessions x
      where x.teacher_id = p.id
        and (
             (x.status = 'pending'  and x.accept_deadline  > now())
          or (x.status = 'accepted' and x.payment_deadline > now())
          or (x.status = 'paid')
          or (x.status = 'active'
              and x.started_at + make_interval(mins => x.duration_minutes) > now())
        )
    );
$$;

revoke all on function public.available_teachers(text, text, text, text) from public;
grant execute on function public.available_teachers(text, text, text, text) to authenticated;

commit;
