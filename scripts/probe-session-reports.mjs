#!/usr/bin/env node
// Cycle 3, spec §6. session_reports is the first table in this product whose
// rows may describe a child, so "who can read this" is the question that
// matters most about it.
//
// Hazard for whoever reads this next: session_reports has NO select policy,
// by design (see migration 0016). INSERT ... RETURNING needs SELECT
// visibility on the row it just wrote, and there is none, so ANY insert that
// asks for the row back — `Prefer: return=representation`, or supabase-js's
// `.insert().select()` — is refused with 42501, even when the insert itself
// is otherwise fully permitted. The app must never add `.select()` to the
// report insert. This probe's own `userHeaders()` helper defaults to
// return=representation (right for every other probe, wrong for this table),
// so every insert below overrides it back to return=minimal.
//
// Usage: node scripts/probe-session-reports.mjs
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
  const student = await createThrowawayUser(env, { role: "student", fullName: "Report Probe" });
  created.push(student.id);
  const teacher = await createThrowawayUser(env, { role: "teacher", fullName: "Probe Teacher", hourlyRate: 500 });
  created.push(teacher.id);
  const outsider = await createThrowawayUser(env, { role: "student", fullName: "Outsider" });
  created.push(outsider.id);

  const SH = userHeaders(env, student.token);
  const OH = userHeaders(env, outsider.token);
  const TH = userHeaders(env, teacher.token);

  // Seed a session the student was in, via the service role.
  const sess = await (await fetch(`${URL}/rest/v1/sessions`, {
    method: "POST",
    headers: { ...jsonHeaders(serviceHeaders(env)), prefer: "return=representation" },
    body: JSON.stringify({
      student_id: student.id, teacher_id: teacher.id,
      curriculum: "CBSE", grade: "10th", stream: "Science", subject: "Physics",
      hourly_rate: 500, status: "pending",
      accept_deadline: new Date(Date.now() + 120_000).toISOString(),
    }),
  })).json();
  const sessionId = sess?.[0]?.id;
  if (!sessionId) throw new Error(`could not seed a session (setup, not the test): ${JSON.stringify(sess).slice(0, 300)}`);

  // Overrides userHeaders()'s default return=representation: this table has
  // no select policy, so RETURNING would fail the insert for reasons that
  // have nothing to do with what each assertion below is actually testing.
  const minimal = (H) => ({ ...H, prefer: "return=minimal" });

  const report = async (H, reporterId, reason = "conduct") =>
    fetch(`${URL}/rest/v1/session_reports`, {
      method: "POST", headers: minimal(jsonHeaders(H)),
      body: JSON.stringify({ session_id: sessionId, reporter_id: reporterId, reason, detail: "probe" }),
    });

  // 1. The participant may report.
  const mine = await report(SH, student.id);
  ok(mine.ok, `the student in the session can file a report (HTTP ${mine.status})`);

  // 2. A stranger may not — the report names a teacher, and a session id is
  //    guessable enough that the policy must check participation.
  const theirs = await report(OH, outsider.id);
  const theirsBody = theirs.ok ? null : await theirs.json().catch(() => null);
  ok(!theirs.ok, `a student NOT in the session is refused (HTTP ${theirs.status}, code ${theirsBody?.code ?? "?"})`);

  // 3. ...nor may a real participant file one under someone else's id.
  //    Uses the STUDENT's own token on purpose: participation passes, so the
  //    only clause left that can refuse is `reporter_id = auth.uid()`. With an
  //    outsider's token both clauses fail at once and the assertion would stay
  //    green even if anti-spoof protection were deleted outright.
  const spoof = await report(SH, teacher.id);
  const spoofBody = spoof.ok ? null : await spoof.json().catch(() => null);
  ok(!spoof.ok, `a participant cannot file a report under another user's id (HTTP ${spoof.status}, code ${spoofBody?.code ?? "?"})`);

  // 4. THE ONE THAT MATTERS: no client can read reports at all.
  const readMine = await fetch(`${URL}/rest/v1/session_reports?select=*`, { headers: SH });
  const rowsMine = readMine.ok ? await readMine.json() : null;
  ok(readMine.ok && Array.isArray(rowsMine) && rowsMine.length === 0,
     `the reporter reads back ZERO reports, including their own (HTTP ${readMine.status}, ${rowsMine?.length ?? "?"} rows)`);

  // 5. Least of all the teacher the report is about.
  const readTeacher = await fetch(`${URL}/rest/v1/session_reports?select=*`, { headers: TH });
  const rowsTeacher = readTeacher.ok ? await readTeacher.json() : null;
  ok(Array.isArray(rowsTeacher) && rowsTeacher.length === 0,
     `the reported teacher reads back ZERO reports (${rowsTeacher?.length ?? "?"} rows)`);

  // 6. The operator can, or the feature is write-only theatre.
  const readService = await (await fetch(
    `${URL}/rest/v1/session_reports?select=*&session_id=eq.${sessionId}`,
    { headers: serviceHeaders(env) })).json();
  ok(Array.isArray(readService) && readService.length === 1,
     `the service role reads the report back (${readService?.length ?? "?"} rows)`);

  // 7. A reason outside the fixed list is refused by the check constraint
  //    (23514), not by the RETURNING artifact (42501) that assertions 2 and
  //    3 may also show — pinned so this keeps testing what it claims to.
  const badReason = await report(SH, student.id, "whatever");
  const badReasonBody = badReason.ok ? null : await badReason.json().catch(() => null);
  ok(!badReason.ok && badReasonBody?.code === "23514",
     `an unknown reason is refused by the check constraint, not RLS (HTTP ${badReason.status}, code ${badReasonBody?.code ?? "?"})`);

  await fetch(`${URL}/rest/v1/sessions?id=eq.${sessionId}`, { method: "DELETE", headers: serviceHeaders(env) });
} finally {
  console.log("\ncleanup");
  for (const id of created) {
    const gone = await deleteThrowawayUser(env, id);
    if (!gone) { console.log(`  \x1b[31mLEAKED\x1b[0m ${id} — remove by hand`); failures++; }
  }
  const after = await profileCount(env);
  ok(after === before, `profiles returned to ${before} row(s) (now ${after})`);
}

console.log(failures === 0
  ? "\n\x1b[32mALL CLEAR\x1b[0m — reports are insert-only, participant-scoped, and readable by no client."
  : `\n\x1b[31m${failures} FAILURE(S)\x1b[0m`);
process.exit(failures === 0 ? 0 : 1);
