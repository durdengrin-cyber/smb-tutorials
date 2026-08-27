#!/usr/bin/env node
// The milestone's most important test (M3 design spec §8). A mock cannot
// prove a database rule — this attacks the REAL sessions table with a REAL
// participant's JWT through PostgREST, the exact path a browser uses, and
// proves migration 0005's trigger refuses every attack it claims to refuse.
//
// The battery runs TWICE: once as the teacher, once as the student, on two
// independently seeded rows. Spec §8 asks for both. The trigger's payment
// gates key on `uid is not null` with no role branching and the RLS UPDATE
// policy is symmetric, so today this very likely proves the same path twice
// — that is the point. A future change that DOES branch on role would
// otherwise go unprobed on one side, and the side left unprobed would be
// the student: the party with the motive to mark themselves paid.
//
// Both participants are throwaway accounts created and deleted inside this
// run (see probe-accounts.mjs), so the probe depends on no standing
// password and leaves nothing behind. It cleans up after itself: the rows
// and both accounts are deleted, and the sessions and profiles counts are
// checked against what they were before this script ran.
//
// Usage: node scripts/probe-session-rls.mjs
import {
  readEnv, jsonHeaders, serviceHeaders, serviceRepr, userHeaders,
  createThrowawayUser, deleteThrowawayUser, profileCount,
} from "./probe-accounts.mjs";

const env = readEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = serviceHeaders(env);
const HOURLY_RATE = 500;

let failures = 0;
const verdict = (refused, label) => {
  const tag = refused ? "\x1b[32mREFUSED \x1b[0m" : "\x1b[31mPERMITTED\x1b[0m";
  console.log(`  ${tag}  ${label}`);
  if (!refused) failures++;
};
// Cleanup is not an attack, so it does not get the REFUSED/PERMITTED reading —
// forcing it through the same verdict prints "REFUSED  sessions returned to
// its original 5 rows", which reads as the opposite of what happened.
const cleanedUp = (ok, label) => {
  console.log(`  ${ok ? "\x1b[32mCLEAN   \x1b[0m" : "\x1b[31mLEFTOVER\x1b[0m"}  ${label}`);
  if (!ok) failures++;
};

async function tableCount() {
  const res = await fetch(`${URL}/rest/v1/sessions?select=id`, { headers: SERVICE });
  const rows = await res.json();
  return rows.length;
}

async function seedPending(studentId, teacherId) {
  const body = {
    student_id: studentId,
    teacher_id: teacherId,
    curriculum: "CBSE",
    grade: "10th",
    stream: "Science",
    subject: "Mathematics",
    type: "instant",
    status: "pending",
    accept_deadline: new Date(Date.now() + 30_000).toISOString(),
    hourly_rate: HOURLY_RATE,
  };
  const res = await fetch(`${URL}/rest/v1/sessions`, {
    method: "POST",
    headers: jsonHeaders(serviceRepr(env)),
    body: JSON.stringify(body),
  });
  const rows = await res.json();
  if (!res.ok || !rows[0]) throw new Error(`seed failed (setup, not the test): ${JSON.stringify(rows)}`);
  return rows[0];
}

async function acceptAsTeacher(id, teacherToken) {
  const res = await fetch(`${URL}/rest/v1/sessions?id=eq.${id}`, {
    method: "PATCH",
    headers: userHeaders(env, teacherToken),
    body: JSON.stringify({ status: "accepted", payment_deadline: new Date(Date.now() + 90_000).toISOString() }),
  });
  const rows = await res.json();
  if (!res.ok || !rows[0]) throw new Error(`accept-as-teacher failed (setup, not the test): ${JSON.stringify(rows)}`);
  return rows[0];
}

async function readRow(id) {
  const res = await fetch(`${URL}/rest/v1/sessions?id=eq.${id}&select=*`, { headers: SERVICE });
  const rows = await res.json();
  return rows[0];
}

// Sends the attack with the attacker's own token, then independently re-reads
// the row with the service role. A refusal requires BOTH: the HTTP layer
// said no, AND nothing the attack tried to change actually changed. Trusting
// the HTTP status alone would miss a trigger that errors but still commits a
// partial write — this makes that impossible to miss.
async function attack(label, patch, token, id, before) {
  const res = await fetch(`${URL}/rest/v1/sessions?id=eq.${id}`, {
    method: "PATCH",
    headers: userHeaders(env, token),
    body: JSON.stringify(patch),
  });
  const httpRefused = !res.ok;
  const after = await readRow(id);
  const changed = Object.keys(patch).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  const refused = httpRefused && changed.length === 0;
  verdict(refused, label);
  if (!refused) {
    console.error(`      status ${res.status}; columns actually changed: ${changed.join(", ") || "(none — HTTP was 2xx anyway)"}`);
  }
  return after;
}

