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
  add column if not exists vetted_by     uuid references public.profiles (id) on delete set null,
  add column if not exists vetting_note  text;

alter table public.profiles drop constraint if exists profiles_vetting_state_check;
alter table public.profiles add constraint profiles_vetting_state_check
  check (vetting_state in ('unvetted', 'cleared'));

-- The waiting list is read by state; every other read is by id.
create index if not exists profiles_vetting_state_idx
  on public.profiles (vetting_state) where role = 'teacher';

-- The gate. available_teachers is the ONE published roster read — the student
-- list, the push dispatch and the session guard all consume it — so one added
-- predicate closes every path at once.
--
-- The body below is 0020_teacher_suspensions' copy — the CURRENT definition —
-- unchanged except for the vetting_state line. It is NOT 0010's: 0020 added the
-- suspension filter, and rebuilding from 0010 would silently delete it and put
-- every suspended teacher back in front of children.
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
    -- Vetting (0021). Suspension below removes a teacher AFTER a report;
    -- this refuses one who was never checked in the first place. Both are
    -- needed: they answer different questions and are set by different people.
    and p.vetting_state = 'cleared'
    and a.declared
    and a.declared_until > now()
    -- Suspension (0020). A conduct report removes a teacher from discovery
    -- immediately and automatically; a report filed at 2am must not wait for
    -- someone to wake up.
    and not exists (
      select 1 from public.teacher_suspensions ts
      where ts.teacher_id = p.id and ts.lifted_at is null
    )
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

revoke all on function public.available_teachers(text, text, text, text)
  from public, anon, authenticated;
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

  if p_state not in ('unvetted', 'cleared') then
    raise exception 'invalid vetting state: %', p_state;
  end if;

  -- Transaction-local, reset at commit so it cannot leak into a later statement
  -- on a pooled connection. PostgREST gives a client no way to call set_config,
  -- so an ordinary UPDATE can never arrive with this flag on. Mirrors 0013.
  perform set_config('app.allow_vetting_change', 'on', true);

  update public.profiles
     set vetting_state = p_state,
         -- vetted_at and vetted_by record WHO DID THE CHECK and when, so they
         -- move together and only on the transition that means "a person
         -- looked": clearing. Stamping vetted_by on every transition would let
         -- a later suspension overwrite the only record of who cleared this
         -- teacher, leaving the row reading "cleared at T by X" where X never
         -- cleared anyone (spec §10 exists to preserve exactly that record).
         vetted_at    = case when p_state = 'cleared' then now() else vetted_at end,
         vetted_by    = case when p_state = 'cleared' then v_actor else vetted_by end,
         -- coalesce, not assignment: a caller that omits a note must not erase
         -- the note someone else wrote.
         vetting_note = coalesce(p_note, vetting_note)
   where id = p_teacher_id
     and role = 'teacher';

  if not found then
    raise exception 'no teacher with id %', p_teacher_id;
  end if;
end;
$$;

revoke all on function public.set_vetting_state(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.set_vetting_state(uuid, text, text) to authenticated;

-- 4. The gate must not be openable by the person it gates -------------------
--
-- THE HOLE THIS CLOSES, and it is 0013's hole on a new column. 0001's policy
-- is `for update using (id = auth.uid())`. It constrains WHO may update a row
-- and says nothing about WHICH COLUMNS, and Supabase grants `authenticated`
-- UPDATE on the table. 0013 closed that for `role` alone. Without the trigger
-- below, a teacher holding nothing but the anon key that ships in the browser
-- bundle could
--
--     PATCH /rest/v1/profiles?id=eq.<self>  {"vetting_state":"cleared"}
--
-- and publish themselves to the student roster unvetted — an adult matched one
-- to one on video with a child, which is the exact configuration §10 exists to
-- prevent. vetted_at, vetted_by and vetting_note are forgeable the same way,
-- so all four move together.
--
-- Gated on a transaction-local setting rather than a role-name allowlist, for
-- 0013's reasons: an allowlist silently grants any role added later, and the
-- name a definer function runs under is an implementation detail.
--
-- SECURITY INVOKER on purpose (the default): it needs no privilege of its own.
create or replace function public.profiles_vetting_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.vetting_state is distinct from old.vetting_state
      or new.vetted_at    is distinct from old.vetted_at
      or new.vetted_by    is distinct from old.vetted_by
      or new.vetting_note is distinct from old.vetting_note)
     and coalesce(current_setting('app.allow_vetting_change', true), '') <> 'on'
  then
    raise exception
      'profiles vetting columns cannot be changed directly (use set_vetting_state)';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_vetting_immutable on public.profiles;
create trigger profiles_vetting_immutable
  before update on public.profiles
  for each row execute function public.profiles_vetting_immutable();

-- 5. Vetting state is not public information --------------------------------
--
-- The select policy on profiles is `role = 'teacher' or id = auth.uid()`, so
-- every teacher row is world-readable — that is deliberate, it is how students
-- browse. But it would also publish who is `suspended` or `removed` and any
-- note written about them, to anonymous visitors. Column-level revokes keep
-- the row public and the judgement private.
--
-- Safe against `select *`: every profiles read in this codebase names its
-- columns (verified 2026-09-09), so no existing query breaks.
revoke select (vetting_state, vetted_at, vetted_by, vetting_note)
  on public.profiles from anon, authenticated;

-- The one thing a teacher legitimately needs: their OWN state, for the banner
-- that tells them why no requests are arriving. Returns nothing about anyone
-- else, and no note — the note is the operator's working record, not a message
-- to the teacher.
create or replace function public.my_vetting_state()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select p.vetting_state
    from public.profiles p
   where p.id = auth.uid();
$$;

revoke all on function public.my_vetting_state() from public, anon, authenticated;
grant execute on function public.my_vetting_state() to authenticated;
