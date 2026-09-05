-- Cycle 2, spec §8. Recording what actually happened to a push.
--
-- 0008 created last_ok_at, last_failed_at and failure_count because "a 404/410
-- at send time is the ONLY death signal a push subscription has". The
-- dispatcher then shipped stamping last_failed_at alone: failure_count was
-- written in exactly one place in the whole system — reset to 0 on
-- re-registration (0009) — and last_ok_at was never written at all.
--
-- Why that is not cosmetic. A subscription failing persistently with anything
-- OTHER than 404/410 is never pruned (correctly — a bad minute at a push
-- service must not cost a teacher their reachability) and, with no counter,
-- is also never distinguishable from a healthy one. available_teachers keeps
-- publishing has_device = true for it, so the roster keeps ranking that
-- teacher as push-reachable and students keep spending the full 60s accept
-- window on a teacher who cannot be woken. That is the ghost-teacher failure
-- this cycle exists to delete, reached through a different door.
--
-- Why an RPC rather than a PostgREST update: `failure_count = failure_count +
-- 1` is a read-modify-write PostgREST cannot express. Doing it in the client
-- would mean SELECT-then-UPDATE, which two concurrent dispatches to the same
-- device silently undercount. Postgres can do it atomically in one statement;
-- nothing else can.

create or replace function public.record_device_results(
  p_ok     uuid[],
  p_failed uuid[]
)
returns void
language plpgsql
security definer
-- Every reference below is schema-qualified as well, which is the control
-- that actually closes relation shadowing via pg_temp. This matches the
-- standard the rest of the branch's security definer functions hold to.
set search_path = public
as $$
begin
  -- A delivery that succeeded clears the streak. Same reasoning as 0009's
  -- re-registration reset: a subscription that has just proved it is alive
  -- must not carry an old failure count forward.
  if p_ok is not null and array_length(p_ok, 1) is not null then
    update public.teacher_devices
       set last_ok_at    = now(),
           failure_count = 0
     where id = any (p_ok);
  end if;

  -- Recorded, never deleted. Only a 404/410 deletes a row, and that happens
  -- in the dispatcher; this side only counts.
  if p_failed is not null and array_length(p_failed, 1) is not null then
    update public.teacher_devices
       set last_failed_at = now(),
           failure_count  = failure_count + 1
     where id = any (p_failed);
  end if;
end;
$$;

-- The dispatcher is the only caller and it holds a privileged key (spec §12).
-- No end user has any business stamping delivery results.
--
-- REVOKE FROM anon AND authenticated BY NAME, not just from public. This is
-- the whole security control for this function and it is easy to get wrong:
-- Supabase ships ALTER DEFAULT PRIVILEGES that grant EXECUTE on new public
-- functions to anon and authenticated EXPLICITLY, and in Postgres revoking
-- from PUBLIC does not remove a grant held by a named role. A first version of
-- this migration revoked from public and authenticated only; anon kept its
-- default grant, and because this function is SECURITY DEFINER — so it bypasses
-- RLS rather than being scoped by it — that handed anyone holding the anon key
-- (which ships in the browser bundle) an UNAUTHENTICATED write against any
-- teacher's device row, not merely their own. Verified live before and after.
--
-- Note the contrast with register_device and available_teachers: those also
-- end up reachable by anon, but they defend inside their own bodies
-- (register_device raises 'not authenticated' on a null auth.uid()). This
-- function has no such interior check to fall back on, so the grant IS the
-- control and has to be exactly right.
revoke all on function public.record_device_results(uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.record_device_results(uuid[], uuid[]) to service_role;