// One battery, run under whichever participant's token is passed in. The row
// arrives already `accepted` with a payment_deadline, which is the state the
// student is actually looking at when the Pay button is on screen — the
// moment they have both the motive and the access to try any of this.
async function battery(who, token, id, seededRow) {
  console.log(`\n— attacking ${id} as the ${who} —\n`);
  let row = seededRow;
  row = await attack(`[${who}] mark it PAID (free tutoring)`, { status: "paid" }, token, id, row);
  row = await attack(`[${who}] jump straight to ACTIVE with a chosen started_at and room url`,
    { status: "active", started_at: new Date().toISOString(), daily_room_url: "https://daily.example/forged-room" },
    token, id, row);
  row = await attack(`[${who}] write an amount never charged`, { amount_paid_paise: 1 }, token, id, row);
  row = await attack(`[${who}] forge a refund reference`, { refund_ref: "stolen" }, token, id, row);
  row = await attack(`[${who}] mark it REFUNDED outright (never paid)`, { status: "refunded" }, token, id, row);
  row = await attack(`[${who}] point payment_checkout_url off-platform`,
    { payment_checkout_url: "https://attacker.example/pay" }, token, id, row);
  row = await attack(`[${who}] expire the payment window early to dump the student`,
    { payment_deadline: new Date(Date.now() - 1000).toISOString() }, token, id, row);

  console.log(`\n  — [${who}] attacking the terms of the deal —\n`);
  row = await attack(`[${who}] rewrite hourly_rate (${HOURLY_RATE} -> 1)`, { hourly_rate: 1 }, token, id, row);
  row = await attack(`[${who}] rewrite subject`, { subject: "Physics" }, token, id, row);
  // Last attack in the battery, so its result is not threaded onward.
  await attack(`[${who}] rewrite accept_deadline (grant an extra hour)`,
    { accept_deadline: new Date(Date.now() + 3_600_000).toISOString() }, token, id, row);
}

(async () => {
  console.log("probe-session-rls — attacking live sessions with each participant's own JWT\n");

  const sessionsBefore = await tableCount();
  const profilesBefore = await profileCount(env);

  let teacher = null;
  let student = null;
  const seededIds = [];

  try {
    teacher = await createThrowawayUser(env, { role: "teacher", fullName: "Probe Teacher", hourlyRate: HOURLY_RATE });
    student = await createThrowawayUser(env, { role: "student", fullName: "Probe Student" });
    console.log(`throwaway teacher ${teacher.id} and student ${student.id} created and signed in`);

    // Two rows, so each battery starts from a pristine `accepted` row. If an
    // attack ever IS permitted, the first battery leaves its row moved — and
    // the second must not inherit that state and report a different rule
    // than the one it is meant to be testing.
    for (const who of ["teacher", "student"]) {
      const seeded = await seedPending(student.id, teacher.id);
      seededIds.push(seeded.id);
      const accepted = await acceptAsTeacher(seeded.id, teacher.token);
      const token = who === "teacher" ? teacher.token : student.token;
      await battery(who, token, seeded.id, accepted);
    }
  } finally {
    for (const id of seededIds) {
      await fetch(`${URL}/rest/v1/sessions?id=eq.${id}`, { method: "DELETE", headers: SERVICE });
    }
    // Deleting the users cascades profiles and any sessions they took part
    // in; the explicit session deletes above just make the order deterministic.
    for (const u of [teacher, student]) {
      if (u && !(await deleteThrowawayUser(env, u.id))) {
        console.error(`      could not delete throwaway ${u.role} ${u.id} (${u.email}) — remove it by hand`);
        failures++;
      }
    }
    const sessionsAfter = await tableCount();
    const profilesAfter = await profileCount(env);
    console.log();
    cleanedUp(sessionsAfter === sessionsBefore, `sessions returned to its original ${sessionsBefore} row(s) (now ${sessionsAfter})`);
    cleanedUp(profilesAfter === profilesBefore, `profiles returned to its original ${profilesBefore} row(s) (now ${profilesAfter})`);
  }

  console.log();
  if (failures === 0) {
    console.log("ALL ATTACKS REFUSED, AS BOTH PARTICIPANTS — migration 0005 holds.");
    process.exit(0);
  } else {
    console.log(`${failures} ATTACK(S) PERMITTED — STOP. The milestone is not shippable.`);
    process.exit(1);
  }
})().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
