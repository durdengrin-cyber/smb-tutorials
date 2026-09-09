-- Subjects stop being self-service.
--
-- A teacher was cleared to teach the subjects the admin saw them demonstrate.
-- Until now they could add "Mathematics · 12th" to that list themselves, with
-- one PATCH, and be picked for it by a student the same minute -- no video, no
-- review, still 'cleared'. Changing a subject is changing what you claim to be
-- qualified to teach a child, so it goes through the admin.
--
-- Not by re-vetting, as 0024 does for the profile. Re-vetting says "look at
-- this person again" and leaves the admin to work out what to look at. A
-- subject change needs a specific artefact -- a video of them teaching the NEW
-- subject -- so it is a REQUEST that carries one, and nothing changes until it
-- is approved.
--
-- THE SIGNUP TRAP, and why set_initial_subjects exists. signUpTutor inserts a
-- teacher's first subjects with that teacher's own session, immediately after
-- sign-up. Simply dropping the INSERT policy would have made every new tutor
-- application fail at the last step. So the direct policies go, and the two
-- legitimate writers become explicit: set_initial_subjects (once, at signup,
-- refused if they already have any) and approve_subject_change (admin only).

create table if not exists public.subject_change_requests (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references public.profiles (id) on delete cascade,
  requested_at   timestamptz not null default now(),
  -- Required. The whole point of a request over a re-vet is that the admin is
  -- given something new to watch.
  demo_video_url text not null,
  -- [{ "curriculum": ..., "grade": ..., "stream": ..., "subject": ... }, ...]
  subjects       jsonb not null,
  status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected')),
  decided_at     timestamptz,
  decided_by     uuid references public.profiles (id) on delete set null,
  decision_note  text
);

-- One open request per teacher. A second would give the admin two videos and
-- two subject lists for one person with no way to tell which supersedes which.
create unique index if not exists subject_change_requests_one_open_idx
  on public.subject_change_requests (teacher_id)
  where status = 'pending';

create index if not exists subject_change_requests_pending_idx
  on public.subject_change_requests (requested_at desc)
  where status = 'pending';

alter table public.subject_change_requests enable row level security;
revoke all on public.subject_change_requests from public, anon, authenticated;
grant select on public.subject_change_requests to authenticated;

-- A teacher may read their OWN requests and nothing else: they need to see
-- that one is pending and what the admin decided. Writes go through the
-- functions below, never directly, so there is no insert or update policy.
drop policy if exists "teacher reads own subject requests" on public.subject_change_requests;
create policy "teacher reads own subject requests"
  on public.subject_change_requests for select
  using (teacher_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Direct subject writes end here.
--
-- Dropped rather than narrowed: a policy that still admits SOME direct writes
-- is a second answer to "who may change subjects", and the whole point is that
-- there is one. Reading stays open -- /teachers and available_teachers both
-- depend on it.
drop policy if exists "teacher manages own subjects" on public.teacher_subjects;
drop policy if exists "teacher deletes own subjects" on public.teacher_subjects;

-- ---------------------------------------------------------------------------
-- The first write, at signup.
create or replace function public.set_initial_subjects(p_subjects jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_actor and role = 'teacher'
  ) then
    raise exception 'only a teacher has subjects';
  end if;

  -- Once, and only once. After this the request flow is the only way in, and
  -- this function cannot be used to smuggle a change past it.
  if exists (select 1 from public.teacher_subjects where teacher_id = v_actor) then
    raise exception 'subjects are already set; request a change instead';
  end if;

  if jsonb_typeof(p_subjects) <> 'array' or jsonb_array_length(p_subjects) = 0 then
    raise exception 'at least one subject is required';
  end if;

  insert into public.teacher_subjects (teacher_id, curriculum, grade, stream, subject)
  select v_actor, x.curriculum, x.grade, x.stream, x.subject
    from jsonb_to_recordset(p_subjects)
      as x(curriculum text, grade text, stream text, subject text);
end;
$$;

revoke all on function public.set_initial_subjects(jsonb)
  from public, anon, authenticated;
grant execute on function public.set_initial_subjects(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Asking.
create or replace function public.request_subject_change(
  p_subjects       jsonb,
  p_demo_video_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_actor and role = 'teacher'
  ) then
    raise exception 'only a teacher may request a subject change';
  end if;

  if coalesce(btrim(p_demo_video_url), '') = '' then
    raise exception 'a demo video is required for the new subjects';
  end if;

  if jsonb_typeof(p_subjects) <> 'array' or jsonb_array_length(p_subjects) = 0 then
    raise exception 'at least one subject is required';
  end if;

  if exists (
    select 1 from public.subject_change_requests
    where teacher_id = v_actor and status = 'pending'
  ) then
    raise exception 'you already have a request waiting for review';
  end if;

  insert into public.subject_change_requests (teacher_id, subjects, demo_video_url)
  values (v_actor, p_subjects, btrim(p_demo_video_url))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.request_subject_change(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.request_subject_change(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Deciding.
create or replace function public.decide_subject_change(
  p_request_id uuid,
  p_approve    boolean,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_req   public.subject_change_requests%rowtype;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_actor and role = 'admin'
  ) then
    raise exception 'not an admin';
  end if;

  select * into v_req
    from public.subject_change_requests
   where id = p_request_id and status = 'pending'
   for update;

  if not found then
    raise exception 'no pending request %', p_request_id;
  end if;

  if p_approve then
    -- The vetting flag covers BOTH writes below: the profile update would
    -- otherwise trip 0024's re-vet (a changed demo_video_url), sending the
    -- teacher back to the queue in the same breath as being approved, and the
    -- explicit clear would be refused outright.
    perform set_config('app.allow_vetting_change', 'on', true);

    update public.profiles
       set demo_video_url = v_req.demo_video_url,
           vetting_state  = 'cleared'
     where id = v_req.teacher_id;

    delete from public.teacher_subjects where teacher_id = v_req.teacher_id;

    insert into public.teacher_subjects (teacher_id, curriculum, grade, stream, subject)
    select v_req.teacher_id, x.curriculum, x.grade, x.stream, x.subject
      from jsonb_to_recordset(v_req.subjects)
        as x(curriculum text, grade text, stream text, subject text);

    -- Approving a subject change IS a vetting decision -- the admin watched a
    -- video and said yes -- so it updates the same record set_vetting_state
    -- writes, rather than leaving teacher_vetting claiming the older approval.
    insert into public.teacher_vetting (teacher_id, vetted_at, vetted_by, note)
    values (v_req.teacher_id, now(), v_actor,
            coalesce(p_note, 'subject change approved'))
    on conflict (teacher_id) do update
      set vetted_at = now(),
          vetted_by = v_actor,
          note      = coalesce(excluded.note, public.teacher_vetting.note);

    -- Off again, and deliberately: this function may be called inside a larger
    -- transaction, and a flag left on would let any later statement in it
    -- write vetting_state freely.
    perform set_config('app.allow_vetting_change', 'off', true);
  end if;

  update public.subject_change_requests
     set status        = case when p_approve then 'approved' else 'rejected' end,
         decided_at    = now(),
         decided_by    = v_actor,
         decision_note = p_note
   where id = p_request_id;
end;
$$;

revoke all on function public.decide_subject_change(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.decide_subject_change(uuid, boolean, text) to authenticated;

comment on table public.subject_change_requests is
  'A teacher asking to change what they teach, with a new demo video for the '
  'admin to watch. Subjects cannot be changed directly (0027): the only '
  'writers are set_initial_subjects, once at signup, and decide_subject_change.';
