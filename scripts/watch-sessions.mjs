#!/usr/bin/env node
// Live view of the sessions table while you walk the loop by hand.
// The UI can lie to you; this cannot. Run alongside a two-browser test:
//   node scripts/watch-sessions.mjs
// Reads .env.local. Local dev tool — never imported by the app.
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const SELECT = "id,student_name,subject,status,hourly_rate,accept_deadline,started_at,daily_room_url,created_at";

const paint = (s) => ({
  pending: "\x1b[33m", active: "\x1b[32m", completed: "\x1b[36m",
  declined: "\x1b[35m", timed_out: "\x1b[31m", cancelled: "\x1b[90m",
}[s] ?? "");

let last = "";
const tick = async () => {
  const res = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sessions?select=${SELECT}&order=created_at.desc&limit=10`,
    { headers: H }
  );
  if (!res.ok) { console.log("query failed:", res.status); return; }
  const rows = await res.json();

  const now = Date.now();
  const body = rows.map((r) => {
    const short = r.id.slice(0, 8);
    const room = r.daily_room_url ? "room✓" : "room·";
    let clock = "";
    if (r.status === "pending" && r.accept_deadline) {
      clock = `${Math.max(0, Math.ceil((new Date(r.accept_deadline) - now) / 1000))}s left`;
    } else if (r.status === "active" && r.started_at) {
      clock = `${Math.floor((now - new Date(r.started_at)) / 60000)}m in`;
    }
    return `  ${short}  ${paint(r.status)}${r.status.padEnd(10)}\x1b[0m ${String(r.student_name ?? "—").padEnd(14)} ${String(r.subject).padEnd(12)} ₹${String(r.hourly_rate).padEnd(6)} ${room}  ${clock}`;
  }).join("\n");

  const frame = rows.length ? body : "  (no sessions yet — click Start now)";
  if (frame === last) return;
  last = frame;
  console.clear();
  console.log("sessions — newest first (Ctrl+C to stop)\n");
  console.log("  id        status     student        subject      rate    room   clock");
  console.log("  ────────────────────────────────────────────────────────────────────");
  console.log(frame);
};

await tick();
setInterval(tick, 1000);
