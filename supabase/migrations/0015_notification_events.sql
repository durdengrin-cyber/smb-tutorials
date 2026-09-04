-- Observability for the push road (spec §5.1, §8).
--
-- The problem this solves, stated plainly: when a teacher says "it didn't
-- ring", there is currently no way to answer them. A dispatch runs inside
-- after(), which swallows its own errors by design; the outcome reaches a
-- console.error in a Vercel log nobody is watching; and while 0012 records
-- failure_count and last_ok_at on the device, nothing in the system ever
-- reads them back. So the single most likely support question in a trial has
-- no answer, and "we can handle a crowd" is a claim without evidence behind it.
--
-- This is an append-only operational log, one row per device per attempt,
-- plus a row for the cases where there was no attempt to make (no devices,
-- read failure, missing credential) — because "we never even tried" and "we
-- tried and it failed" look identical from the outside and need telling apart.
begin;

create table if not exists public.notification_events (
  id          uuid primary key default gen_random_uuid(),
  -- set null, not cascade: the log outliving the session is the point. A
  -- deleted session must not erase the record of what we did about it.
  session_id  uuid references public.sessions (id) on delete set null,
  teacher_id  uuid not null references public.profiles (id) on delete cascade,
  -- Deliberately NOT a foreign key. A 404/410 prunes the device row in the
  -- same dispatch that logs this, and an FK would either block the prune or
  -- delete the evidence of why it happened.
  device_id   uuid,
  outcome     text not null check (outcome in (
                'sent', 'failed', 'gone', 'no_devices', 'read_error', 'threw'
              )),
  status_code int,
  detail      text,
  created_at  timestamptz not null default now()
);

-- The two questions this table is asked: "what happened for this session?"
-- and "what has been happening to this teacher lately?"
create index if not exists notification_events_session_idx
  on public.notification_events (session_id);
create index if not exists notification_events_teacher_idx
  on public.notification_events (teacher_id, created_at desc);

alter table public.notification_events enable row level security;

-- No policies, deliberately: with RLS on and no policy, every ordinary client
-- is refused and only the service role (which bypasses RLS) can read or write.
-- This log names which teacher was pushed and when, which is operational data
-- about people; it should not be one RLS mistake away from being public. The
-- dispatcher holds a privileged credential already (spec §12), and the
-- diagnostic script uses the service role.

-- NOTE: this table grows one row per device per session request and nothing
-- prunes it. At trial volume that is nothing. Add a retention sweep before
-- it matters — recorded in the spec's hardening section rather than left to
-- be discovered.

commit;
