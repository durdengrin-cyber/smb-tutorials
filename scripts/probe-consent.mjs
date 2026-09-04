#!/usr/bin/env node
// Spec §6. consent_events is the second table in this product designed like
// session_reports (0016/0017): RLS enabled with NO policy for anyone, and the
// SELECT privilege revoked from anon and authenticated by name, so a client
// can never read it no matter what a future policy gets wrong. The one write
// path is record_consent(), a security definer function that stamps its own
// clock and its own caller id in SQL -- a client argument for either would be
// a forged one.
//
// Assertion 4 is the 0017 lesson restated for a new table: a passing RLS
// policy and a missing REVOKE look identical until someone queries with a
// real session. That bug shipped to production once on session_reports
// before the revoke was added as a follow-up. Here the revoke ships in the
// SAME migration as the table (0019), so this probe holds it to the
// strict standard from day one: reading your own row must be REFUSED
// outright, not merely RLS-empty. RLS-empty-but-readable is reported as the
// specific bug it would be, not accepted as a pass.
//
// Assertion 6 exercises migration 0018's redefinition of
// enforce_session_insert: a session created by a guardian account must carry
// the LEARNER's first name in sessions.student_name, not the account
// holder's full_name. This runs inside a trigger, so only a live probe
// proves it -- nothing about it is unit-testable.
//
// NOTE for whoever runs this before 0018/0019 are applied by hand in the
// Supabase SQL editor: assertions 1, 2 and 6 are EXPECTED to fail loudly,
// with PostgREST reporting that public.record_consent or
// public.consent_events do not exist yet, or (for 6) with the OLD trigger's
// behaviour still snapshotting the account holder's name. Assertions 3, 4
// and 5 will still PASS, but vacuously -- a table that does not exist yet is
// trivially "unreadable" and a function that does not exist yet trivially
// "refuses" every caller. That is the correct outcome of an unapplied
// migration, not a bug in this probe.
//
// Usage: node scripts/probe-consent.mjs
import {
  readEnv, jsonHeaders, serviceHeaders, userHeaders,
  createThrowawayUser, deleteThrowawayUser, profileCount,
} from "./probe-accounts.mjs";

const env = readEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = jsonHeaders({ apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY });
const HOURLY_RATE = 500;
const GUARDIAN_NAME = "Guardian Probe";
const LEARNER_NAME = "Kiddo Probe";

let failures = 0;
const ok = (pass, label) => {
  console.log(`  ${pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${label}`);
  if (!pass) failures++;
};

const before = await profileCount(env);
const created = [];
const seededSessionIds = [];
const seededConsentIds = [];

