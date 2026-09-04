#!/usr/bin/env node
// Cycle 3 prerequisite, migration 0013. profiles.role is the single fact every
// auth gate in this product trusts, so "who may write it" is the highest-value
// question in the schema.
//
// The hole this proves closed was demonstrated live on 2026-09-04: 0001's
// update policy constrained WHO may write a row and never WHICH COLUMNS, so a
// signed-in student PATCHed themselves to role=teacher, hourly_rate=99999 and
// got HTTP 200 — holding nothing but the anon key that ships in the browser.
//
// Usage: node scripts/probe-role-guard.mjs
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

const readRole = async (H, id) => {
  const r = await fetch(`${URL}/rest/v1/profiles?id=eq.${id}&select=role,full_name,hourly_rate`, { headers: H });
  return (await r.json())[0];
};

const before = await profileCount(env);
const created = [];

try {
  // ---- 1. The hole itself -------------------------------------------------
  const student = await createThrowawayUser(env, { role: "student", fullName: "Role Probe" });
  created.push(student.id);
  const SH = userHeaders(env, student.token);

  const promote = await fetch(`${URL}/rest/v1/profiles?id=eq.${student.id}`, {
    method: "PATCH", headers: SH,
    body: JSON.stringify({ role: "teacher", hourly_rate: 99999 }),
  });
  const afterPromote = await readRole(SH, student.id);
  ok(!promote.ok && afterPromote?.role === "student",
     `a student cannot PATCH their own role (HTTP ${promote.status}, role still ${afterPromote?.role})`);

  // ---- 2. ...without breaking ordinary self-service ----------------------
  // A guard that also blocked name edits would be a regression, not a fix.
  const rename = await fetch(`${URL}/rest/v1/profiles?id=eq.${student.id}`, {
    method: "PATCH", headers: SH, body: JSON.stringify({ full_name: "Renamed Fine" }),
  });
  const afterRename = await readRole(SH, student.id);
  ok(rename.ok && afterRename?.full_name === "Renamed Fine",
     "a student can still edit their own non-role fields");

  // ---- 3. The legitimate path still works --------------------------------
  const up = await fetch(`${URL}/rest/v1/rpc/become_teacher`, {
    method: "POST", headers: SH,
    body: JSON.stringify({ p_full_name: "Now A Teacher", p_phone: "9876543210", p_hourly_rate: 500 }),
  });
  const afterUpgrade = await readRole(SH, student.id);
  ok(up.ok && afterUpgrade?.role === "teacher",
     `become_teacher converts a clean account (HTTP ${up.status}, role now ${afterUpgrade?.role})`);

  // ---- 4. The rule is enforced in SQL, not just in TypeScript ------------
  // canBecomeTeacher refuses an account with history. That rule lived only in
  // src/lib/routes.ts, so it only ever guarded the path the app took.
  const withHistory = await createThrowawayUser(env, { role: "student", fullName: "Has History" });
  created.push(withHistory.id);
  const WH = userHeaders(env, withHistory.token);

  const seeded = await fetch(`${URL}/rest/v1/teacher_subjects`, {
    method: "POST", headers: jsonHeaders(serviceHeaders(env)),
    body: JSON.stringify({ teacher_id: withHistory.id, curriculum: "CBSE", grade: "10th", stream: "Science", subject: "Physics" }),
  });
  if (!seeded.ok) throw new Error(`could not seed history (setup, not the test): ${await seeded.text()}`);

  const upHist = await fetch(`${URL}/rest/v1/rpc/become_teacher`, {
    method: "POST", headers: WH,
    body: JSON.stringify({ p_full_name: "Nope", p_phone: null, p_hourly_rate: 500 }),
  });
  const afterHist = await readRole(WH, withHistory.id);
  ok(!upHist.ok && afterHist?.role === "student",
     `an account with history is refused by SQL, not just by TypeScript (HTTP ${upHist.status})`);

  // ---- 5. The RPC is not reachable unauthenticated ------------------------
  // 0012 shipped exactly this mistake: revoking from PUBLIC does not remove a
  // grant that anon holds by name.
  const anonCall = await fetch(`${URL}/rest/v1/rpc/become_teacher`, {
    method: "POST",
    headers: jsonHeaders({ apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }),
    body: JSON.stringify({ p_full_name: "Anon", p_phone: null, p_hourly_rate: 500 }),
  });
  ok(!anonCall.ok, `become_teacher is refused to anon (HTTP ${anonCall.status})`);

  // ---- 6. Signup metadata cannot name a privileged role ------------------
  // This is the precondition that makes migration 0006 safe to apply. The role
  // in user_metadata is whatever the CLIENT passed to signUp().
  // Asserted on the OUTCOME, not on a path, because the acceptable outcome
  // changes shape across migrations and both shapes are fine:
  //   before 0013 — the check constraint rejects the insert outright;
  //   after  0013 — handle_new_user maps the unknown role to 'student';
  //   after  0006 — the constraint would ACCEPT 'admin', and 0013's mapping
  //                 becomes the only thing standing between a signup and an
  //                 admin account. That is precisely why this assertion is
  //                 written as "no admin profile may result".
  const sneakyEmail = `probe-admin-${crypto.randomUUID()}@smbtutorials.in`;
  const sneakyRes = await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST", headers: jsonHeaders(serviceHeaders(env)),
    body: JSON.stringify({
      email: sneakyEmail, password: crypto.randomUUID(), email_confirm: true,
      user_metadata: { full_name: "Sneaky Admin", role: "admin" },
    }),
  });
  const sneaky = await sneakyRes.json();
  if (sneaky?.id) created.push(sneaky.id);
  const sneakyRole = sneaky?.id
    ? (await readRole(serviceHeaders(env), sneaky.id))?.role
    : null;
  ok(sneakyRole !== "admin",
     sneakyRes.ok
       ? `signup metadata role="admin" landed as "${sneakyRole}", not admin`
       : `signup metadata role="admin" refused outright (HTTP ${sneakyRes.status})`);

  // A teacher signing up through the front door is still intended product
  // behaviour, and must keep working.
  const tutor = await createThrowawayUser(env, { role: "teacher", fullName: "Front Door", hourlyRate: 400 });
  created.push(tutor.id);
  ok((await readRole(serviceHeaders(env), tutor.id))?.role === "teacher",
     'signup metadata role="teacher" still works (self-serve tutor signup)');
} finally {
  console.log("\ncleanup");
  for (const id of created) {
    const gone = await deleteThrowawayUser(env, id);
    if (!gone) { console.log(`  \x1b[31mLEAKED\x1b[0m ${id} — remove by hand`); failures++; }
  }
  const after = await profileCount(env);
  ok(after === before, `profiles returned to ${before} row(s) (now ${after})`);
}

console.log(failures === 0 ? "\n\x1b[32mALL CLEAR\x1b[0m — role is immutable except through become_teacher."
                           : `\n\x1b[31m${failures} FAILURE(S)\x1b[0m`);
process.exit(failures === 0 ? 0 : 1);
