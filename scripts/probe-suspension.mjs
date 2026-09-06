#!/usr/bin/env node
// Migration 0020. /terms has promised since cycle 3 that a conduct report
// suspends a teacher pending review; until 0020 nothing in the schema did it.
// This probe attacks and exercises the REAL database — the trigger, the two
// RPCs, both session guards (insert and update), the unique open-suspension
// index and the availability filter — because a mock cannot prove a database
// rule.
//
// Two hazards, both inherited and both worth reading before editing:
//
//   1. teacher_suspensions has NO select policy (RLS on, no policy), exactly
//      as session_reports does. INSERT ... RETURNING needs SELECT visibility
//      on the row it just wrote, so any insert asking for the row back —
//      `Prefer: return=representation`, which is userHeaders()'s default, or
//      supabase-js's `.insert().select()` — is refused with 42501 even when
//      the insert itself is permitted. Every report insert below therefore
//      overrides the header back to `return=minimal`.
//
//   2. available_teachers already hides a teacher with an in-flight session,
//      so a seeded `pending` row with a FUTURE accept_deadline would hide the
//      teacher for reasons that have nothing to do with suspension, and
//      assertion 6 would pass against a migration that never shipped the
//      suspension clause. Every session here is seeded with a PAST
//      accept_deadline, which is legal on insert (0011 bounds only the upper
//      end) and leaves the teacher listed. That is what makes assertion 6
//      mean something and assertion 7 possible at all.
//
// Usage: node scripts/probe-suspension.mjs
import {
  readEnv, jsonHeaders, serviceHeaders, userHeaders,
  createThrowawayUser, deleteThrowawayUser, profileCount,
} from "./probe-accounts.mjs";

const env = readEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = serviceHeaders(env);
const ANON = jsonHeaders({ apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY });

let failures = 0;
const ok = (pass, label) => {
  console.log(`  ${pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${label}`);
  if (!pass) failures++;
};

const rows = async (path, headers = SERVICE) => {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers });
  const body = await res.json().catch(() => null);
  return Array.isArray(body) ? body : [];
};

const before = await profileCount(env);
const beforeReports = (await rows("session_reports?select=id")).length;
const beforeSuspensions = (await rows("teacher_suspensions?select=id")).length;

const created = [];
const sessionIds = [];

