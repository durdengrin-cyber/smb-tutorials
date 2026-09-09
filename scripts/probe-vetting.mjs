#!/usr/bin/env node
// Migration 0021, spec 2026-09-04-child-safety-and-consent-design.md §10.
//
// Adults meeting children one to one on video is the highest-risk configuration
// in this product. Until 0021 any account that signed up as a teacher could be
// picked by a student with no human ever having looked at them.
//
// THE HOLE THIS PROVES CLOSED, found in review on 2026-09-09 before the
// migration was applied. The first draft of 0021 added vetting_state to
// profiles and stopped there. But 0001's update policy constrains WHO may write
// a row and says nothing about WHICH COLUMNS, and Supabase grants authenticated
// UPDATE on the table — 0013 had closed that for `role` alone. So a teacher
// holding nothing but the anon key that ships in the browser could have run
//
//     PATCH /rest/v1/profiles?id=eq.<self>  {"vetting_state":"cleared"}
//
// and put themselves in front of a child. Assertion 3 is that PATCH.
//
// NOT COVERED HERE: the positive path, that an admin clearing a teacher puts
// them back on the roster. Minting a throwaway admin needs a transaction-local
// flag that cannot be set over PostgREST, so this probe cannot make one. That
// path was verified by hand against production on 2026-09-09 (two teachers
// cleared through /admin, vetted_at and vetted_by stamped) and is exercised
// every time the operator clears someone. Assertion 2 — the exclusion — is the
// safety property, and it is covered.
//
// Usage: node scripts/probe-vetting.mjs
import {
  readEnv, jsonHeaders, serviceHeaders, userHeaders,
  createThrowawayUser, deleteThrowawayUser, profileCount,
} from "./probe-accounts.mjs";

const env = readEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;

let failures = 0;
const ok = (pass, label) => {
  console.log(`  ${pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${label}`);
  if (!pass) failures++;
};

const before = await profileCount(env);
const created = [];

