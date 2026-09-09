-- What changed, and why this teacher is back in the queue.
--
-- 0024 sends a cleared teacher back to 'unvetted' when their profile changes,
-- which is correct and, on its own, unhelpful: /admin shows a name and the word
-- "unvetted", and the admin has to open the profile and compare it against
-- memory to find out what moved. That is the difference between a queue you
-- can work and a queue you dread.
--
-- The diff already exists. 0024's trigger builds the before/after JSON to
-- decide whether to reset at all, then throws it away. This keeps it.
--
-- Not an audit log of everything: only the changes that actually caused a
-- re-vet. A profile edit by an unvetted teacher, or one that changes nothing,
-- writes no row.

create table if not exists public.teacher_revet_events (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  changed_at timestamptz not null default now(),
  -- { "hourly_rate": { "from": 500, "to": 5000 }, ... }
  -- Values are the RAW ones, not the normalised forms 0024 compares, so the
  -- admin reads what the teacher actually typed.
  changes    jsonb not null
);

create index if not exists teacher_revet_events_teacher_idx
  on public.teacher_revet_events (teacher_id, changed_at desc);

-- RLS on with NO policies, exactly as teacher_vetting (0022): unreachable by
-- anon and authenticated whatever their grants say, and read only by the
-- service role, which is what /admin already uses. A teacher must not be able
-- to read — still less delete — the record of what they changed.
alter table public.teacher_revet_events enable row level security;
revoke all on public.teacher_revet_events from public, anon, authenticated;

comment on table public.teacher_revet_events is
  'Why a teacher is back in the vetting queue: the field-level diff that '
  'triggered a re-vet. Written by profiles_vetting_immutable (0026). Read by '
  '/admin through the service role. See 0024.';

create or replace function public.profiles_vetting_immutable()
returns trigger
language plpgsql
-- SECURITY DEFINER is new in 0026 and is REQUIRED, not incidental. The insert
-- below targets a table that anon and authenticated hold no grant on. Without
-- definer rights the insert runs as the teacher whose UPDATE fired the
-- trigger, is refused, and takes their entirely legitimate profile save down
-- with it. The function reads only OLD/NEW and writes only this one table, so
-- the elevated context buys exactly that insert and nothing else.
security definer
set search_path = ''
as $$
declare
  v_attempted text := new.vetting_state;

  -- Bookkeeping columns are excluded, not enumerated, so a column added to
  -- profiles next month re-vets by default. See 0024 for why that direction.
  v_old jsonb := (to_jsonb(old)
                    - 'id' - 'role' - 'vetting_state' - 'created_at'
                    - 'consent_accepted_at' - 'consent_version'
                    - 'learner_first_name' - 'learner_grade'
                    - 'guardian_phone_verified_at')
                 || jsonb_build_object('full_name',
                      lower(btrim(coalesce(old.full_name, ''))));
  v_new jsonb := (to_jsonb(new)
                    - 'id' - 'role' - 'vetting_state' - 'created_at'
                    - 'consent_accepted_at' - 'consent_version'
                    - 'learner_first_name' - 'learner_grade'
                    - 'guardian_phone_verified_at')
                 || jsonb_build_object('full_name',
                      lower(btrim(coalesce(new.full_name, ''))));
  v_changes jsonb;
begin
  if new.role = 'teacher'
     and old.vetting_state = 'cleared'
     and v_new is distinct from v_old
     and coalesce(current_setting('app.allow_vetting_change', true), '') <> 'on'
  then
    new.vetting_state := 'unvetted';

    -- Keys compared on the NORMALISED forms, so a case-only name fix is not
    -- reported as a change; values taken from the RAW row, so what the admin
    -- reads is what the teacher typed.
    select jsonb_object_agg(
             k.key,
             jsonb_build_object('from', to_jsonb(old) -> k.key,
                                'to',   to_jsonb(new) -> k.key)
           )
      into v_changes
      from (
        select key from jsonb_object_keys(v_new) as key
        union
        select key from jsonb_object_keys(v_old) as key
      ) k
     where v_new -> k.key is distinct from v_old -> k.key;

    if v_changes is not null then
      insert into public.teacher_revet_events (teacher_id, changes)
      values (new.id, v_changes);
    end if;
  end if;

  if v_attempted is distinct from old.vetting_state
     and coalesce(current_setting('app.allow_vetting_change', true), '') <> 'on'
  then
    raise exception
      'profiles.vetting_state cannot be changed directly (use set_vetting_state)';
  end if;

  return new;
end;
$$;

comment on function public.profiles_vetting_immutable() is
  'BEFORE UPDATE on profiles. Any change to a cleared teacher''s profile '
  'returns them to unvetted and records the field-level diff in '
  'teacher_revet_events (full_name compared case- and space-insensitively; '
  'bookkeeping columns excluded). vetting_state is otherwise writable only '
  'through set_vetting_state. See 0023, 0024, 0026.';
