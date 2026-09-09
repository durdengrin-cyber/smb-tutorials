-- Re-vetting when the vetted artefact changes.
--
-- THE HOLE THIS CLOSES
--
-- The operator's instruction on /admin is "Check the ID against the name on
-- the account, watch the demo, then clear them." The demo video is therefore
-- the thing a stranger is judged on before being put in front of a child --
-- and until now it was editable after approval with nothing re-checking it.
--
--   1. Teacher applies. vetting_state = 'unvetted'. Invisible to students.
--   2. Operator watches the demo, clicks Clear. vetting_state = 'cleared'.
--      available_teachers now returns them.
--   3. Teacher opens /profile, pastes a DIFFERENT YouTube link, saves.
--   4. Nothing happens. They stay 'cleared'. Students are shown a video
--      nobody approved.
--
-- Step 4 is the defect. The gate protected the moment of approval and nothing
-- after it. Found on 2026-09-09 while writing copy for the profile form: the
-- sentence "Changing this sends your profile back for review" was typed, then
-- checked, and nothing did that. The copy was removed rather than left as a
-- lie; this is the missing behaviour it described.
--
-- WHY IN THE DATABASE
--
-- The profile form is not the only writer of this column. A signed-in user can
-- PATCH profiles directly with the anon key that ships in the browser bundle,
-- which is exactly how 0013's hole worked: a rule that lived only in
-- application code was not a rule. A BEFORE UPDATE trigger catches every path,
-- including the ones nobody has written yet.
--
-- WHY THIS FUNCTION AND NOT A SECOND TRIGGER
--
-- profiles_vetting_immutable already owns the question "when may
-- vetting_state change?". A separate trigger would split that answer across
-- two places and make correctness depend on trigger firing order, which
-- Postgres resolves alphabetically -- i.e. on a name someone could innocently
-- rename. One function, one answer.
--
-- SCOPE
--
-- demo_video_url only, deliberately. full_name is the OTHER thing the operator
-- checks (the ID is matched against it), and a cleared teacher who renames
-- themselves has invalidated that check just as thoroughly. Including it is a
-- product decision that was explicitly deferred, not an oversight; when it is
-- taken, it is one more column in the same IS DISTINCT FROM below.

create or replace function public.profiles_vetting_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- The state the CALLER asked for, captured before the reset below can
  -- overwrite it. Judging the caller's own attempt rather than the final value
  -- is what keeps this strict: someone who PATCHes a new video AND
  -- vetting_state='cleared' in one statement is still refused outright, rather
  -- than being quietly downgraded to the reset and told nothing.
  v_attempted text := new.vetting_state;
begin
  -- 1. The new rule. Forced, never requested: no caller opts in, and none can
  --    opt out.
  --
  --    IS DISTINCT FROM, not <>, so a NULL on either side counts as a change
  --    and a teacher editing only their rate is not knocked off the roster by
  --    a URL that did not move.
  --
  --    old.vetting_state = 'cleared' because there is nothing to reset for a
  --    teacher already in the queue, and forcing a value that is already set
  --    would make every profile save look like a state change.
  if new.role = 'teacher'
     and old.vetting_state = 'cleared'
     and new.demo_video_url is distinct from old.demo_video_url
     and coalesce(current_setting('app.allow_vetting_change', true), '') <> 'on'
  then
    new.vetting_state := 'unvetted';
  end if;

  -- 2. The existing rule, unchanged in substance: vetting_state is writable
  --    only through set_vetting_state, which sets the flag. The comparison is
  --    against v_attempted so that the reset performed above is not mistaken
  --    for the caller having tried to change the column themselves.
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
  'BEFORE UPDATE on profiles. Two rules: a teacher who replaces their demo '
  'video returns to unvetted (the artefact the operator approved has changed), '
  'and vetting_state is otherwise writable only through set_vetting_state. '
  'See 0023.';

-- The trigger itself is unchanged and is NOT recreated here: it already fires
-- BEFORE UPDATE FOR EACH ROW on public.profiles, which is what makes the
-- assignment to new.vetting_state above take effect. Dropping and recreating
-- it would widen this migration's blast radius for no gain.