try {
  const teacher = await createThrowawayUser(env, {
    role: "teacher", fullName: "Vetting Probe", hourlyRate: 500,
  });
  created.push(teacher.id);
  const TH = userHeaders(env, teacher.token);
  const SVC = serviceHeaders(env);

  // ---- 1. A new teacher starts unvetted ----------------------------------
  // Fail closed by default: the column exists so that nobody is reachable
  // until a person has said so, which only works if the default is unvetted.
  const row = await fetch(
    `${URL}/rest/v1/profiles?id=eq.${teacher.id}&select=vetting_state`,
    { headers: SVC }
  ).then((r) => r.json());
  ok(row[0]?.vetting_state === "unvetted",
     `a new teacher starts unvetted (got ${row[0]?.vetting_state})`);

  // Give them everything else a pickable teacher needs, so that when the
  // roster refuses them below, vetting is provably the only reason.
  await fetch(`${URL}/rest/v1/teacher_availability`, {
    method: "POST", headers: jsonHeaders(SVC),
    body: JSON.stringify({
      teacher_id: teacher.id, declared: true,
      declared_until: new Date(Date.now() + 4 * 3600_000).toISOString(),
    }),
  });
  await fetch(`${URL}/rest/v1/teacher_subjects`, {
    method: "POST", headers: jsonHeaders(SVC),
    body: JSON.stringify({
      teacher_id: teacher.id, curriculum: "CBSE",
      grade: "10th", stream: "Science", subject: "Mathematics",
    }),
  });

  const roster = async () =>
    fetch(`${URL}/rest/v1/rpc/available_teachers`, {
      method: "POST", headers: jsonHeaders(TH),
      body: JSON.stringify({
        p_curriculum: "CBSE", p_grade: "10th",
        p_stream: "Science", p_subject: "Mathematics",
      }),
    }).then((r) => r.json());

  // ---- 2. THE SAFETY PROPERTY -------------------------------------------
  // Declared, in-subject, lease live, no open session — and still refused,
  // because nobody has checked them. If this assertion ever fails, an
  // unvetted adult is reachable by a child and nothing else here matters.
  const unvettedList = await roster();
  ok(Array.isArray(unvettedList) && !unvettedList.some((t) => t.teacher_id === teacher.id),
     "an unvetted teacher is NOT returned by available_teachers, despite a live lease and a matching subject");

  // ---- 3. The gate is not openable by the person it gates ---------------
  const selfClear = await fetch(`${URL}/rest/v1/profiles?id=eq.${teacher.id}`, {
    method: "PATCH", headers: jsonHeaders(TH),
    body: JSON.stringify({ vetting_state: "cleared" }),
  });
  const afterSelfClear = await fetch(
    `${URL}/rest/v1/profiles?id=eq.${teacher.id}&select=vetting_state`,
    { headers: SVC }
  ).then((r) => r.json());
  ok(!selfClear.ok && afterSelfClear[0]?.vetting_state === "unvetted",
     `a teacher cannot PATCH their own vetting_state (HTTP ${selfClear.status}, still ${afterSelfClear[0]?.vetting_state})`);

  // The audit record is forgeable if left unguarded — a teacher who cannot set
  // the state but can write teacher_vetting fabricates the evidence that
  // someone checked them. 0022 moved it to its own table with RLS and no
  // policy, so there is no shape of client request that reaches it.
  const forgeAudit = await fetch(`${URL}/rest/v1/teacher_vetting`, {
    method: "POST", headers: jsonHeaders(TH),
    body: JSON.stringify({ teacher_id: teacher.id, note: "looks fine to me" }),
  });
  ok(!forgeAudit.ok, `a teacher cannot forge a vetting record (HTTP ${forgeAudit.status})`);

  // ---- 4. Even the service role goes through the function ----------------
  // The trigger is not a policy: it does not care who is calling. This is what
  // makes the rule hold for a future write path nobody has written yet.
  const svcWrite = await fetch(`${URL}/rest/v1/profiles?id=eq.${teacher.id}`, {
    method: "PATCH", headers: jsonHeaders(SVC),
    body: JSON.stringify({ vetting_state: "cleared" }),
  });
  ok(!svcWrite.ok,
     `even the service role cannot write vetting_state directly (HTTP ${svcWrite.status})`);

  // ---- 5. Only an admin may call the one legitimate path -----------------
  const notAdmin = await fetch(`${URL}/rest/v1/rpc/set_vetting_state`, {
    method: "POST", headers: jsonHeaders(TH),
    body: JSON.stringify({ p_teacher_id: teacher.id, p_state: "cleared", p_note: null }),
  });
  ok(!notAdmin.ok, `a non-admin calling set_vetting_state is refused (HTTP ${notAdmin.status})`);

  // ---- 6. Vetting judgements are not public ------------------------------
  // The profiles select policy makes every teacher row world-readable, which is
  // how students browse. That must not also publish who was refused, or the
  // operator's private note about them.
  // 0021 tried to do this with a column-level revoke on profiles, which is a
  // no-op against a table-level grant — this probe caught that. 0022 moved the
  // judgement into its own table instead.
  const readOthers = await fetch(`${URL}/rest/v1/teacher_vetting?select=*`, { headers: TH });
  const leaked = readOthers.ok ? await readOthers.json() : null;
  ok(!readOthers.ok || (Array.isArray(leaked) && leaked.length === 0),
     `the vetting record is not readable by an ordinary signed-in account (HTTP ${readOthers.status}, rows ${Array.isArray(leaked) ? leaked.length : "n/a"})`);

  // ---- 7. ...but a teacher can still see their own state -----------------
  // Without this the dashboard banner cannot tell them why no requests arrive,
  // and they conclude the product is broken.
  const own = await fetch(`${URL}/rest/v1/rpc/my_vetting_state`, {
    method: "POST", headers: jsonHeaders(TH), body: "{}",
  });
  const ownState = own.ok ? await own.json() : null;
  ok(own.ok && ownState === "unvetted",
     `a teacher can read their OWN state via my_vetting_state (got ${JSON.stringify(ownState)})`);

} finally {
  for (const id of created) await deleteThrowawayUser(env, id);
  const after = await profileCount(env);
  ok(after === before, `cleaned up every account it created (${before} → ${after})`);
}

console.log(failures === 0
  ? "\n\x1b[32mvetting gate holds\x1b[0m"
  : `\n\x1b[31m${failures} assertion(s) failed\x1b[0m`);
process.exit(failures === 0 ? 0 : 1);
