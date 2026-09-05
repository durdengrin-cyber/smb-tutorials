-- Cycle 2, spec §4.1 and §4.3. The durable half of "available": a
-- declaration that survives a closed tab, with a lease so it cannot become a
-- ghost that outlives the teacher's intent.
--
-- Deliberately a NEW TABLE rather than columns on profiles. profiles carries
-- the known-broken update policy from cycle-1 spec §17.1 (no column
-- restriction — any signed-in user can rewrite their own row, including
-- role), and cycle 3 is blocked on closing it. Hanging a hot column off that
-- table would entangle this cycle with that debt; a new table gets correct
-- column-scoped RLS from day one and inherits nothing.
--
-- NOTE: migration 0006 is deliberately UNAPPLIED (it would permit role =
-- 'admin' before a role-write guard exists). Nothing below depends on it.

create table public.teacher_availability (
  teacher_id     uuid primary key references public.profiles (id) on delete cascade,
  declared       boolean     not null default false,
  declared_at    timestamptz,
  declared_until timestamptz,          -- the lease; NULL when not declared
  updated_at     timestamptz not null default now()
);

-- Partial: the roster only ever asks about teachers who are declared.
create index teacher_availability_live_idx
  on public.teacher_availability (declared_until)
  where declared;

alter table public.teacher_availability enable row level security;

-- Availability is not secret, and the roster read needs it. Cycle 1 already
-- put /find and /teachers behind sign-in, so "authenticated" is the whole
-- audience.
create policy teacher_availability_select on public.teacher_availability
  for select to authenticated using (true);

create policy teacher_availability_insert on public.teacher_availability
  for insert to authenticated with check (auth.uid() = teacher_id);

create policy teacher_availability_update on public.teacher_availability
  for update to authenticated
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);

-- No delete policy on purpose. Rows are toggled, never removed; the FK's
-- `on delete cascade` still fires when a profile goes, because FK actions do
-- not consult RLS.

-- A student cannot park a declaration. The roster joins profiles on
-- role = 'teacher' anyway, so this is defence in depth rather than the only
-- guard — but a table whose job is to be authoritative should not accept
-- rows that can never be true.
create or replace function public.availability_requires_teacher()
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
    raise exception 'teacher_availability requires a teacher profile';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger teacher_availability_guard
  before insert or update on public.teacher_availability
  for each row execute function public.availability_requires_teacher();

