-- Cycle 3 (admin) needs a third role, and widening a CHECK against live data is
-- a migration whenever it happens. Doing it now means requireRole, the nav
-- config and the /home resolver are written once for three roles rather than
-- rewritten for a third.
--
-- No admin user is created here, and no RLS policy changes: the existing
-- profiles select policy (role = 'teacher' or id = auth.uid()) is unaffected.

alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'teacher', 'admin'));
