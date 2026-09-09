-- Spec §10, §13. Adults meeting children one to one on video is the highest-risk
-- configuration in this product, and until now canBecomeTeacher checked only
-- that an account had no history.
--
-- What is recorded: that a check happened, by whom, and when. NOT the document.
-- Keeping a library of teachers' ID scans creates for teachers exactly the
-- honeypot §5.1 refuses to create for students.

alter table public.profiles
  add column if not exists vetting_state text not null default 'unvetted',
  add column if not exists vetted_at     timestamptz,
  add column if not exists vetted_by     uuid references public.profiles (id),
  add column if not exists vetting_note  text;

alter table public.profiles drop constraint if exists profiles_vetting_state_check;
alter table public.profiles add constraint profiles_vetting_state_check
  check (vetting_state in ('unvetted', 'cleared', 'suspended', 'removed'));

-- The waiting list is read by state; every other read is by id.
create index if not exists profiles_vetting_state_idx
  on public.profiles (vetting_state) where role = 'teacher';

-- The gate. available_teachers is the ONE published roster read — the student
-- list, the push dispatch and the session guard all consume it — so one added
-- predicate closes every path at once.
--
-- The body below is 0010's, unchanged except for the vetting_state line. If you
-- are changing this function for another reason, change 0010's copy of the
-- reasoning too.
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
    -- The only intended difference from 0010: an unvetted, suspended or
    -- removed teacher is never published, regardless of presence or subject
    -- match.
    and p.vetting_state = 'cleared'
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

-- Clearing is a privileged write, so it goes through a function rather than a
-- policy: 0013's discipline — the rule lives in one place and cannot be
-- forgotten by a future write path. The caller's identity is taken from
-- auth.uid(), never from an argument, so an admin cannot be impersonated by
-- passing someone else's id.
create or replace function public.set_vetting_state(
  p_teacher_id uuid,
  p_state      text,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public
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

  if p_state not in ('unvetted', 'cleared', 'suspended', 'removed') then
    raise exception 'invalid vetting state: %', p_state;
  end if;

  update public.profiles
     set vetting_state = p_state,
         -- vetted_at records when the CHECK happened, so it is stamped only on
         -- the transition that means "a person looked": clearing.
         vetted_at    = case when p_state = 'cleared' then now() else vetted_at end,
         vetted_by    = v_actor,
         vetting_note = p_note
   where id = p_teacher_id
     and role = 'teacher';

  if not found then
    raise exception 'no teacher with id %', p_teacher_id;
  end if;
end;
$$;

revoke all on function public.set_vetting_state(uuid, text, text) from public;
grant execute on function public.set_vetting_state(uuid, text, text) to authenticated;
