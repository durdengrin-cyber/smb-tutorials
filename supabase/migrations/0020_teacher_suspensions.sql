-- Spec: docs/superpowers/specs/2026-09-06-conduct-suspension-design.md
--
-- /terms has promised since cycle 3 that a conduct report suspends a teacher
-- pending review. Nothing did it: available_teachers filtered on role,
-- declared, declared_until, subject match and in-flight sessions, and there
-- was no suspension state in the schema at all.

create table public.teacher_suspensions (
  id                uuid primary key default gen_random_uuid(),
  teacher_id        uuid not null references public.profiles (id) on delete cascade,
  -- What caused it. The teacher must NEVER read this: it identifies the
  -- session, and therefore the student who reported them.
  session_report_id uuid not null references public.session_reports (id) on delete cascade,
  suspended_at      timestamptz not null default now(),
  -- Null while the review is open. Stamped by reinstate_teacher().
  lifted_at         timestamptz,
  lifted_by         uuid references public.profiles (id),
  outcome           text check (outcome in ('reinstated', 'removed')),
  note              text
);

-- The open-suspension lookup runs on every availability query. Partial,
-- because open suspensions are the rare case and the only case it asks about.
--
-- UNIQUE, and that is a correctness control rather than a speed one. The
-- trigger's "already under review" check and its insert are two statements:
-- two conduct reports from different students arriving concurrently both read
-- no open row and both insert one, and reinstate_teacher() lifts only the
-- newest (it takes `order by suspended_at desc limit 1`), silently leaving the
-- teacher suspended forever. At most one open suspension per teacher, enforced
-- by the database.
--
-- It ships together with `on conflict do nothing` on the trigger's insert, and
-- MUST NOT be applied without it: a unique index alone inverts the bug — the
-- losing insert would raise, the trigger would raise, and the student would be
-- told their safety report failed to file. A report must ALWAYS file; only the
-- duplicate suspension row is suppressed.
create unique index teacher_suspensions_open_idx
  on public.teacher_suspensions (teacher_id) where lifted_at is null;

-- RLS ON, and NO policy, exactly as 0016 does for session_reports. Without
-- this line the table is readable by anyone holding the public anon key,
-- which is every visitor. The teacher reads their own state through
-- my_suspension() below, which returns a timestamp and nothing else.
alter table public.teacher_suspensions enable row level security;

-- A SECOND read control, so RLS is not the only one — 0017 added exactly this
-- to session_reports, on this identical RLS-on-no-policy shape, and the
-- reasoning transfers whole: `authenticated` still holds the SELECT PRIVILEGE
-- from Supabase's default grants, so one `disable row level security`, or one
-- future policy written slightly too wide, opens the table in a single step.
-- This row carries session_report_id, which names the reported session and
-- therefore the student who reported it. Named roles, not `public`: revoking
-- from public does not remove a grant a named role holds (the 0012 lesson).
revoke select on public.teacher_suspensions from anon, authenticated;


