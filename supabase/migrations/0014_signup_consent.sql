-- Records the consent given at signup, so it is evidence rather than an
-- assumption.
--
-- Why this is not covered by "a parent paid". The payer is never identified:
-- the STUDENT account pays, so a teenager using UPI and a parent using their
-- own card are indistinguishable in this schema. Payment also happens after
-- the teacher accepts, so it could not gate a match even if it were consent.
-- And agreeing to buy a lesson is not agreeing to how a child's data is
-- handled — which is the agreement that actually matters here, and which
-- becomes load-bearing the day session recording is switched on.

alter table public.profiles
  add column if not exists consent_accepted_at timestamptz,
  -- The wording agreed to. Never overwrite: if the terms change materially,
  -- a new version is a NEW agreement, and an old one must not be silently
  -- read as consent to it.
  add column if not exists consent_version text;

-- handle_new_user is the only writer of a profile row, so consent has to be
-- copied here or it is lost at signup. Both values originate server-side in
-- signUpStudent (the client says whether, the server says when).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $fn$
begin
  insert into public.profiles (
    id, role, full_name, email, phone,
    consent_accepted_at, consent_version
  )
  values (
    new.id,
    -- Unchanged from 0013, and still deliberate: metadata is client-controlled,
    -- so only these two values are ever honoured. This is what keeps a signup
    -- carrying role="admin" from minting one once 0006 widens the constraint.
    case when new.raw_user_meta_data ->> 'role' = 'teacher'
         then 'teacher' else 'student' end,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    (new.raw_user_meta_data ->> 'consent_accepted_at')::timestamptz,
    nullif(new.raw_user_meta_data ->> 'consent_version', '')
  );
  return new;
end;
$fn$;

