-- Cycle 2, spec §4.2 and §4.3. The push-subscription registry.
--
-- Read this before changing anything here: a row in this table is a
-- CAPABILITY, not a record. Anyone holding an endpoint plus its keys can wake
-- that teacher's phone. That is why select is owner-only, why the roster RPC
-- (0009) publishes a boolean instead of a join, and why the probe's single
-- most important assertion is that a student reading this table gets nothing.

create table public.teacher_devices (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references public.profiles (id) on delete cascade,
  -- One legal value today. The column exists from day one because it is the
  -- App Store seam: an APNs or FCM adapter adds a value here and an adapter
  -- file, and no caller changes (spec §8.1, §10).
  transport      text not null check (transport in ('webpush')),
  endpoint       text not null,
  p256dh         text not null,
  auth           text not null,
  user_agent     text,
  created_at     timestamptz not null default now(),
  last_ok_at     timestamptz,
  last_failed_at timestamptz,
  -- A 404/410 at send time is the ONLY death signal a push subscription has:
  -- userVisibleOnly is mandatory, so there is no silent probe. These columns
  -- are how a transient failure is told apart from a dead device.
  failure_count  int not null default 0
);

create unique index teacher_devices_endpoint_idx on public.teacher_devices (endpoint);
create index teacher_devices_teacher_idx on public.teacher_devices (teacher_id);

alter table public.teacher_devices enable row level security;

create policy teacher_devices_select on public.teacher_devices
  for select to authenticated using (auth.uid() = teacher_id);

create policy teacher_devices_insert on public.teacher_devices
  for insert to authenticated with check (auth.uid() = teacher_id);

create policy teacher_devices_update on public.teacher_devices
  for update to authenticated
  using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

create policy teacher_devices_delete on public.teacher_devices
  for delete to authenticated using (auth.uid() = teacher_id);

-- Registration goes through this rather than a raw upsert. Two teachers
-- sharing one browser profile produce the SAME endpoint; a plain upsert would
-- have to update a row owned by someone else, RLS would correctly refuse, and
-- the teacher would watch setup fail for no visible reason.
--
-- The risk this leaves, stated rather than assumed away (spec §4.3): the
-- arguments come from the caller, so this cannot PROVE the caller holds the
-- subscription. Someone who learned another teacher's full triple could
-- reassign it — stripping that teacher's reachability and misrouting their
-- notifications. Three things make that acceptable: endpoints never leave the
-- server (select is owner-only; the roster RPC publishes a boolean),
-- reassignment requires all three values rather than the endpoint alone, and
-- sign-out already deletes the row, so reassignment is the rare path.
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

