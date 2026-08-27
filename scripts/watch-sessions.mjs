#!/usr/bin/env node
// Live view of the sessions table while you walk the loop by hand.
// The UI can lie to you; this cannot. Run alongside a two-browser test:
//   node scripts/watch-sessions.mjs
// Reads .env.local. Local dev tool — never imported by the app.
//
// Updated for M3: this predated payments and showed none of the money, which
// made it useless for exactly the run it exists to support. It now shows the
// payment window's clock, whether a charge was opened, what was actually
// collected, and any refund — the four things you cannot tell from a screen.
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    // Skip comments: .env.local carries commented-out examples now, and
    // `# RAZORPAY_KEY_ID=...` would otherwise parse as a key.
    .filter((l) => !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const SELECT =
  "id,student_name,subject,status,hourly_rate,accept_deadline,payment_deadline,started_at,daily_room_url,payment_ref,amount_paid_paise,refund_ref,created_at";

const paint = (s) => ({
  pending: "\x1b[33m",          // waiting on the teacher
  accepted: "\x1b[33m",         // waiting on the student's money
  paid: "\x1b[35m",             // WE HOLD MONEY AND OWE A ROOM — never terminal
  active: "\x1b[32m",
  completed: "\x1b[36m",
  refunded: "\x1b[36m",
  declined: "\x1b[90m",
  timed_out: "\x1b[31m",
  payment_expired: "\x1b[31m",
  cancelled: "\x1b[90m",
}[s] ?? "");

const inr = (paise) => (paise === null || paise === undefined ? "—" : `₹${(paise / 100).toFixed(0)}`);

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
    // Which clock is live depends on the state, exactly as effectiveStatus decides.
    let clock = "";
    if (r.status === "pending" && r.accept_deadline) {
      clock = `${Math.max(0, Math.ceil((new Date(r.accept_deadline) - now) / 1000))}s to accept`;
    } else if (r.status === "accepted" && r.payment_deadline) {
      clock = `${Math.max(0, Math.ceil((new Date(r.payment_deadline) - now) / 1000))}s to pay`;
    } else if (r.status === "active" && r.started_at) {
      clock = `${Math.floor((now - new Date(r.started_at)) / 60000)}m in`;
    }
    const charge = r.payment_ref ? "chg✓" : "chg·";
    const refund = r.refund_ref ? " REFUNDED" : "";
    return `  ${short}  ${paint(r.status)}${r.status.padEnd(16)}\x1b[0m ${String(r.student_name ?? "—").padEnd(12)} ${String(r.subject).padEnd(10)} ${charge} ${inr(r.amount_paid_paise).padEnd(6)} ${room}  ${clock}${refund}`;
  }).join("\n");

  const frame = rows.length ? body : "  (no sessions yet — click Start now)";
  if (frame === last) return;
  last = frame;
  console.clear();
  console.log("sessions — newest first (Ctrl+C to stop)\n");
  console.log("  id        status           student      subject    chg  paid   room   clock");
  console.log("  ──────────────────────────────────────────────────────────────────────────");
  console.log(frame);
  // The one line worth reading twice. `paid` means money is in and no room
  // has been delivered: design spec §6 invariant 3 says it is never terminal.
  const stuck = rows.filter((r) => r.status === "paid");
  if (stuck.length) {
    console.log(`\n  \x1b[35m⚠ ${stuck.length} row(s) sitting at 'paid' — money in, no room. Should resolve in seconds; if not, that is invariant 3.\x1b[0m`);
  }
};

await tick();
setInterval(tick, 1000);
