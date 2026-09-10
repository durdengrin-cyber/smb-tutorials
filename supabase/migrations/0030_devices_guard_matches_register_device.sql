-- 0029 gave the admin permission to register a device and it changed nothing.
--
-- register_device's own gate reads `role in ('teacher', 'admin')`, and that IS
-- live. The insert on the next line then hits teacher_devices_guard — the
-- BEFORE INSERT trigger added by 0009 — whose function still requires
-- `role = 'teacher'`. The function permits the admin; the table refuses them
-- one layer down, so 0029 has been applied in production since 2026-09-10 and
-- has never once let an admin through.
--
-- Proven, not inferred: register_device called with a real admin JWT returns
-- P0001 "teacher_devices requires a teacher profile", while the same call with
-- a teacher JWT returns 204. That error string exists only in 0009.
--
-- This is the whole reason the admin alert could never fire, which is the loose
-- end 0029 was written to close.
--
-- What 0009's guard is FOR, and what must not be lost: its RLS policy is
-- `auth.uid() = teacher_id`, which a student posting under their own id
-- trivially satisfies. The guard is what stops a non-teacher inserting a row
-- for themselves. Widening it to include admins keeps that intact — a student
-- is still refused — and makes it agree with the function that is the only
-- supported way in.
--
-- The two role lists must now stay in step. teacher_devices is also misnamed
-- (it holds admin devices too; push_devices would be honest) and is referenced
-- in 13 files including applied migrations, so the rename is recorded in
-- project_state.md rather than done here.

create or replace function public.devices_requires_teacher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Deliberately the same list as register_device's gate. An admin registers a
  -- device so the vetting queue can reach them; a student still cannot.
  if not exists (
    select 1 from public.profiles
    where id = new.teacher_id and role in ('teacher', 'admin')
  ) then
    raise exception 'teacher_devices requires a teacher or admin profile';
  end if;
  return new;
end;
$$;