-- ---------------------------------------------------------------------------
-- `cancelled` stays the status: a new one would mean changing the transition
-- table in two languages (src/lib/session.ts and 0005's trigger) for no gain.
-- But a student seeing a bare "Cancelled" on a session they did not cancel is
-- being told something false by omission. NULL means the student cancelled,
-- which is the only other path that produces `cancelled`.
alter table public.sessions add column cancellation_reason text
  check (cancellation_reason in ('teacher_suspended'));


-- ---------------------------------------------------------------------------
-- available_teachers(), replaced in full because `create or replace function`
-- takes no partial body. This is 0010's definition verbatim plus ONE clause,
-- marked "Suspension (0020)" below. Extracted with
-- `sed -n '17,70p' supabase/migrations/0010_available_teachers.sql` rather
-- than retyped: a transcription slip here silently changes who is discoverable.
create or replace function public.available_teachers(
  p_curriculum text,
  p_grade      text,
  p_stream     text,
  p_subject    text
)
returns table (teacher_id uuid, has_device boolean)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    exists (select 1 from public.teacher_devices d where d.teacher_id = p.id)
  from public.profiles p
  join public.teacher_availability a on a.teacher_id = p.id
  where p.role = 'teacher'
    and a.declared
    and a.declared_until > now()
    -- Suspension (0020). A conduct report removes a teacher from discovery
    -- immediately and automatically; a report filed at 2am must not wait for
    -- someone to wake up.
    and not exists (
      select 1 from public.teacher_suspensions ts
      where ts.teacher_id = p.id and ts.lifted_at is null
    )
    -- A NULL or empty argument means "any", NOT "none". /teachers renders
    -- legitimately with no criteria — that is why online-list carries a
    -- canStart guard — and such a student today sees every teacher, filtered
    -- by presence. Matching strictly here would hand them an empty list and
    -- call it honest.
    and exists (
      select 1 from public.teacher_subjects s
      where s.teacher_id = p.id
        and (coalesce(p_curriculum, '') = '' or s.curriculum = p_curriculum)
        and (coalesce(p_grade, '')      = '' or s.grade      = p_grade)
        and (coalesce(p_stream, '')     = '' or s.stream     = p_stream)
        and (coalesce(p_subject, '')    = '' or s.subject    = p_subject)
    )
    -- The in-session exclusion. Until this cycle, hiding a busy teacher was a
    -- SIDE EFFECT of presence untracking when they navigated into the call.
    -- That no longer suffices: a push-only teacher has no presence to drop,
    -- so without this a teacher would be listed as startable mid-lesson and
    -- pushed a fresh request while teaching.
    --
    -- This mirrors hasOpenRequest / effectiveStatus in src/lib/session.ts.
    -- One rule, two languages — the probe asserts they agree, status by
    -- status. If you change one, change both, or the probe goes red.
    and not exists (
      select 1 from public.sessions x
      where x.teacher_id = p.id
        and (
             (x.status = 'pending'  and x.accept_deadline  > now())
          or (x.status = 'accepted' and x.payment_deadline > now())
          or (x.status = 'paid')
          or (x.status = 'active'
              and x.started_at + make_interval(mins => x.duration_minutes) > now())
        )
    );
$$;

-- create or replace does not preserve a prior revoke, so both are re-stated.
revoke all on function public.available_teachers(text, text, text, text) from public;
grant execute on function public.available_teachers(text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- enforce_session_update(), replaced in full for the same reason. This is
-- 0005's definition verbatim — extracted with
-- `sed -n '140,273p' supabase/migrations/0005_payments.sql` — with exactly two
-- edits, each marked in place: the cancellation gate is widened to admit the
-- service role, and cancellation_reason joins the server-set columns.
--
-- Why the widening is needed at all: `uid` is auth.uid(), which is NULL for the
-- service role, and `null is distinct from old.student_id` is TRUE — so before
-- this change NOBODY but that session's own student could cancel it, service
-- role included. settleSuspension cannot cancel a suspended teacher's sessions
-- until this changes.
--
-- 0005 attached the trigger and granted nothing on this function (checked:
-- 0005 contains no grant or revoke statements at all), so there are no
-- privileges to re-state here. The trigger itself is untouched and keeps
-- pointing at this name.
create or replace function public.enforce_session_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
begin
  -- The terms of the deal are fixed once the row exists.
  if new.student_id      is distinct from old.student_id
  or new.teacher_id      is distinct from old.teacher_id
  or new.curriculum      is distinct from old.curriculum
  or new.grade           is distinct from old.grade
  or new.stream          is distinct from old.stream
  or new.subject         is distinct from old.subject
  or new.type            is distinct from old.type
  or new.hourly_rate     is distinct from old.hourly_rate
  or new.duration_minutes is distinct from old.duration_minutes
  or new.accept_deadline is distinct from old.accept_deadline
  or new.created_at      is distinct from old.created_at
  or new.student_name    is distinct from old.student_name then
    raise exception 'session terms are immutable';
  end if;

  -- Every payment column moves only through the payment webhook (service
  -- role) — on every path, not just the same-status one (C2/C3/I1, fix round
  -- 1). Before this fix, the same-status branch guarded amount_paid_paise /
  -- refund_ref / payment_provider, but the write-once check for payment_ref /
  -- payment_checkout_url lived only *inside* that branch — unreachable during
  -- pending -> accepted, the one transition a self-serve, untrusted teacher
  -- controls. A teacher could set payment_checkout_url in their own accept
  -- call and point the student at an off-platform payment page. Checking all
  -- six here, unconditionally, before any branching on status, closes both
  -- that gap and the mismatch where payment_provider was service-role-only
  -- while payment_ref, set by the same webhook call, was not.
  if (new.payment_ref          is distinct from old.payment_ref
   or new.payment_provider     is distinct from old.payment_provider
   or new.payment_checkout_url is distinct from old.payment_checkout_url
   or new.amount_paid_paise    is distinct from old.amount_paid_paise
   or new.refund_ref           is distinct from old.refund_ref)
     and uid is not null then
    raise exception 'payment columns are set by the payment webhook only';
  end if;

  -- Server-set, like the payment columns above: a user token must not be able
  -- to forge a reason for its own cancellation.
  if new.cancellation_reason is distinct from old.cancellation_reason
     and uid is not null then
    raise exception 'cancellation_reason is set by the server only';
  end if;

  -- Even the service role does not get to silently repoint an open charge —
  -- once a reference is recorded it is final, whoever is asking.
  if (old.payment_ref is not null
      and new.payment_ref is distinct from old.payment_ref)
  or (old.payment_checkout_url is not null
      and new.payment_checkout_url is distinct from old.payment_checkout_url) then
    raise exception 'a payment reference cannot be rewritten once set';
  end if;

  if new.status = old.status then
    -- Outside a transition, session timing does not move on its own.
    if new.started_at      is distinct from old.started_at
    or new.daily_room_url  is distinct from old.daily_room_url
    or new.payment_deadline is distinct from old.payment_deadline then
      raise exception 'session timing is set by a transition only';
    end if;
    return new;
  end if;

  -- Mirrors ALLOWED in src/lib/session.ts (M3 design spec §3.1).
  if not (
       (old.status = 'pending'  and new.status in ('accepted','declined','timed_out','cancelled'))
    or (old.status = 'accepted' and new.status in ('paid','payment_expired','cancelled'))
    or (old.status = 'paid'     and new.status in ('active','refunded'))
    or (old.status = 'active'   and new.status = 'completed')
  ) then
    raise exception 'illegal session transition % -> %', old.status, new.status;
  end if;

  -- THE security property (design spec §3.3): a student cannot mark themselves
  -- paid, and a teacher cannot mint themselves a room. Only the service role
  -- reaches these, and only the webhook holds the service role.
  if new.status in ('paid','active','refunded') and uid is not null then
    raise exception 'only the payment webhook may set %', new.status;
  end if;

  -- Answering a request is the teacher's move alone.
  if new.status in ('accepted','declined') and uid is distinct from old.teacher_id then
    raise exception 'only the teacher may answer a request';
  end if;

  -- WIDENED in 0020: "the student, or the service role". Suspension cancels a
  -- teacher's not-yet-started sessions from server code, and uid is null there.
  -- Consistent with the model this function already uses — paid, active and
  -- refunded are already service-role-only — and it widens nothing a user token
  -- can do: a student token still cannot cancel another student's session, and
  -- a teacher token still cannot cancel at all.
  if new.status = 'cancelled' and uid is not null and uid is distinct from old.student_id then
    raise exception 'only the student may cancel a request';
  end if;

  if new.status = 'completed'
     and uid is distinct from old.student_id
     and uid is distinct from old.teacher_id then
    raise exception 'only a participant may complete a session';
  end if;

  -- Deadlines expire because time passed, not because someone said so.
  if new.status = 'timed_out'
     and (old.accept_deadline is null or old.accept_deadline > now()) then
    raise exception 'a request can only time out after its deadline';
  end if;
  if new.status = 'payment_expired'
     and (old.payment_deadline is null or old.payment_deadline > now()) then
    raise exception 'a payment can only expire after its deadline';
  end if;

  -- An accepted session must carry the clock the read-time rule needs.
  if new.status = 'accepted' and new.payment_deadline is null then
    raise exception 'an accepted session must record payment_deadline';
  end if;

  -- I4, fix round 1: requiring non-null was not enough on its own. The
  -- payment window belongs to the server (PAYMENT_WINDOW_SECONDS = 120), the
  -- same way ACCEPT_WINDOW_SECONDS belongs to the insert trigger's bound
  -- above. Both ends matter here, unlike accept_deadline's single upper
  -- bound: too short (e.g. now() + 1 second) and the student's Pay button is
  -- dead before checkout can even render; too long (e.g. now() + 10 years)
  -- and the accepting teacher has frozen their own availability for the life
  -- of the row. The margin absorbs clock skew between the app server and
  -- Postgres, matching 0003's accept_deadline idiom.
  if new.status = 'accepted'
     and new.payment_deadline not between now() + interval '60 seconds'
                                       and now() + interval '180 seconds' then
    raise exception 'payment_deadline is out of range';
  end if;

  -- Without this the read-time rule has no clock and the row is active forever.
  if new.status = 'active' and new.started_at is null then
    raise exception 'an active session must record started_at';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- enforce_session_insert(), replaced in full for the same reason and by the
-- same method — extracted with
-- `sed -n '32,92p' supabase/migrations/0018_guardian_account.sql`, which is the
-- authoritative definition (0003, 0004, 0005, 0011 and 0018 have each redefined
-- this function; 0018 is the latest). ONE rule is added, marked in place.
--
-- Why the UPDATE guard alone was not enough: the sessions INSERT path is
-- student-driven, and `is distinct from old` is false for a value that was
-- present from the very first row version. A student could therefore POST a
-- session already carrying cancellation_reason = 'teacher_suspended', cancel it
-- themselves, and be shown "your teacher was suspended" about a teacher who
-- never was. 0011 and 0018 ban the payment columns on both paths for precisely
-- this reason; this column now joins them.
--
-- 0018 grants and revokes nothing on this function (checked: it contains no
-- grant or revoke statement), so there are no privileges to re-state. The
-- BEFORE INSERT trigger from 0003 is untouched and keeps pointing at this name.
create or replace function public.enforce_session_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  s record;
begin
  if new.status <> 'pending' then
    raise exception 'a session must start pending, not %', new.status;
  end if;

  if new.started_at is not null or new.daily_room_url is not null then
    raise exception 'a new request cannot already be in a call';
  end if;

  -- Payment columns are the webhook's alone (0011, C2/C3/I1).
  if new.payment_ref is not null
  or new.payment_provider is not null
  or new.payment_checkout_url is not null
  or new.amount_paid_paise is not null
  or new.refund_ref is not null then
    raise exception 'a new request cannot already carry payment data';
  end if;

  -- Server-set on BOTH paths, added in 0020 alongside the UPDATE guard in
  -- enforce_session_update. The INSERT path is student-driven, so without this
  -- a student could POST a session already carrying
  -- cancellation_reason = 'teacher_suspended' and then cancel it themselves:
  -- the UPDATE guard never fires, because `is distinct from old` is false when
  -- the value was there from the start. The product would then tell that
  -- student their session ended because their teacher had been suspended.
  -- Exactly why 0011/0018 ban the payment columns on both paths rather than
  -- only on update.
  if new.cancellation_reason is not null then
    raise exception 'a new request cannot already carry a cancellation reason';
  end if;

  -- The rate is the teacher's, read here rather than trusted from the caller.
  select role, hourly_rate into t
  from public.profiles
  where id = new.teacher_id;

  if t is null or t.role <> 'teacher' or t.hourly_rate is null then
    raise exception 'that teacher is unavailable';
  end if;

  if new.hourly_rate <> t.hourly_rate then
    raise exception 'hourly_rate must match the teacher profile';
  end if;

  -- 120 seconds, not 60: raised in 0011 when ACCEPT_WINDOW_SECONDS went to 60.
  if new.accept_deadline > now() + interval '120 seconds' then
    raise exception 'accept_deadline is out of range';
  end if;

  -- THE ONLY CHANGE IN THIS MIGRATION. 0004 snapshotted the account holder's
  -- full_name here so a teacher would see something other than "A student" --
  -- the profiles SELECT policy from 0001 returns zero rows when a teacher
  -- reads a student's profile. The reasoning and the mechanism are unchanged
  -- (written by the trigger, never the caller, so it cannot be forged); it
  -- just snapshots the right name now. coalesce keeps every pre-existing
  -- account, which has no learner_first_name, working exactly as before.
  select coalesce(nullif(learner_first_name, ''), full_name) as name into s
  from public.profiles
  where id = new.student_id;

  new.student_name := coalesce(s.name, 'A student');

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reinstatement is manual and RECORDED. A raw UPDATE would leave no record of
-- who lifted it or why, and spec §12 requires the record: "a teacher
-- reinstated twice is a pattern nobody will see if reinstatement leaves no
-- row."
--
-- p_lifted_by exists because of how this is actually called. Stamping
-- auth.uid() alone looks right and is wrong: the operator invokes this from
-- the CLI holding the service role, where auth.uid() is NULL, so every
-- pilot-era lift would record that it happened and not who did it. The admin
-- UI (piece 3) passes nothing and auth.uid() fills in.
create or replace function public.reinstate_teacher(
  p_teacher_id uuid,
  p_outcome    text,
  p_note       text,
  p_lifted_by  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_outcome not in ('reinstated', 'removed') then
    raise exception 'outcome must be reinstated or removed, not %', p_outcome;
  end if;

  select ts.id into v_id
    from public.teacher_suspensions ts
   where ts.teacher_id = p_teacher_id and ts.lifted_at is null
   order by ts.suspended_at desc
   limit 1;

  -- Loudly, so a typo'd id fails instead of silently doing nothing.
  if v_id is null then
    raise exception 'no open suspension for teacher %', p_teacher_id;
  end if;

  -- 'removed' records the decision and leaves lifted_at NULL, so the
  -- suspension stays open and available_teachers keeps excluding them.
  -- Performing a removal is not this function's job.
  update public.teacher_suspensions
     set outcome   = p_outcome,
         note      = p_note,
         lifted_by = coalesce(p_lifted_by, (select auth.uid())),
         lifted_at = case when p_outcome = 'reinstated' then now() else null end
   where id = v_id;
end;
$$;

-- Revoked from anon AND authenticated BY NAME, not only from public. Supabase's
-- ALTER DEFAULT PRIVILEGES grants EXECUTE on new public functions to both roles
-- explicitly, and `revoke ... from public` does not remove a grant a named role
-- holds — the bug 0012 shipped, named in 0013 and 0019 ever since. This function
-- is SECURITY DEFINER, so the grant IS the control: without the anon line,
-- anyone holding the anon key that ships in the browser bundle could lift a
-- child-safety suspension. Nothing is granted back; the operator calls it with
-- the service role until the admin UI exists.
revoke all on function public.reinstate_teacher(uuid, text, text, uuid) from public;
revoke all on function public.reinstate_teacher(uuid, text, text, uuid) from anon;
revoke all on function public.reinstate_teacher(uuid, text, text, uuid) from authenticated;

-- Granted to service_role BY NAME rather than left to Supabase's default
-- privileges to supply. 0012 states the explicit grant as the pattern, and
-- relying on a default that happens to name service_role today is the exact
-- shape of assumption 0012 exists to warn against.
grant execute on function public.reinstate_teacher(uuid, text, text, uuid) to service_role;

-- The teacher's own state, and NOTHING else. Returns a timestamp, never the
-- report id — a teacher who learns which session was reported learns who
-- reported them, which is a retaliation vector in a child-safety feature.
create or replace function public.my_suspension()
returns timestamptz
language sql
security definer
set search_path = ''
stable
as $$
  select ts.suspended_at
    from public.teacher_suspensions ts
   where ts.teacher_id = (select auth.uid())
     and ts.lifted_at is null
   order by ts.suspended_at desc
   limit 1;
$$;

-- anon named for the same reason (0019's record_consent idiom). A signed-out
-- caller would get NULL anyway — auth.uid() is null, so no row matches — but
-- the rule here is unconditional precisely so nobody has to re-derive whether
-- a given security definer body happens to be self-scoping.
revoke all on function public.my_suspension() from public;
revoke all on function public.my_suspension() from anon;
grant execute on function public.my_suspension() to authenticated;


-- ---------------------------------------------------------------------------
-- Atomic with the report, and doing ONLY what is pure SQL. It cannot cancel
-- sessions: security definer changes the privilege, not the claim, so
-- auth.uid() here is still the REPORTING STUDENT, and every session write
-- would be evaluated as them. Cancellation and refund run in
-- src/lib/suspension/settle.ts instead.
create or replace function public.on_conduct_report_suspend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
begin
  if new.reason <> 'conduct' then
    return new;
  end if;

  -- Read from the session, never from anything the caller supplied.
  select s.teacher_id into v_teacher_id
    from public.sessions s
   where s.id = new.session_id;
  if v_teacher_id is null then
    return new;
  end if;

  -- Already under review: do not stack rows. The open suspension covers this.
  if exists (
    select 1 from public.teacher_suspensions ts
     where ts.teacher_id = v_teacher_id and ts.lifted_at is null
  ) then
    return new;
  end if;

  -- Spec §12's anti-abuse cap: one auto-suspension per reporter per teacher,
  -- ever. A second report from the same student still files and still alerts;
  -- it does not re-suspend. Kills the repeat vector without discarding
  -- evidence. Three lines here versus a separate feature later.
  if exists (
    select 1 from public.teacher_suspensions ts
      join public.session_reports r on r.id = ts.session_report_id
     where ts.teacher_id = v_teacher_id
       and r.reporter_id = new.reporter_id
  ) then
    return new;
  end if;

  -- The check above is advisory; teacher_suspensions_open_idx is the actual
  -- control, and this is what keeps it from turning a race into a failed
  -- report. Untargeted on purpose: it covers the partial unique index without
  -- restating its predicate in a second place that could drift from it.
  insert into public.teacher_suspensions (teacher_id, session_report_id)
  values (v_teacher_id, new.id)
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_conduct_report_suspend
  after insert on public.session_reports
  for each row execute function public.on_conduct_report_suspend();
