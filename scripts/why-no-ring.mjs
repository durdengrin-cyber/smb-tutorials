#!/usr/bin/env node
// The answer to the likeliest support question in a trial: a teacher says
// "it didn't ring", and until now there was no way to tell them why.
//
//   node scripts/why-no-ring.mjs                    # last 20 dispatches, everyone
//   node scripts/why-no-ring.mjs teacher@email      # just this teacher
//
// Reads .env.local. Local operator tool — never imported by the app.
import { readEnv, serviceHeaders } from "./probe-accounts.mjs";

const env = readEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const H = serviceHeaders(env);
const who = process.argv[2];

const C = { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", off: "\x1b[0m" };
const paint = (o) => ({
  sent: C.green, gone: C.cyan, failed: C.red, threw: C.red,
  no_devices: C.yellow, read_error: C.red,
}[o] ?? "");

// What each outcome actually MEANS operationally. The point of this tool is
// that the reader should not have to know the schema to act on it.
const MEANING = {
  sent:       "delivered to the push service (not proof the phone showed it)",
  gone:       "subscription dead — device row pruned, teacher must re-enable",
  failed:     "push service refused; device kept, will retry next request",
  threw:      "OUR error before the push service — check the detail",
  no_devices: "teacher had NO registered device — nothing was ever sent",
  read_error: "could not read the device list — dispatch never ran",
};

let teacher = null;
if (who) {
  const rows = await (await fetch(
    `${URL}/rest/v1/profiles?select=id,full_name,role&email=eq.${encodeURIComponent(who)}`,
    { headers: H })).json();
  teacher = rows?.[0];
  if (!teacher) { console.log(`no profile for ${who}`); process.exit(1); }
  console.log(`\n${teacher.full_name} (${teacher.role})  ${who}`);
}

// 1. Device health — from 0008/0012's columns, which nothing has ever read.
const devQ = `${URL}/rest/v1/teacher_devices?select=id,teacher_id,created_at,last_ok_at,last_failed_at,failure_count`
  + (teacher ? `&teacher_id=eq.${teacher.id}` : "");
const devices = await (await fetch(devQ, { headers: H })).json();

console.log(`\n${C.dim}DEVICES${C.off}  ${devices.length} registered`);
if (!devices.length) {
  console.log(`  ${C.yellow}none — this teacher CANNOT be reached when their dashboard is closed${C.off}`);
}
for (const d of devices) {
  const stale = d.failure_count > 0;
  console.log(`  ${stale ? C.red : C.green}●${C.off} ${d.id.slice(0, 8)}  registered ${d.created_at.slice(0, 16).replace("T", " ")}`);
  console.log(`     last ok: ${d.last_ok_at?.slice(0, 16).replace("T", " ") ?? C.yellow + "NEVER" + C.off}   last fail: ${d.last_failed_at?.slice(0, 16).replace("T", " ") ?? "-"}   consecutive failures: ${stale ? C.red + d.failure_count + C.off : "0"}`);
}

// 2. What actually happened, attempt by attempt.
const evQ = `${URL}/rest/v1/notification_events?select=*&order=created_at.desc&limit=20`
  + (teacher ? `&teacher_id=eq.${teacher.id}` : "");
const evRes = await fetch(evQ, { headers: H });
if (!evRes.ok) {
  console.log(`\n${C.red}notification_events unreadable${C.off} — is migration 0015 applied? (HTTP ${evRes.status})`);
  process.exit(1);
}
const events = await evRes.json();

console.log(`\n${C.dim}LAST ${events.length} DISPATCH ATTEMPTS${C.off}`);
if (!events.length) console.log(`  ${C.dim}none yet — no session has been requested since 0015 was applied${C.off}`);
for (const e of events) {
  console.log(`  ${paint(e.outcome)}${e.outcome.padEnd(11)}${C.off} ${e.created_at.slice(0, 19).replace("T", " ")}  session ${e.session_id?.slice(0, 8) ?? "—"}  device ${e.device_id?.slice(0, 8) ?? "—"}${e.status_code ? "  HTTP " + e.status_code : ""}`);
  console.log(`              ${C.dim}${MEANING[e.outcome]}${C.off}`);
  if (e.detail) console.log(`              ${C.red}${e.detail.slice(0, 160)}${C.off}`);
}

// 3. The one conclusion worth drawing automatically.
const lastNoDevices = events.find((e) => e.outcome === "no_devices");
if (lastNoDevices && devices.length === 0) {
  console.log(`\n${C.yellow}LIKELY CAUSE${C.off}  This teacher has no registered device, so no push was ever attempted.`);
  console.log(`  They need to open the dashboard and tap "Turn on notifications" — on iPhone, from the`);
  console.log(`  Home Screen app, not a Safari tab (the installed app has its own separate storage).`);
}