try {
  const guardian = await createThrowawayUser(env, { role: "student", fullName: GUARDIAN_NAME });
  created.push(guardian.id);
  const teacher = await createThrowawayUser(env, { role: "teacher", fullName: "Probe Teacher", hourlyRate: HOURLY_RATE });
  created.push(teacher.id);

  const GH = userHeaders(env, guardian.token);

  // ---- Setup for 1 & 2: call record_consent once as the guardian, then read
  // the row back with the SERVICE ROLE (assertion 4 covers reading it back
  // with the guardian's own session -- that is a distinct question). ----
  const callTime = Date.now();
  const rpc = await fetch(`${URL}/rest/v1/rpc/record_consent`, {
    method: "POST",
    headers: GH,
    body: JSON.stringify({ p_version: "2026-09-04", p_path: "reconsent", p_detail: "probe" }),
  });
  const rpcErr = rpc.ok ? null : await rpc.json().catch(() => null);

  let row = null;
  if (rpc.ok) {
    const readBack = await fetch(
      `${URL}/rest/v1/consent_events?select=*&user_id=eq.${guardian.id}&order=accepted_at.desc&limit=1`,
      { headers: serviceHeaders(env) });
    const readBackBody = await readBack.json().catch(() => null);
    row = readBack.ok && Array.isArray(readBackBody) ? readBackBody[0] : null;
    if (row?.id) seededConsentIds.push(row.id);
  }

  // 1. record_consent stamps the SERVER's clock. No accepted_at was ever
  //    passed to the RPC, so whatever landed in the row had to come from the
  //    database's own now(), not any value a client supplied.
  const skewMs = row ? Math.abs(new Date(row.accepted_at).getTime() - callTime) : null;
  ok(row != null && skewMs < 10_000,
     row
       ? `record_consent stamps the server's clock in accepted_at (${skewMs}ms from this script's own call)`
       : `record_consent stamps the server's clock -- MISSING (HTTP ${rpc.status} calling record_consent${rpcErr ? `: ${rpcErr.message ?? JSON.stringify(rpcErr)}` : ""})`);

  // 2. record_consent attributes the row to the CALLER. The function's
  //    signature takes no user id argument at all -- the only source for
  //    user_id is auth.uid() read inside the function itself.
  ok(row?.user_id === guardian.id,
     row
       ? `record_consent attributes the row to the caller (user_id ${row.user_id}), though no user id was ever passed as an argument`
       : `record_consent attributes the row to the caller -- MISSING (no row to check)`);

  // 3. consent_events is unreadable with the anon key. Brief allows either an
  //    error or zero rows here -- never data.
  const anonRead = await fetch(`${URL}/rest/v1/consent_events?select=*`, { headers: ANON });
  const anonBody = anonRead.ok ? await anonRead.json().catch(() => null) : await anonRead.json().catch(() => null);
  ok(!anonRead.ok || (Array.isArray(anonBody) && anonBody.length === 0),
     `consent_events is unreadable with the anon key (HTTP ${anonRead.status}${anonBody?.code ? `, code ${anonBody.code}` : ""})`);

  // 4. THE 0017 LESSON: an AUTHENTICATED user reading THEIR OWN row must be
  //    REFUSED outright, not merely RLS-empty. Uses the guardian's own token
  //    against a filter naming their own user_id -- the strongest form of
  //    this check, since a bug that fails only for STRANGERS would still
  //    pass a weaker version of it.
  const ownRead = await fetch(`${URL}/rest/v1/consent_events?select=*&user_id=eq.${guardian.id}`, { headers: GH });
  const ownBody = await ownRead.json().catch(() => null);
  const rlsEmptyOnly = ownRead.ok && Array.isArray(ownBody) && ownBody.length === 0;
  ok(!ownRead.ok,
     !ownRead.ok
       ? `an authenticated user reading their own consent row is REFUSED, not merely RLS-empty (HTTP ${ownRead.status}${ownBody?.code ? `, code ${ownBody.code}` : ""})`
       : rlsEmptyOnly
         ? `an authenticated user reading their own consent row is RLS-empty but NOT refused -- the REVOKE is missing (exactly the 0017 bug) (HTTP ${ownRead.status})`
         : `an authenticated user CAN read their own consent row -- REVOKE MISSING (HTTP ${ownRead.status}, ${JSON.stringify(ownBody).slice(0, 200)})`);

  // 5. record_consent refuses an unauthenticated caller (anon key, no
  //    session). It is revoked from anon at the grant level (0019), so this
  //    should be refused before the function body's own `auth.uid() is null`
  //    check ever runs.
  const anonRpc = await fetch(`${URL}/rest/v1/rpc/record_consent`, {
    method: "POST",
    headers: ANON,
    body: JSON.stringify({ p_version: "2026-09-04", p_path: "reconsent" }),
  });
  ok(!anonRpc.ok, `record_consent refuses an unauthenticated caller (HTTP ${anonRpc.status})`);

  // 6. A session created by the guardian snapshots the LEARNER's first name
  //    into sessions.student_name, not the account holder's -- migration
  //    0018's redefinition of enforce_session_insert. Set learner_first_name
  //    on the throwaway guardian first; if the column does not exist yet
  //    (0018 not applied) this PATCH is refused but does not abort the
  //    probe -- the session insert below still runs against whichever
  //    trigger is actually live, and the assertion reports what it sees.
  const learnerPatch = await fetch(`${URL}/rest/v1/profiles?id=eq.${guardian.id}`, {
    method: "PATCH",
    headers: jsonHeaders(serviceHeaders(env)),
    body: JSON.stringify({ learner_first_name: LEARNER_NAME }),
  });
  if (!learnerPatch.ok) {
    console.log(`  (setup) could not set learner_first_name -- HTTP ${learnerPatch.status}: ${(await learnerPatch.text()).slice(0, 200)}`);
  }

  const sessionRes = await fetch(`${URL}/rest/v1/sessions`, {
    method: "POST",
    headers: GH,
    body: JSON.stringify({
      student_id: guardian.id,
      teacher_id: teacher.id,
      curriculum: "CBSE", grade: "10th", stream: "Science", subject: "Mathematics",
      type: "instant", status: "pending",
      accept_deadline: new Date(Date.now() + 30_000).toISOString(),
      hourly_rate: HOURLY_RATE,
    }),
  });
  const sessionBody = await sessionRes.json().catch(() => null);
  const session = sessionRes.ok && Array.isArray(sessionBody) ? sessionBody[0] : null;
  if (session?.id) seededSessionIds.push(session.id);
  ok(session?.student_name === LEARNER_NAME,
     session
       ? `sessions.student_name snapshots the LEARNER's name -- expected "${LEARNER_NAME}", got "${session.student_name}"${session.student_name === GUARDIAN_NAME ? " (the account holder's name -- learner_first_name was not honoured)" : ""}`
       : `could not create the session to check the snapshot (HTTP ${sessionRes.status}, ${JSON.stringify(sessionBody).slice(0, 200)})`);
} finally {
  console.log("\ncleanup");
  for (const id of seededSessionIds) {
    await fetch(`${URL}/rest/v1/sessions?id=eq.${id}`, { method: "DELETE", headers: serviceHeaders(env) });
  }
  for (const id of seededConsentIds) {
    await fetch(`${URL}/rest/v1/consent_events?id=eq.${id}`, { method: "DELETE", headers: serviceHeaders(env) });
  }
  for (const id of created) {
    const gone = await deleteThrowawayUser(env, id);
    if (!gone) { console.log(`  \x1b[31mLEAKED\x1b[0m ${id} -- remove by hand`); failures++; }
  }
  const after = await profileCount(env);
  ok(after === before, `profiles returned to ${before} row(s) (now ${after})`);
}

console.log(failures === 0
  ? "\n\x1b[32mALL CLEAR\x1b[0m -- consent is server-clocked, caller-attributed, readable by no client, and sessions snapshot the learner's own name."
  : `\n\x1b[31m${failures} FAILURE(S)\x1b[0m`);
process.exit(failures === 0 ? 0 : 1);
