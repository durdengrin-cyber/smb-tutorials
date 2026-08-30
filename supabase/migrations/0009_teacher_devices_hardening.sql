-- Cycle 2, hardening pass on 0008 (already applied live — do not edit that
-- file). Fixes two Important findings from review of 0008_teacher_devices.sql:
--
-- 1. register_device's delete / exists-check / insert-on-conflict were three
--    unsynchronized statements. Spec §4.3 requires the reassignment to be
--    ATOMIC on (endpoint, p256dh, auth); without a lock, a legitimate
--    re-registration can interleave with a concurrent call from someone who
--    has already learned the same triple, leaving the row attributed to the
--    wrong caller while both calls report success — exactly the silent
--    failure the function's own comments say it exists to prevent.
--
-- 2. teacher_devices had no schema-level guard against a non-teacher row.
--    register_device checked role = 'teacher' itself, but the raw PostgREST
--    insert path only enforces auth.uid() = teacher_id, which a student
--    posting a row under their own id trivially satisfies. 0007's sibling
--    table (teacher_availability) already has this guard
--    (availability_requires_teacher / teacher_availability_guard); this was
--    an oversight, not a deliberate asymmetry.
begin;

-- Same four-arg signature and body as 0008, with one addition: an advisory
-- lock covering the whole read-modify-write.
create or replace function public.register_device(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_uid and role = 'teacher'
  ) then
    raise exception 'only a teacher can register a device';
  end if;

  -- Serializes everything below, per endpoint, for the rest of this
  -- transaction: the delete, the exists-check and the insert-on-conflict
  -- must be seen as one atomic step by any other call racing on the same
  -- endpoint (spec §4.3), or the exists-check can pass for caller A a
  -- moment before caller B's insert changes what it would have found.
  -- hashtext(p_endpoint) keyed rather than a table-wide lock so unrelated
  -- endpoints never block each other; released automatically at commit.
  perform pg_advisory_xact_lock(hashtext(p_endpoint));

  -- Reassignment: the caller supplied the whole subscription, so this is the
  -- shared-device case rather than a hijack of an endpoint they only guessed.
  delete from public.teacher_devices
   where endpoint = p_endpoint
     and p256dh   = p_p256dh
     and auth     = p_auth
     and teacher_id <> v_uid;

  -- Anything still standing under this endpoint belongs to someone else and
  -- did NOT match the keys. Fail loudly: a silent no-op here would leave a
  -- teacher believing setup succeeded while nothing can reach them.
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
    set p256dh        = excluded.p256dh,
        auth          = excluded.auth,
        user_agent    = excluded.user_agent,
        -- A re-registration is a fresh start: an old failure streak must not
        -- follow a subscription that has just proved it is alive.
        failure_count = 0,
        last_failed_at = null;
end;
$$;

revoke all on function public.register_device(text, text, text, text) from public;
grant execute on function public.register_device(text, text, text, text) to authenticated;

-- A student cannot park a device row on their own id. RLS alone only checks
-- auth.uid() = teacher_id, which a student posting under their own id
-- trivially satisfies; this closes it the same way 0007 closes it for
-- teacher_availability. teacher_devices has no updated_at column, so unlike
-- availability_requires_teacher this does not set one.
create or replace function public.devices_requires_teacher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.teacher_id and role = 'teacher'
  ) then
    raise exception 'teacher_devices requires a teacher profile';
  end if;
  return new;
end;
$$;

create trigger teacher_devices_guard
  before insert or update on public.teacher_devices
  for each row execute function public.devices_requires_teacher();

commit;
