-- Spec §6. Two columns on profiles cannot answer "what did this family agree
-- to, and when, and how was it obtained" after a version bump -- the previous
-- agreement is overwritten. That is the question that matters if anything ever
-- goes wrong, so the record becomes its own append-only log, following the
-- notification_events precedent (0015).
begin;

create table if not exists public.consent_events (
  id            uuid primary key default gen_random_uuid(),
  -- set null, not cascade: deleting an account must not erase the record that
  -- consent was given, for the same reason notification_events keeps its rows.
  user_id       uuid references public.profiles (id) on delete set null,
  version       text not null,
  path          text not null check (path in (
                  'student_signup','tutor_signup','google_interstitial',
                  'reconsent','operator_verified')),
  accepted_at   timestamptz not null default now(),
  -- 0017's lesson: a report that destroyed its own evidence when the teacher
  -- was deleted was useless. A consent row whose user_id has gone null records
  -- that SOMEBODY agreed. The snapshot is what keeps it answering "who".
  subject_email text not null,
  detail        text
);

create index if not exists consent_events_user_idx
  on public.consent_events (user_id, accepted_at desc);

alter table public.consent_events enable row level security;

-- No policy for anyone. Reads are service-role only, as session_reports is
-- (0017), and there is no insert policy because every write goes through the
-- security definer function below. RLS with no policy denies everything.
--
-- The revoke names anon and authenticated EXPLICITLY. `from public` does not
-- remove a role's own grant, which is the bug 0012 shipped.
revoke all on public.consent_events from anon, authenticated;

-- The one write path. Stamps now() and auth.uid() in SQL, so a client cannot
-- forge either -- the discipline become_teacher (0013) established: the rule is
-- enforced in the database for every caller, not only the path the app takes.
create or replace function public.record_consent(
  p_version text,
  p_path    text,
  p_detail  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select email into v_email from public.profiles where id = v_uid;
  if v_email is null then
    raise exception 'no profile for this account';
  end if;

  insert into public.consent_events (user_id, version, path, subject_email, detail)
  values (v_uid, p_version, p_path, v_email, p_detail);

  -- profiles keeps the latest value as a convenience for reads; the log above
  -- is the record.
  update public.profiles
     set consent_accepted_at = now(),
         consent_version     = p_version
   where id = v_uid;
end;
$fn$;

revoke all on function public.record_consent(text, text, text) from public;
revoke all on function public.record_consent(text, text, text) from anon;
grant execute on function public.record_consent(text, text, text) to authenticated;

-- A brand-new signup has no session yet when the row must be written, so
-- handle_new_user writes it in the same transaction that creates the profile.
-- profiles.consent_accepted_at still takes the metadata value as a
-- convenience for reads (never evidence, per record_consent above). The
-- consent_events insert below deliberately leaves accepted_at out of its
-- column list so the table's default now() applies: metadata is
-- client-supplied and is never trusted for the evidence log, on this path
-- or any other.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $fn$
declare
  v_consent_at timestamptz := (new.raw_user_meta_data ->> 'consent_accepted_at')::timestamptz;
  v_version    text        := nullif(new.raw_user_meta_data ->> 'consent_version', '');
  v_role       text        := case when new.raw_user_meta_data ->> 'role' = 'teacher'
                                   then 'teacher' else 'student' end;
begin
  insert into public.profiles (
    id, role, full_name, email, phone,
    consent_accepted_at, consent_version,
    learner_first_name, learner_grade
  )
  values (
    new.id,
    v_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    v_consent_at,
    v_version,
    nullif(new.raw_user_meta_data ->> 'learner_first_name', ''),
    nullif(new.raw_user_meta_data ->> 'learner_grade', '')
  );

  if v_consent_at is not null and v_version is not null then
    insert into public.consent_events (user_id, version, path, subject_email)
    values (
      new.id,
      v_version,
      case when v_role = 'teacher' then 'tutor_signup' else 'student_signup' end,
      coalesce(new.email, '')
    );
  end if;

  return new;
end;
$fn$;

commit;
