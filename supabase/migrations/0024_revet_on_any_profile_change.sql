-- Any change to a teacher's profile returns them to 'unvetted'.
--
-- 0023 covered the demo video. This widens it to the whole profile, because
-- the narrow version invites exactly the wrong question -- "is THIS field one
-- of the vetted ones?" -- and gets it wrong quietly. A teacher who was cleared
-- at 500/hour teaching Physics is not the same proposition at 5000/hour, and a
-- bio is free text shown to students that no admin has read.
--
-- WRITTEN AS AN EXCLUSION LIST, deliberately, and for the reason this codebase
-- already learned once: app-surface.test.ts was an inclusion list of route
-- groups until an entire route group nobody had named went un-repainted
-- through eight tasks. A column the list does not know about is invisible to
-- it, silently. So the comparison is "everything, minus these", and a column
-- added to profiles next month re-vets by default. Being wrong in that
-- direction costs a re-review; being wrong in the other costs a child.
--
-- Excluded, each because it is bookkeeping rather than something an admin
-- looked at:
--
--   id, role, created_at        immutable, or governed by their own triggers
--   vetting_state               the column this trigger is setting
--   consent_accepted_at/_version  stamped by the server, never typed
--   learner_first_name/_grade   a student's fields; meaningless on a teacher
--   guardian_phone_verified_at  guardian bookkeeping
--
-- full_name is compared NORMALISED, lower(btrim(...)), so that tidying
-- capitalisation or a stray space is not a rename:
--
--     "mr azad " -> "Mr. Azad"   no reset   (same person, better typing)
--     "Mr. Azad" -> "R. Khan"    RESET      (a different person entirely)
--
-- Nothing is smuggled through that: you cannot become someone else by changing
-- case. Every other field is compared exactly.

create or replace function public.profiles_vetting_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- The state the CALLER asked for, captured before the reset below can
  -- overwrite it. Judging the caller's own attempt rather than the final value
  -- keeps this strict: a PATCH carrying both a profile edit AND
  -- vetting_state='cleared' is refused outright rather than quietly downgraded
  -- to the reset and told nothing.
  v_attempted text := new.vetting_state;

  -- to_jsonb(record) minus the bookkeeping, with full_name replaced by its
  -- normalised form so a case fix compares equal.
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
begin
  -- 1. Re-vetting. Forced, never requested: no caller opts in, and none can
  --    opt out. In a BEFORE trigger, so it applies to every write path --
  --    including a direct PATCH with the anon key that ships in the browser,
  --    which is the hole 0013 exists to remember.
  --
  --    old.vetting_state = 'cleared' because there is nothing to reset for a
  --    teacher already in the queue.
  if new.role = 'teacher'
     and old.vetting_state = 'cleared'
     and v_new is distinct from v_old
     and coalesce(current_setting('app.allow_vetting_change', true), '') <> 'on'
  then
    new.vetting_state := 'unvetted';
  end if;

  -- 2. vetting_state remains writable only through set_vetting_state, which
  --    sets the flag. Compared against v_attempted so the reset above is not
  --    mistaken for the caller having tried to write the column.
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
  'returns them to unvetted (full_name compared case- and space-insensitively; '
  'bookkeeping columns excluded). vetting_state is otherwise writable only '
  'through set_vetting_state. See 0023, 0024.';
