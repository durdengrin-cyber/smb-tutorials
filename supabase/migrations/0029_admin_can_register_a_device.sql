-- The admin alert has never worked, and could not have.
--
-- 5b73f86 shipped "the operator is pushed the moment a teacher applies", and
-- notifyAdminsOfApplication does read teacher_devices for every admin. But
-- register_device raises 'only a teacher can register a device' for any other
-- role, and NotificationSetup is mounted on exactly two routes — the teacher
-- setup page and the teacher dashboard — both of which redirect an admin to
-- /admin. So an admin has never had anywhere to press the button, the device
-- query has always returned empty, and the function has always logged
-- "[notify-admins] no admin device registered" and returned.
--
-- This was diagnosed on 2026-09-10 as "the admin has not registered a device".
-- That was wrong: they could not.
--
-- The table keeps its name. teacher_devices holding an admin's device reads
-- oddly, and push_devices would be the honest name — but it is referenced in
-- thirteen files including applied migrations, and renaming it to fix a word
-- is a large change with real risk for no behavioural gain. Recorded here as
-- naming debt rather than done quietly.
--
-- Everything else in this function is preserved verbatim from the live
-- definition, read out of production rather than rebuilt from an older
-- migration file: the advisory lock, the shared-device reassignment, the
-- loud refusal when an endpoint belongs to someone else, and the failure-count
-- reset. Only the role test changes.

create or replace function public.register_device(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Widened from 'teacher' alone. An admin is pushed when a teacher applies,
  -- which is the one alert in this product nobody else can act on. Students
  -- are still refused: nothing pushes to them, so a device row for one would
  -- be data with no reader.
  if not exists (
    select 1 from public.profiles
     where id = v_uid and role in ('teacher', 'admin')
  ) then
    raise exception 'only a teacher or an admin can register a device';
  end if;

  -- Serializes everything below, per endpoint, for the rest of this
  -- transaction: the delete, the exists-check and the insert-on-conflict must
  -- be seen as one atomic step by any other call racing on the same endpoint
  -- (spec 4.3), or the exists-check can pass for caller A a moment before
  -- caller B's insert changes what it would have found. hashtext(p_endpoint)
  -- keyed rather than a table-wide lock so unrelated endpoints never block
  -- each other; released automatically at commit.
  perform pg_advisory_xact_lock(hashtext(p_endpoint));

  -- Reassignment: the caller supplied the whole subscription, so this is the
  -- shared-device case rather than a hijack of an endpoint they only guessed.
  delete from public.teacher_devices
   where endpoint = p_endpoint
     and p256dh   = p_p256dh
     and auth     = p_auth
     and teacher_id <> v_uid;

  -- Anything still standing under this endpoint belongs to someone else and
  -- did NOT match the keys. Fail loudly: a silent no-op here would leave the
  -- caller believing setup succeeded while nothing can reach them.
  if exists (
    select 1 from public.teacher_devices
    where endpoint = p_endpoint and teacher_id <> v_uid
  ) then
    raise exception 'endpoint is registered to another account';
  end if;

  insert into public.teacher_devices
    (teacher_id, transport, endpoint, p256dh, auth, user_agent)
  values
    (v_uid, 'webpush', p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set p256dh         = excluded.p256dh,
        auth           = excluded.auth,
        user_agent     = excluded.user_agent,
        -- A re-registration is a fresh start: an old failure streak must not
        -- follow a subscription that has just proved it is alive.
        failure_count  = 0,
        last_failed_at = null;
end;
$$;

comment on function public.register_device(text, text, text, text) is
  'Registers a web-push subscription for the calling teacher OR admin. '
  'Students are refused: nothing pushes to them. The table is still called '
  'teacher_devices; see 0029 for why it was not renamed.';