try {
  const studentA = await createThrowawayUser(env, { role: "student", fullName: "Suspension Probe A" });
  created.push(studentA.id);
  const studentB = await createThrowawayUser(env, { role: "student", fullName: "Suspension Probe B" });
  created.push(studentB.id);
  const teacher = await createThrowawayUser(env, { role: "teacher", fullName: "Probe Teacher T", hourlyRate: 500 });
  created.push(teacher.id);
  const teacher2 = await createThrowawayUser(env, { role: "teacher", fullName: "Probe Teacher T2", hourlyRate: 500 });
  created.push(teacher2.id);
  // Stands in for the human reviewing the report. There is no admin role yet
  // (0006 is deliberately unapplied), and reinstate_teacher.lifted_by is an FK
  // to profiles and nothing more, so any profile is a faithful stand-in.
  const operator = await createThrowawayUser(env, { role: "student", fullName: "Probe Operator" });
  created.push(operator.id);

  const AH = userHeaders(env, studentA.token);
  const BH = userHeaders(env, studentB.token);
  const TH = userHeaders(env, teacher.token);

  // ---- setup: make T discoverable by available_teachers ------------------
  // A teacher declares for themselves — 0007's RLS and 0009's guard trigger
  // both refuse anyone else, service role included.
  const declared = await fetch(`${URL}/rest/v1/teacher_availability`, {
    method: "POST", headers: jsonHeaders(TH),
    body: JSON.stringify({
      teacher_id: teacher.id,
      declared: true,
      declared_at: new Date().toISOString(),
      declared_until: new Date(Date.now() + 4 * 3600_000).toISOString(),
    }),
  });
  if (!declared.ok) throw new Error(`could not declare availability (setup, not the test): ${await declared.text()}`);

  const subject = await fetch(`${URL}/rest/v1/teacher_subjects`, {
    method: "POST", headers: jsonHeaders(SERVICE),
    body: JSON.stringify({
      teacher_id: teacher.id, curriculum: "CBSE", grade: "10th",
      stream: "Science", subject: "Mathematics",
    }),
  });
  if (!subject.ok) throw new Error(`could not seed a taught subject (setup, not the test): ${await subject.text()}`);

  // A session can only be INSERTED as pending (0003), and the deadline is in
  // the past on purpose — see hazard 2 at the top of this file.
  const seedSession = async (studentId, teacherId) => {
    const res = await fetch(`${URL}/rest/v1/sessions`, {
      method: "POST",
      headers: { ...jsonHeaders(SERVICE), prefer: "return=representation" },
      body: JSON.stringify({
        student_id: studentId, teacher_id: teacherId,
        curriculum: "CBSE", grade: "10th", stream: "Science", subject: "Mathematics",
        type: "instant", hourly_rate: 500, duration_minutes: 60, status: "pending",
        accept_deadline: new Date(Date.now() - 60_000).toISOString(),
      }),
    });
    const body = await res.json().catch(() => null);
    const row = body?.[0];
    if (!row?.id) throw new Error(`could not seed a session (setup, not the test): ${JSON.stringify(body).slice(0, 300)}`);
    sessionIds.push(row.id);
    return row;
  };

  const sAT = await seedSession(studentA.id, teacher.id);      // A ↔ T, the reported one
  const sAT2 = await seedSession(studentA.id, teacher2.id);    // A ↔ T2, the control
  const sBT = await seedSession(studentB.id, teacher.id);      // B ↔ T, the second reporter
  const sCancel = await seedSession(studentA.id, teacher.id);  // A ↔ T, for the guard checks

  // Overrides userHeaders()'s return=representation: teacher_suspensions and
  // session_reports both refuse RETURNING (hazard 1).
  const minimal = (H) => ({ ...H, prefer: "return=minimal" });
  const report = (H, sessionId, reporterId, reason) =>
    fetch(`${URL}/rest/v1/session_reports`, {
      method: "POST", headers: minimal(jsonHeaders(H)),
      body: JSON.stringify({ session_id: sessionId, reporter_id: reporterId, reason, detail: "probe" }),
    });

  const suspensions = (teacherId) =>
    rows(`teacher_suspensions?select=id,lifted_at,lifted_by,outcome,note&teacher_id=eq.${teacherId}`);
  const openSuspensions = async (teacherId) =>
    (await suspensions(teacherId)).filter((r) => r.lifted_at === null);

  const roster = async (H = AH) => {
    const res = await fetch(`${URL}/rest/v1/rpc/available_teachers`, {
      method: "POST", headers: jsonHeaders(H),
      body: JSON.stringify({
        p_curriculum: "CBSE", p_grade: "10th", p_stream: "Science", p_subject: "Mathematics",
      }),
    });
    const body = await res.json().catch(() => null);
    return Array.isArray(body) ? body : [];
  };

  console.log("\nthe trigger — a conduct report opens a suspension");

  // 1. The whole promise, in one assertion.
  const r1 = await report(AH, sAT.id, studentA.id, "conduct");
  const afterR1 = await suspensions(teacher.id);
  ok(r1.ok && afterR1.length === 1 && afterR1[0].lifted_at === null,
     `a conduct report opens exactly one open suspension (HTTP ${r1.status}, ${afterR1.length} row(s))`);

  // 2. Only 'conduct'. The other reasons are quality and logistics complaints;
  //    auto-suspending on "technical" would take a teacher offline because
  //    someone's wifi dropped.
  const r2 = await report(AH, sAT2.id, studentA.id, "technical");
  const afterR2 = await suspensions(teacher2.id);
  ok(r2.ok && afterR2.length === 0,
     `a 'technical' report suspends nobody (HTTP ${r2.status}, ${afterR2.length} row(s) for T2)`);

  // 3. A second report while the review is open does not stack rows — the
  //    open suspension already covers it.
  const r3 = await report(AH, sAT.id, studentA.id, "conduct");
  const afterR3 = await suspensions(teacher.id);
  ok(r3.ok && afterR3.length === 1,
     `a second conduct report while open does not stack (HTTP ${r3.status}, ${afterR3.length} row(s))`);

  console.log("\navailable_teachers — the suspension actually hides them");

  // 6 (run here, while the suspension is open). Seeded with a PAST deadline,
  // so nothing but the suspension clause can be hiding T.
  const rosterSuspended = await roster();
  ok(!rosterSuspended.some((r) => r.teacher_id === teacher.id),
     `a suspended teacher is absent from available_teachers (${rosterSuspended.length} row(s) returned)`);

  console.log("\nwhat the teacher can and cannot see");

  // 8. RLS on, no policy: the row names session_report_id, and a teacher who
  //    reads it learns which session was reported and therefore who reported
  //    them. Accept either shape — refused outright, or visible-but-empty —
  //    and say which was observed, the way probe-session-reports.mjs does.
  const ownRead = await fetch(`${URL}/rest/v1/teacher_suspensions?select=*`, { headers: TH });
  const ownBody = await ownRead.json().catch(() => null);
  const privilegeRevoked = !ownRead.ok;
  const rlsEmpty = ownRead.ok && Array.isArray(ownBody) && ownBody.length === 0;
  ok(privilegeRevoked || rlsEmpty,
     `the suspended teacher cannot read teacher_suspensions (HTTP ${ownRead.status}${privilegeRevoked ? ", privilege REVOKED" : ", RLS-empty"})`);

  // 9a. What they CAN see: a timestamp, and nothing that identifies the
  //     reporter. The return type is timestamptz, so there is no column to
  //     leak even by accident.
  const mineOpen = await fetch(`${URL}/rest/v1/rpc/my_suspension`, {
    method: "POST", headers: jsonHeaders(TH), body: "{}",
  });
  const mineOpenBody = await mineOpen.json().catch(() => null);
  ok(mineOpen.ok && typeof mineOpenBody === "string" && !Number.isNaN(Date.parse(mineOpenBody)),
     `my_suspension() returns the teacher's own suspended_at while open (${JSON.stringify(mineOpenBody)})`);

  // The student's own call must not see the teacher's suspension: the RPC is
  // scoped to auth.uid(), so a non-suspended caller gets null.
  const mineStudent = await fetch(`${URL}/rest/v1/rpc/my_suspension`, {
    method: "POST", headers: jsonHeaders(AH), body: "{}",
  });
  const mineStudentBody = await mineStudent.json().catch(() => null);
  ok(mineStudent.ok && mineStudentBody === null,
     `my_suspension() is self-scoped — a student gets null (${JSON.stringify(mineStudentBody)})`);

  console.log("\nreinstate_teacher — manual, recorded, and service-role only");

  // 10. A typo'd id must fail loudly rather than silently doing nothing.
  const noOpen = await fetch(`${URL}/rest/v1/rpc/reinstate_teacher`, {
    method: "POST", headers: jsonHeaders(SERVICE),
    body: JSON.stringify({ p_teacher_id: teacher2.id, p_outcome: "reinstated", p_note: "probe" }),
  });
  const noOpenBody = noOpen.ok ? null : await noOpen.json().catch(() => null);
  ok(!noOpen.ok && /no open suspension/i.test(noOpenBody?.message ?? ""),
     `reinstating a teacher with no open suspension errors (HTTP ${noOpen.status}, "${noOpenBody?.message ?? "?"}")`);

  // The 0012 lesson, tested rather than assumed: this is a SECURITY DEFINER
  // function, so the EXECUTE grant IS the control. Supabase's default
  // privileges grant it to anon and authenticated BY NAME, and
  // `revoke ... from public` does not remove either.
  const anonLift = await fetch(`${URL}/rest/v1/rpc/reinstate_teacher`, {
    method: "POST", headers: ANON,
    body: JSON.stringify({ p_teacher_id: teacher.id, p_outcome: "reinstated", p_note: "anon" }),
  });
  const stillOpenAfterAnon = await openSuspensions(teacher.id);
  ok(!anonLift.ok && stillOpenAfterAnon.length === 1,
     `reinstate_teacher is refused to anon (HTTP ${anonLift.status}, ${stillOpenAfterAnon.length} still open)`);

  const authedLift = await fetch(`${URL}/rest/v1/rpc/reinstate_teacher`, {
    method: "POST", headers: jsonHeaders(TH),
    body: JSON.stringify({ p_teacher_id: teacher.id, p_outcome: "reinstated", p_note: "self-service" }),
  });
  const stillOpenAfterSelf = await openSuspensions(teacher.id);
  ok(!authedLift.ok && stillOpenAfterSelf.length === 1,
     `a suspended teacher cannot lift their own suspension (HTTP ${authedLift.status}, ${stillOpenAfterSelf.length} still open)`);

  // 'removed' RECORDS the decision and deliberately does NOT lift: the
  // suspension stays open, available_teachers keeps excluding them, and
  // performing the removal is not this function's job. Called with the service
  // role and WITHOUT p_lifted_by — the pilot-era CLI path — so coalesce falls
  // through to auth.uid(), which is null there. That null is the entire reason
  // the parameter exists, and this is the assertion that shows it.
  const removed = await fetch(`${URL}/rest/v1/rpc/reinstate_teacher`, {
    method: "POST", headers: jsonHeaders(SERVICE),
    body: JSON.stringify({ p_teacher_id: teacher.id, p_outcome: "removed", p_note: "probe removal" }),
  });
  const afterRemoved = (await suspensions(teacher.id))[0];
  ok(removed.ok && afterRemoved?.outcome === "removed" && afterRemoved?.note === "probe removal"
     && afterRemoved?.lifted_at === null && afterRemoved?.lifted_by === null,
     `'removed' records the decision and leaves the suspension OPEN (HTTP ${removed.status}, lifted_at ${JSON.stringify(afterRemoved?.lifted_at)}, lifted_by ${JSON.stringify(afterRemoved?.lifted_by)})`);

  const rosterRemoved = await roster();
  ok(!rosterRemoved.some((r) => r.teacher_id === teacher.id),
     `…and the teacher is STILL hidden from available_teachers after 'removed'`);

  // The real lift, by the operator, naming themselves. p_lifted_by is what
  // makes the record answer "who" — proved by the null directly above.
  const lift = await fetch(`${URL}/rest/v1/rpc/reinstate_teacher`, {
    method: "POST", headers: jsonHeaders(SERVICE),
    body: JSON.stringify({
      p_teacher_id: teacher.id, p_outcome: "reinstated", p_note: "probe",
      p_lifted_by: operator.id,
    }),
  });
  const lifted = await suspensions(teacher.id);
  ok(lift.ok && lifted.length === 1 && lifted[0].lifted_at !== null && lifted[0].outcome === "reinstated"
     && lifted[0].note === "probe" && lifted[0].lifted_by === operator.id,
     `the operator lifts it, and the row RECORDS who, what and why (HTTP ${lift.status}, lifted_by ${lifted[0]?.lifted_by === operator.id ? "the operator" : JSON.stringify(lifted[0]?.lifted_by)})`);

  // 9b. The teacher's own view clears with it.
  const mineLifted = await fetch(`${URL}/rest/v1/rpc/my_suspension`, {
    method: "POST", headers: jsonHeaders(TH), body: "{}",
  });
  const mineLiftedBody = await mineLifted.json().catch(() => null);
  ok(mineLifted.ok && mineLiftedBody === null,
     `my_suspension() returns null once lifted (${JSON.stringify(mineLiftedBody)})`);

  // 7. And discovery comes back. This is the assertion the past accept_deadline
  //    in seedSession() exists to make possible.
  const rosterLifted = await roster();
  ok(rosterLifted.some((r) => r.teacher_id === teacher.id),
     `a reinstated teacher is present in available_teachers again (${rosterLifted.length} row(s) returned)`);

  console.log("\nthe per-reporter cap — spec §12's anti-abuse rule");

  // 4. The cap holds ACROSS a lift: one auto-suspension per reporter per
  //    teacher, EVER. The report still files and still alerts; it does not
  //    re-suspend. Without this, a single student could keep a teacher
  //    permanently offline by reporting them after every reinstatement.
  const r4 = await report(AH, sAT.id, studentA.id, "conduct");
  const afterR4 = await suspensions(teacher.id);
  ok(r4.ok && afterR4.length === 1 && afterR4[0].lifted_at !== null,
     `the same reporter cannot re-suspend after a lift (HTTP ${r4.status}, ${afterR4.length} row(s), still lifted)`);

  // 5. A DIFFERENT reporter still can — the cap kills the repeat vector, not
  //    the feature.
  const r5 = await report(BH, sBT.id, studentB.id, "conduct");
  const afterR5 = await suspensions(teacher.id);
  const openAfterR5 = afterR5.filter((r) => r.lifted_at === null);
  ok(r5.ok && afterR5.length === 2 && openAfterR5.length === 1,
     `a different reporter opens a second suspension (HTTP ${r5.status}, ${afterR5.length} row(s), ${openAfterR5.length} open)`);

  // teacher_suspensions_open_idx, tested as the control it is rather than as
  // an index. The trigger's "already under review" check and its insert are
  // two statements, so two concurrent conduct reports can both read no open
  // row and both insert one — and reinstate_teacher() takes
  // `order by suspended_at desc limit 1`, so it would lift only the newest and
  // leave the teacher suspended forever. Racing that is not reproducible; a
  // direct second insert as the service role, which bypasses the trigger's
  // check entirely, tests the same guarantee deterministically.
  const someReport = (await rows(`session_reports?select=id&session_id=eq.${sAT.id}`))[0];
  const dupe = await fetch(`${URL}/rest/v1/teacher_suspensions`, {
    method: "POST", headers: minimal(jsonHeaders(SERVICE)),
    body: JSON.stringify({ teacher_id: teacher.id, session_report_id: someReport?.id }),
  });
  const dupeBody = dupe.ok ? null : await dupe.json().catch(() => null);
  const afterDupe = await openSuspensions(teacher.id);
  ok(!dupe.ok && dupeBody?.code === "23505" && afterDupe.length === 1,
     `a second OPEN suspension for the same teacher is refused by the unique index (HTTP ${dupe.status}, code ${dupeBody?.code ?? "?"}, ${afterDupe.length} open)`);

  console.log("\nenforce_session_update — the widening, and its limits");

  // A refusal means the row DID NOT CHANGE. Checking the HTTP status alone is
  // not enough in either direction here: RLS makes another student's row
  // invisible rather than forbidden, so PostgREST answers 200 with an empty
  // result, while the trigger raises a real 400. Both are refusals; only a
  // changed row is not.
  const readSession = async (id) =>
    (await rows(`sessions?select=id,status,cancellation_reason&id=eq.${id}`))[0] ?? null;

  const mutation = async (id, patch, H) => {
    const was = await readSession(id);
    const res = await fetch(`${URL}/rest/v1/sessions?id=eq.${id}`, {
      method: "PATCH", headers: jsonHeaders(H), body: JSON.stringify(patch),
    });
    const now = await readSession(id);
    const changed = Object.keys(patch).filter((k) => JSON.stringify(now?.[k]) !== JSON.stringify(was?.[k]));
    const body = res.ok ? null : await res.json().catch(() => null);
    return { res, body, changed, now };
  };

  // 11. A student token must not reach another student's session. The
  //     widening admits the service role and nothing else.
  const m11 = await mutation(sBT.id, { status: "cancelled" }, AH);
  ok(m11.changed.length === 0,
     `student A cannot cancel student B's session (HTTP ${m11.res.status}, changed: ${m11.changed.join(", ") || "nothing"})`);

  // 12. Nor may the teacher cancel — the one party with a motive to dump a
  //     session they no longer want.
  const m12 = await mutation(sCancel.id, { status: "cancelled" }, TH);
  ok(m12.changed.length === 0 && /only the student may cancel/i.test(m12.body?.message ?? ""),
     `the teacher cannot cancel their own session (HTTP ${m12.res.status}, "${m12.body?.message ?? "?"}")`);

  // 14. cancellation_reason is server-set, like the payment columns. A student
  //     must not be able to dress their own cancellation up as a suspension.
  const m14 = await mutation(sAT.id, { cancellation_reason: "teacher_suspended" }, AH);
  ok(m14.changed.length === 0 && /cancellation_reason is set by the server only/i.test(m14.body?.message ?? ""),
     `a student cannot set cancellation_reason (HTTP ${m14.res.status}, "${m14.body?.message ?? "?"}")`);

  // 13. And THIS is what the widening bought: settleSuspension cancelling a
  //     suspended teacher's not-yet-started session, from server code, with a
  //     reason the student can be shown.
  const m13 = await mutation(sCancel.id,
    { status: "cancelled", cancellation_reason: "teacher_suspended" }, SERVICE);
  ok(m13.res.ok && m13.now?.status === "cancelled" && m13.now?.cancellation_reason === "teacher_suspended",
     `the service role cancels with a reason (HTTP ${m13.res.status}, status ${m13.now?.status}, reason ${m13.now?.cancellation_reason})`);

  // The CHECK constraint is the last line: an unknown reason is refused by the
  // constraint (23514), not by RLS or the trigger.
  const badReason = await fetch(`${URL}/rest/v1/sessions?id=eq.${sAT.id}`, {
    method: "PATCH", headers: jsonHeaders(SERVICE),
    body: JSON.stringify({ cancellation_reason: "because" }),
  });
  const badBody = badReason.ok ? null : await badReason.json().catch(() => null);
  ok(!badReason.ok && badBody?.code === "23514",
     `an unknown cancellation_reason is refused by the check constraint (HTTP ${badReason.status}, code ${badBody?.code ?? "?"})`);

  // The INSERT half of the same rule. The UPDATE guard cannot see this case:
  // `is distinct from old` is false for a value that was present in the row's
  // very first version, so without enforce_session_insert's ban a student
  // could POST a session already blaming a suspension, cancel it themselves,
  // and be shown "your teacher was suspended" about a teacher who never was.
  //
  // Left on return=representation deliberately: if this ever STOPS failing,
  // the row id is captured for cleanup BEFORE the verdict prints — the lesson
  // probe-happy-path.mjs records about malformed inserts leaking live rows.
  const studentInsert = {
    student_id: studentA.id, teacher_id: teacher.id,
    curriculum: "CBSE", grade: "10th", stream: "Science", subject: "Mathematics",
    type: "instant", hourly_rate: 500, duration_minutes: 60, status: "pending",
    accept_deadline: new Date(Date.now() + 60_000).toISOString(),
  };

  const forgedInsert = await fetch(`${URL}/rest/v1/sessions`, {
    method: "POST", headers: jsonHeaders(AH),
    body: JSON.stringify({ ...studentInsert, cancellation_reason: "teacher_suspended" }),
  });
  const forgedBody = await forgedInsert.json().catch(() => null);
  if (Array.isArray(forgedBody) && forgedBody[0]?.id) sessionIds.push(forgedBody[0].id);
  ok(!forgedInsert.ok && /cannot already carry a cancellation reason/i.test(forgedBody?.message ?? ""),
     `a student cannot INSERT a session already carrying cancellation_reason (HTTP ${forgedInsert.status}, "${forgedBody?.message ?? "?"}")`);

  // The control. Without it the assertion above would stay green if the
  // student insert path broke outright for some unrelated reason, which is
  // the failure mode a ban is most likely to be confused with.
  const cleanInsert = await fetch(`${URL}/rest/v1/sessions`, {
    method: "POST", headers: jsonHeaders(AH),
    body: JSON.stringify(studentInsert),
  });
  const cleanBody = await cleanInsert.json().catch(() => null);
  if (Array.isArray(cleanBody) && cleanBody[0]?.id) sessionIds.push(cleanBody[0].id);
  ok(cleanInsert.ok && cleanBody?.[0]?.cancellation_reason === null,
     `…the same insert WITHOUT it is permitted, landing with a null reason (HTTP ${cleanInsert.status})`);
} finally {
  console.log("\ncleanup");

  // Reports must be deleted BEFORE the sessions they name: 0017 re-pointed
  // session_reports.session_id at ON DELETE SET NULL precisely so a report
  // survives its session, which would leave these rows unfindable. Deleting
  // the report cascades to the suspension that cites it.
  if (sessionIds.length) {
    const list = sessionIds.join(",");
    const reportRows = await rows(`session_reports?select=id&session_id=in.(${list})`);
    for (const r of reportRows) {
      await fetch(`${URL}/rest/v1/session_reports?id=eq.${r.id}`, { method: "DELETE", headers: SERVICE });
    }
    await fetch(`${URL}/rest/v1/sessions?id=in.(${list})`, { method: "DELETE", headers: SERVICE });
  }

  // Deleting the auth user cascades to profiles and from there to
  // teacher_suspensions, teacher_subjects and teacher_availability.
  for (const id of created) {
    const gone = await deleteThrowawayUser(env, id);
    if (!gone) { console.log(`  \x1b[31mLEAKED\x1b[0m ${id} — remove by hand`); failures++; }
  }

  const after = await profileCount(env);
  const afterReports = (await rows("session_reports?select=id")).length;
  const afterSuspensions = (await rows("teacher_suspensions?select=id")).length;
  ok(after === before, `profiles returned to ${before} row(s) (now ${after})`);
  ok(afterReports === beforeReports, `session_reports returned to ${beforeReports} row(s) (now ${afterReports})`);
  ok(afterSuspensions === beforeSuspensions, `teacher_suspensions returned to ${beforeSuspensions} row(s) (now ${afterSuspensions})`);
}

console.log(failures === 0
  ? "\n\x1b[32mALL CLEAR\x1b[0m — a conduct report suspends, the cap holds, only the operator lifts, and the teacher never learns who reported them."
  : `\n\x1b[31m${failures} FAILURE(S)\x1b[0m`);
process.exit(failures === 0 ? 0 : 1);
