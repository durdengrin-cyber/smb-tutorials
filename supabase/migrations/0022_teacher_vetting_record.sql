-- Closes the finding probe-vetting.mjs assertion 7 caught on 2026-09-09.
--
-- 0021 tried to hide the vetting columns with
--
--     revoke select (vetting_state, vetted_at, vetted_by, vetting_note)
--       on public.profiles from anon, authenticated;
--
-- which is a no-op. In Postgres a column-level revoke only removes
-- column-level grants; anon and authenticated both hold TABLE-level SELECT on
-- profiles, and a table-level grant covers every column — including columns
-- added later. So the operator's private judgement about a person was readable
-- by anyone signed in.
--
-- The fix is not a longer grant list. Enumerating the 19 other columns would
-- work until someone adds the 20th and it silently vanishes from the app.
-- Instead the judgement moves out of profiles entirely, into a table only an
-- admin path touches — the same shape 0020 used for teacher_suspensions, and
-- for the same reason.
--
-- What stays on profiles is `vetting_state` alone, because it is the GATE:
-- available_teachers reads it on every roster query, and it is barely more
-- public than the roster itself ('unvetted' or 'cleared' — suspension is not
-- in this column). What moves is everything judgemental: who cleared them,
-- when, and the note.

-- 1. The record ------------------------------------------------------------
create table if not exists public.teacher_vetting (
  teacher_id uuid primary key references public.profiles (id) on delete cascade,
  vetted_at  timestamptz not null default now(),
  -- set null, not cascade: deleting an admin account must not delete the
  -- evidence that a teacher was checked.
  vetted_by  uuid references public.profiles (id) on delete set null,
  note       text
);

alter table public.teacher_vetting enable row level security;

-- No policies, deliberately. RLS with no policy denies everything, so the only
-- ways in are the security-definer function below and the service role. There
-- is no shape of client request that reads this table.
revoke all on public.teacher_vetting from public, anon, authenticated;

-- 2. Carry the existing record across before the columns go -----------------
insert into public.teacher_vetting (teacher_id, vetted_at, vetted_by, note)
select id, vetted_at, vetted_by, vetting_note
  from public.profiles
 where vetted_at is not null
on conflict (teacher_id) do nothing;

-- 3. The trigger guards one column now --------------------------------------
-- Replaced BEFORE the columns are dropped: plpgsql resolves names at run time,
-- so a function still naming new.vetted_at would not fail until the next
-- profile update — which is to say, in front of a user.
create or replace function public.profiles_vetting_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.vetting_state is distinct from old.vetting_state
     and coalesce(current_setting('app.allow_vetting_change', true), '') <> 'on'
  then
    raise exception
      'profiles.vetting_state cannot be changed directly (use set_vetting_state)';
  end if;
  return new;
end;
$$;

-- 4. One call still writes both halves --------------------------------------
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

  perform set_config('app.allow_vetting_change', 'on', true);

  update public.profiles
     set vetting_state = p_state
   where id = p_teacher_id
     and role = 'teacher';

  if not found then
    raise exception 'no teacher with id %', p_teacher_id;
  end if;

  -- The record is written only when a person actually cleared them. Un-vetting
  -- someone leaves the previous record standing: it remains true that a check
  -- happened on that date, and overwriting it would destroy the only evidence
  -- of who did it.
  if p_state = 'cleared' then
    insert into public.teacher_vetting (teacher_id, vetted_at, vetted_by, note)
    values (p_teacher_id, now(), v_actor, p_note)
    on conflict (teacher_id) do update
      set vetted_at = now(),
          vetted_by = v_actor,
          -- coalesce so a clear-without-note does not erase an existing one.
          note      = coalesce(excluded.note, public.teacher_vetting.note);
  end if;
end;
$$;

revoke all on function public.set_vetting_state(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.set_vetting_state(uuid, text, text) to authenticated;

-- 5. And the judgement leaves profiles ---------------------------------------
alter table public.profiles
  drop column if exists vetted_at,
  drop column if exists vetted_by,
  drop column if exists vetting_note;
