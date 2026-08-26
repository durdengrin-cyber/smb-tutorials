#!/usr/bin/env node
// The milestone's most important test (M3 design spec §8). A mock cannot
// prove a database rule — this attacks the REAL sessions table with a REAL
// teacher JWT through PostgREST, the exact path a browser uses, and proves
// migration 0005's trigger refuses every attack it claims to refuse.
//
// Seeds one throwaway session, accepts it as the teacher would, then fires
// the attacks below with that teacher's own token. Every one must be
// refused — both by the HTTP layer (non-2xx) and, belt and braces, by
// re-reading the row afterward to confirm nothing actually moved. Cleans up
// after itself: the row is deleted and the table's row count is checked
// against what it was before this script ran.
//
// Usage: PROBE_TEACHER_PASSWORD='...' node scripts/probe-session-rls.mjs
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);

const TEACHER_ID = "774d5217-7a79-4877-8849-bda795f748df";
const TEACHER_EMAIL = "tutor-check@smbtutorials.in";
const STUDENT_ID = "fbc550d4-3d56-4e96-9239-81717fdf5c81";
const TEACHER_HOURLY_RATE = 500;

const password = process.env.PROBE_TEACHER_PASSWORD;
if (!password) {
  console.error("PROBE_TEACHER_PASSWORD is not set. Refusing to run — this script never hard-codes a credential.");
  console.error("Usage: PROBE_TEACHER_PASSWORD='...' node scripts/probe-session-rls.mjs");
  process.exit(1);
}

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const jsonHeaders = (h) => ({ ...h, "content-type": "application/json" });

let failures = 0;
const verdict = (refused, label) => {
  const tag = refused ? "\x1b[32mREFUSED \x1b[0m" : "\x1b[31mPERMITTED\x1b[0m";
  console.log(`  ${tag}  ${label}`);
  if (!refused) failures++;
};

async function signInTeacher() {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: jsonHeaders({ apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }),
    body: JSON.stringify({ email: TEACHER_EMAIL, password }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    console.error("Teacher sign-in failed — cannot run the probe:", json);
    process.exit(1);
  }
  return json.access_token;
}

async function tableCount() {
  const res = await fetch(`${URL}/rest/v1/sessions?select=id`, { headers: SERVICE });
  const rows = await res.json();
  return rows.length;
}

async function seedPending() {
  const body = {
    student_id: STUDENT_ID,
    teacher_id: TEACHER_ID,
    curriculum: "CBSE",
    grade: "10th",
    stream: "Science",
    subject: "Mathematics",
    type: "instant",
    status: "pending",
    accept_deadline: new Date(Date.now() + 30_000).toISOString(),
    hourly_rate: TEACHER_HOURLY_RATE,
  };
  const res = await fetch(`${URL}/rest/v1/sessions`, {
    method: "POST",
    headers: jsonHeaders({ ...SERVICE, prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  const rows = await res.json();
  if (!res.ok || !rows[0]) throw new Error(`seed failed (setup, not the test): ${JSON.stringify(rows)}`);
  return rows[0];
}

function teacherHeaders(token) {
  return jsonHeaders({
    apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    prefer: "return=representation",
  });
}

async function acceptAsTeacher(id, token) {
  const res = await fetch(`${URL}/rest/v1/sessions?id=eq.${id}`, {
    method: "PATCH",
    headers: teacherHeaders(token),
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

// Sends the attack with the teacher's own token, then independently re-reads
// the row with the service role. A refusal requires BOTH: the HTTP layer
// said no, AND nothing the attack tried to change actually changed. Trusting
// the HTTP status alone would miss a trigger that errors but still commits a
// partial write — this makes that impossible to miss.
async function attack(label, patch, token, id, before) {
  const res = await fetch(`${URL}/rest/v1/sessions?id=eq.${id}`, {
    method: "PATCH",
    headers: teacherHeaders(token),
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

(async () => {
  console.log("probe-session-rls — attacking a live session with the teacher's own JWT\n");

  const countBefore = await tableCount();
  const token = await signInTeacher();
  const seeded = await seedPending();
  let row;
  try {
    row = await acceptAsTeacher(seeded.id, token);
    console.log(`seeded ${seeded.id}, accepted as the teacher (payment_deadline set) — now attacking:\n`);

    row = await attack("mark it PAID (free tutoring)", { status: "paid" }, token, seeded.id, row);
    row = await attack("jump straight to ACTIVE with a chosen started_at and room url",
      { status: "active", started_at: new Date().toISOString(), daily_room_url: "https://daily.example/forged-room" },
      token, seeded.id, row);
    row = await attack("write an amount never charged", { amount_paid_paise: 1 }, token, seeded.id, row);
    row = await attack("forge a refund reference", { refund_ref: "stolen" }, token, seeded.id, row);
    row = await attack("mark it REFUNDED outright (never paid)", { status: "refunded" }, token, seeded.id, row);
    row = await attack("point payment_checkout_url off-platform",
      { payment_checkout_url: "https://attacker.example/pay" }, token, seeded.id, row);
    row = await attack("expire the payment window early to dump the student",
      { payment_deadline: new Date(Date.now() - 1000).toISOString() }, token, seeded.id, row);

    console.log("\n  — attacking the terms of the deal —\n");
    row = await attack("rewrite hourly_rate (500 -> 1)", { hourly_rate: 1 }, token, seeded.id, row);
    row = await attack("rewrite subject", { subject: "Physics" }, token, seeded.id, row);
    row = await attack("rewrite accept_deadline (grant an extra hour)",
      { accept_deadline: new Date(Date.now() + 3_600_000).toISOString() }, token, seeded.id, row);
  } finally {
    await fetch(`${URL}/rest/v1/sessions?id=eq.${seeded.id}`, { method: "DELETE", headers: SERVICE });
    const countAfter = await tableCount();
    console.log();
    verdict(countAfter === countBefore, `table returned to its original ${countBefore} row(s) (now ${countAfter})`);
  }

  console.log();
  if (failures === 0) {
    console.log("ALL ATTACKS REFUSED — migration 0005 holds.");
    process.exit(0);
  } else {
    console.log(`${failures} ATTACK(S) PERMITTED — STOP. The milestone is not shippable.`);
    process.exit(1);
  }
})().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
