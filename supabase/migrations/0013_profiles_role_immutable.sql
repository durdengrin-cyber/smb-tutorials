-- Cycle 3 prerequisite. Closes the self-promotion hole in 0001.
--
-- THE HOLE, demonstrated live on 2026-09-04 with a throwaway account:
-- 0001's policy is `for update using (id = auth.uid()) with check (id =
-- auth.uid())`. It constrains WHO may update a row and says nothing about
-- WHICH COLUMNS, so a signed-in student could PATCH their own row with
-- {"role":"teacher","hourly_rate":99999} and get HTTP 200 — holding nothing
-- but the anon key, which ships in the browser bundle.
--
-- Why that is not merely untidy. Cycle 1 made profiles.role the sole authority
-- every auth gate trusts. A self-promoted teacher appears in student search,
-- can accept sessions with real children, and sets their own rate. It also
-- bypasses canBecomeTeacher (src/lib/routes.ts), the rule that exists to stop
-- an account WITH HISTORY converting — spec §5.1 says that must never happen.
--
-- And it is what blocks cycle 3. Migration 0006 adds 'admin' to the check
-- constraint and is deliberately unapplied, because with role self-writable it
-- would turn a student→teacher annoyance into self-service ADMIN promotion.
-- After this migration, 0006 becomes safe to apply.
begin;

-- 1. Metadata must never be able to name a privileged role -----------------
--
-- handle_new_user trusted raw_user_meta_data->>'role' verbatim. That is
-- CLIENT-CONTROLLED: it is whatever was passed to auth.signUp(). Today the
-- check constraint happens to contain the damage, since only 'student' and
-- 'teacher' are legal — but 0006 widens that constraint, and on the day it is
-- applied a signup carrying {"role":"admin"} would mint an admin. Pin the
-- allowed values here instead of relying on a constraint that is scheduled to
-- get looser. Teacher self-registration through /tutor-signup still works: it
-- is a deliberate product decision that teachers self-serve, and 'teacher' is
-- still accepted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name, email, phone)
  values (
    new.id,
    case
      when new.raw_user_meta_data ->> 'role' = 'teacher' then 'teacher'
      else 'student'
    end,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end;
$$;

-- 2. role becomes immutable to everything except become_teacher ------------
--
-- Gated on a TRANSACTION-LOCAL setting rather than on the caller's role name.
-- Two reasons. A role-name allowlist ('postgres', 'service_role', …) silently
-- grants any future role that happens to be added, and the name a security
-- definer function runs under is an implementation detail of how it was
-- created. This flag can only be set by the function below: PostgREST gives a
-- client no way to call set_config, so an ordinary UPDATE can never arrive
-- with it on.
--
-- SECURITY INVOKER on purpose (the default): this needs no privilege of its
-- own, and a definer trigger would be one more thing running as its owner for
-- no reason.
create or replace function public.profiles_role_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('app.allow_role_change', true), '') <> 'on'
  then
    raise exception
      'profiles.role cannot be changed directly (use become_teacher)';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_immutable on public.profiles;
create trigger profiles_role_immutable
  before update on public.profiles
  for each row execute function public.profiles_role_immutable();

-- 3. The one legitimate path, with the rule re-checked IN SQL --------------
--
-- canBecomeTeacher lived only in TypeScript, which means it only ever guarded
-- the path the app happened to take. Re-stated here so the database enforces
-- it no matter who is calling — the same "one rule, two languages" discipline
-- the availability RPC follows, and the reason the probe asserts parity.
--
-- Mirrors src/lib/routes.ts: an account with ANY session history or ANY
-- subject rows cannot convert; 'student' and 'teacher' may (the latter covers
-- a half-finished signup retrying, which by definition has neither).
create or replace function public.become_teacher(
  p_full_name   text,
  p_phone       text,
  p_hourly_rate int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_role     text;
  v_sessions int;
  v_subjects int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is null then
    raise exception 'no profile for this account';
  end if;

  select count(*) into v_sessions
    from public.sessions
   where student_id = v_uid or teacher_id = v_uid;

  select count(*) into v_subjects
    from public.teacher_subjects
   where teacher_id = v_uid;

  -- Fail closed and say which rule refused, so onboarding can tell a user
  -- with real history apart from one who simply is not eligible.
  if v_sessions <> 0 or v_subjects <> 0 then
    raise exception 'account has history and cannot be converted';
  end if;

  if v_role not in ('student', 'teacher') then
    raise exception 'this account cannot become a teacher';
  end if;

  -- Transaction-local: reset at commit, so it cannot leak into a later
  -- statement on a pooled connection.
  perform set_config('app.allow_role_change', 'on', true);

  update public.profiles
     set role        = 'teacher',
         full_name   = coalesce(p_full_name, full_name),
         phone       = coalesce(p_phone, phone),
         hourly_rate = coalesce(p_hourly_rate, hourly_rate)
   where id = v_uid;
end;
$$;

-- Revoke from anon AND authenticated BY NAME before granting. Supabase's
-- ALTER DEFAULT PRIVILEGES grants EXECUTE to both explicitly, and revoking
-- from PUBLIC does not remove a grant a named role holds — 0012 shipped that
-- exact mistake and had to be corrected in production. authenticated is then
-- granted back deliberately: this is the signed-in tutor-signup path.
revoke all on function public.become_teacher(text, text, int)
  from public, anon, authenticated;
grant execute on function public.become_teacher(text, text, int) to authenticated;

commit;
