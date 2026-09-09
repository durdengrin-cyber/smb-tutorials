-- Two defects in 0027, found by review before it was applied.
--
-- 1. THE RULES LIVED ONLY IN TYPESCRIPT. 0027's own header argues that "a rule
--    that lived only in application code was not a rule" -- and then shipped
--    two SECURITY DEFINER functions, both granted to `authenticated`, that
--    validated nothing. parseSubjectChangeRequest's YouTube canonicalisation
--    and taxonomy expansion are in the Server Action, so a teacher holding the
--    anon key that ships in the browser could POST straight to
--    /rest/v1/rpc/request_subject_change with any subject string and any URL.
--
--    The URL is the sharp end: /admin renders it as "Watch the new demo video"
--    for the admin to click, and decide_subject_change copies it onto
--    profiles.demo_video_url on approval. An arbitrary attacker-chosen link,
--    presented to an admin as the artefact they are meant to judge.
--
-- 2. THE VETTING NOTE WAS ALWAYS OVERWRITTEN. decide_subject_change copied the
--    ON CONFLICT ... coalesce(excluded.note, existing) guard from
--    set_vetting_state, but passed coalesce(p_note, 'subject change approved')
--    into the insert. excluded.note is therefore never null, the coalesce can
--    never fall through, and an approval with an empty note box destroyed the
--    record of what was originally checked -- "ID matched, passport,
--    2026-09-01" replaced by "subject change approved".
--
-- NOT fixed here, and named so it is not mistaken for covered: the (stream,
-- subject) pairing is still checked only in TypeScript. Validating it in SQL
-- needs the taxonomy as a table, which teacher_subjects does not have -- its
-- CHECK constraints cover curriculum, grade and stream but not which subjects
-- belong to which stream. A junk pair is visible to the admin in the request
-- and rejectable; a junk URL was not.

create or replace function public.is_youtube_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- Anchored at the scheme, so the host cannot be prefixed or suffixed:
  -- "notyoutube.com/..." fails because the alternation must begin right after
  -- the optional subdomain, and "youtube.com.evil.tld/..." fails because a "/"
  -- must follow ".com". Eleven characters of id, the only length YouTube has
  -- ever used.
  select coalesce(p_url, '') ~
    '^https?://(www\.|m\.|music\.)?(youtube\.com/(watch\?v=|shorts/|embed/|v/)|youtu\.be/)[A-Za-z0-9_-]{11}';
$$;

comment on function public.is_youtube_url(text) is
  'Whether a URL points at a YouTube video. Mirrors inspectDemoVideoUrl in '
  'src/lib/validation.ts; both exist because the TypeScript one gives a better '
  'message and this one is the boundary. See 0028.';

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

  if exists (select 1 from public.teacher_subjects where teacher_id = v_actor) then
    raise exception 'subjects are already set; request a change instead';
  end if;

  if jsonb_typeof(p_subjects) <> 'array' or jsonb_array_length(p_subjects) = 0 then
    raise exception 'at least one subject is required';
  end if;

  -- A bound, so a single call cannot be used to write an unbounded number of
  -- rows. 3 curricula x 7 grades x the subjects of one stream is comfortably
  -- inside this.
  if jsonb_array_length(p_subjects) > 300 then
    raise exception 'too many subjects in one request';
  end if;

  -- The insert itself is checked by teacher_subjects' CHECK constraints on
  -- curriculum, grade and stream, which is why they are not re-listed here:
  -- a bad value raises rather than being silently stored.
  insert into public.teacher_subjects (teacher_id, curriculum, grade, stream, subject)
  select v_actor, x.curriculum, x.grade, x.stream, x.subject
    from jsonb_to_recordset(p_subjects)
      as x(curriculum text, grade text, stream text, subject text);
end;
$$;

revoke all on function public.set_initial_subjects(jsonb)
  from public, anon, authenticated;
grant execute on function public.set_initial_subjects(jsonb) to authenticated;

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

  -- Was: "is it non-empty". An admin is asked to click this link and judge
  -- what it shows, and on approval it becomes the teacher's demo video.
  if not public.is_youtube_url(btrim(p_demo_video_url)) then
    raise exception 'the demo video must be a YouTube link';
  end if;

  if jsonb_typeof(p_subjects) <> 'array' or jsonb_array_length(p_subjects) = 0 then
    raise exception 'at least one subject is required';
  end if;

  if jsonb_array_length(p_subjects) > 300 then
    raise exception 'too many subjects in one request';
  end if;

  -- Checked HERE rather than only when the rows are inserted on approval:
  -- a request carrying an invalid curriculum would otherwise sit in the queue
  -- looking reviewable and fail at the moment the admin approved it.
  if exists (
    select 1
      from jsonb_to_recordset(p_subjects)
        as x(curriculum text, grade text, stream text, subject text)
     where x.curriculum is null or x.grade is null
        or x.stream is null or x.subject is null
        or x.curriculum not in ('CBSE', 'State Board', 'ICSE')
        or x.grade not in ('6th','7th','8th','9th','10th','11th','12th')
        or x.stream not in ('Science', 'Commerce', 'Arts')
        or btrim(x.subject) = ''
  ) then
    raise exception 'that is not a curriculum, grade or stream we offer';
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

-- Belt and braces: a row that got in before this migration, or by any future
-- path, still cannot present a non-YouTube link to an admin.
alter table public.subject_change_requests
  drop constraint if exists subject_change_requests_youtube_check;
alter table public.subject_change_requests
  add constraint subject_change_requests_youtube_check
  check (public.is_youtube_url(demo_video_url));

-- Defect 2: pass p_note through unchanged, so the coalesce in ON CONFLICT can
-- actually fall through to the existing note.
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

    -- p_note passed through, NOT coalesced to a default first. An approval
    -- with an empty note box now leaves the original note standing -- the
    -- record of what was actually checked when this teacher was first
    -- cleared, which an approval of a subject change has no business erasing.
    insert into public.teacher_vetting (teacher_id, vetted_at, vetted_by, note)
    values (v_req.teacher_id, now(), v_actor, p_note)
    on conflict (teacher_id) do update
      set vetted_at = now(),
          vetted_by = v_actor,
          note      = coalesce(excluded.note, public.teacher_vetting.note);

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
