#!/usr/bin/env node
// The regression guard. probe-session-rls proves migration 0005's trigger
// REFUSES every attack; this proves the same trigger still PERMITS every
// write the application actually makes. A migration that blocks a
// legitimate write is worse than the bug it closed — run both together.
//
// Credentials available to this script: the teacher's own password (env),
// and the service role. There is no student password in this environment,
// so steps the app makes with a STUDENT token (the request insert) run
// under the service role instead — migration 0005 touched the insert
// TRIGGER (it now also bans forged payment columns on insert), not the
// insert RLS policy, so the trigger is what this needs to exercise; the RLS
// policy itself is unchanged since M2 and was proved there. Steps the app
// makes with the TEACHER's own token (accept, settle-to-payment_expired,
// complete) really do run under the teacher's JWT below, because that
// credential is available and using it is strictly stronger evidence.
//
// Seeds three throwaway sessions, drives each through a real lifecycle,
// then deletes all three and confirms the table's row count is unchanged.
//
// Usage: PROBE_TEACHER_PASSWORD='...' node scripts/probe-happy-path.mjs
import fs from "node:fs";
import crypto from "node:crypto";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);

const TEACHER_ID = "774d5217-7a79-4877-8849-bda795f748df";
const TEACHER_EMAIL = "tutor-check@smbtutorials.in";
const STUDENT_ID = "fbc550d4-3d56-4e96-9239-81717fdf5c81";
const TEACHER_HOURLY_RATE = 500;
const AMOUNT_PAISE = 50_000; // amountPaiseFor(500, 60) — ₹500/hr * 60min

const password = process.env.PROBE_TEACHER_PASSWORD;
if (!password) {
  console.error("PROBE_TEACHER_PASSWORD is not set. Refusing to run — this script never hard-codes a credential.");
  console.error("Usage: PROBE_TEACHER_PASSWORD='...' node scripts/probe-happy-path.mjs");
  process.exit(1);
}

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
// PostgREST returns 204 with no body unless asked for the row back — every
// write() call below needs the row to check what actually happened.
const SERVICE_REPR = { ...SERVICE, prefer: "return=representation" };
const jsonHeaders = (h) => ({ ...h, "content-type": "application/json" });

let failures = 0;
// Two verdict readings share one failure counter: "good" always renders
// green, "bad" always renders red — but which word means which flips
// between the two kinds of assertion this script makes, so each gets its
// own label rather than forcing one word to mean opposite things.
const permitted = (ok, label) => {
  console.log(`  ${ok ? "\x1b[32mPERMITTED\x1b[0m" : "\x1b[31mREFUSED  \x1b[0m"}  ${label}`);
  if (!ok) failures++;
};
const refused = (ok, label) => {
  console.log(`  ${ok ? "\x1b[32mREFUSED  \x1b[0m" : "\x1b[31mPERMITTED\x1b[0m"}  ${label}`);
  if (!ok) failures++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ref = (tag) => `probe_${tag}_${crypto.randomUUID()}`;

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
  return (await res.json()).length;
}

function teacherHeaders(token) {
  return jsonHeaders({
    apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    prefer: "return=representation",
  });
}

// A "write" here is one attempted PATCH/POST. Reports whether it succeeded
// (2xx AND at least one row returned/affected) — that combination is what
// the app itself treats as success in every Server Action this mirrors.
async function write(label, { method, path, headers, body, expectRow = true }) {
  const res = await fetch(`${URL}/rest/v1${path}`, { method, headers: jsonHeaders(headers), body: JSON.stringify(body) });
  let rows = [];
  try { rows = await res.json(); } catch { /* no body */ }
  const ok = res.ok && (!expectRow || (Array.isArray(rows) && rows.length > 0));
  permitted(ok, label);
  if (!ok) console.error(`      status ${res.status}:`, rows);
  return Array.isArray(rows) ? rows[0] : rows;
}

async function seedPending(subject = "Mathematics") {
  const body = {
    student_id: STUDENT_ID,
    teacher_id: TEACHER_ID,
    curriculum: "CBSE",
    grade: "10th",
    stream: "Science",
    subject,
    type: "instant",
    status: "pending",
    accept_deadline: new Date(Date.now() + 30_000).toISOString(),
    hourly_rate: TEACHER_HOURLY_RATE,
  };
  return write("the student's insert (pending request)", {
    method: "POST", path: "/sessions", headers: SERVICE_REPR, body,
  });
}

(async () => {
  console.log("probe-happy-path — proving migration 0005 still permits every legitimate write\n");

  const countBefore = await tableCount();
  const token = await signInTeacher();
  const seededIds = [];

  try {
    // ---- Row 1: full lifecycle pending -> accepted -> paid -> active -> completed ----
    console.log("Row 1 — full lifecycle to completion:");
    const row1 = await seedPending("Mathematics");
    seededIds.push(row1.id);

    const paymentDeadline1 = new Date(Date.now() + 90_000).toISOString();
    await write("teacher's pending -> accepted, carrying payment_deadline", {
      method: "PATCH", path: `/sessions?id=eq.${row1.id}`, headers: teacherHeaders(token),
      body: { status: "accepted", payment_deadline: paymentDeadline1 },
    });

    const ref1 = ref("checkout");
    await write("checkout creation stamps payment_ref/provider/checkout_url (service role)", {
      method: "PATCH", path: `/sessions?id=eq.${row1.id}&status=eq.accepted&payment_ref=is.null`, headers: SERVICE_REPR,
      body: { payment_ref: ref1, payment_provider: "stub", payment_checkout_url: `https://pay.example/${ref1}` },
    });

    await write("accepted -> paid with an amount (service role)", {
      method: "PATCH", path: `/sessions?id=eq.${row1.id}&status=eq.accepted`, headers: SERVICE_REPR,
      body: { status: "paid", amount_paid_paise: AMOUNT_PAISE, payment_provider: "stub" },
    });

    await write("paid -> active with started_at and a room url (service role)", {
      method: "PATCH", path: `/sessions?id=eq.${row1.id}&status=eq.paid`, headers: SERVICE_REPR,
      body: { status: "active", started_at: new Date().toISOString(), daily_room_url: "https://daily.example/probe-room-1" },
    });

    await write("active -> completed by a participant (the teacher)", {
      method: "PATCH", path: `/sessions?id=eq.${row1.id}&status=eq.active`, headers: teacherHeaders(token),
      body: { status: "completed" },
    });

    // ---- Row 2: accepted -> paid -> refunded ----
    console.log("\nRow 2 — paid, then refunded:");
    const row2 = await seedPending("Physics");
    seededIds.push(row2.id);

    await write("teacher's pending -> accepted (row 2)", {
      method: "PATCH", path: `/sessions?id=eq.${row2.id}`, headers: teacherHeaders(token),
      body: { status: "accepted", payment_deadline: new Date(Date.now() + 90_000).toISOString() },
    });

    const ref2 = ref("checkout");
    await write("checkout creation stamps payment_ref (row 2, service role)", {
      method: "PATCH", path: `/sessions?id=eq.${row2.id}&status=eq.accepted&payment_ref=is.null`, headers: SERVICE_REPR,
      body: { payment_ref: ref2, payment_provider: "stub", payment_checkout_url: `https://pay.example/${ref2}` },
    });

    await write("accepted -> paid (row 2, service role)", {
      method: "PATCH", path: `/sessions?id=eq.${row2.id}&status=eq.accepted`, headers: SERVICE_REPR,
      body: { status: "paid", amount_paid_paise: AMOUNT_PAISE, payment_provider: "stub" },
    });

    await write("paid -> refunded with a refund_ref (room mint failed, service role)", {
      method: "PATCH", path: `/sessions?id=eq.${row2.id}&status=eq.paid`, headers: SERVICE_REPR,
      body: { status: "refunded", refund_ref: ref("refund"), payment_provider: "stub" },
    });

    // ---- Row 3: accepted -> payment_expired, then a late webhook pays it out ----
    // Kicked off before Row 1/2's async work finishes below so the 60s
    // minimum payment_deadline has real time to elapse while this script
    // does other work, rather than the script blocking on a bare sleep.
    console.log("\nRow 3 — payment window expires, then a late success webhook arrives:");
    const row3 = await seedPending("Chemistry");
    seededIds.push(row3.id);
    const paymentDeadline3 = new Date(Date.now() + 61_000).toISOString(); // minimum allowed window

    await write("teacher's pending -> accepted (row 3)", {
      method: "PATCH", path: `/sessions?id=eq.${row3.id}`, headers: teacherHeaders(token),
      body: { status: "accepted", payment_deadline: paymentDeadline3 },
    });
    const ref3 = ref("checkout");
    await write("checkout was created before the window expired (row 3, service role)", {
      method: "PATCH", path: `/sessions?id=eq.${row3.id}&status=eq.accepted&payment_ref=is.null`, headers: SERVICE_REPR,
      body: { payment_ref: ref3, payment_provider: "stub", payment_checkout_url: `https://pay.example/${ref3}` },
    });

    const remainingMs = new Date(paymentDeadline3).getTime() - Date.now() + 1_000;
    if (remainingMs > 0) {
      console.log(`  (waiting ${Math.ceil(remainingMs / 1000)}s for row 3's payment_deadline to actually pass — Postgres now(), not this script's clock, is the authority)`);
      await sleep(remainingMs);
    }

    await write("accepted -> payment_expired after its deadline (teacher settles on read, as acceptSession does)", {
      method: "PATCH", path: `/sessions?id=eq.${row3.id}&status=eq.accepted`, headers: teacherHeaders(token),
      body: { status: "payment_expired" },
    });

    await write("late success webhook: row KEEPS its status, gains amount_paid_paise + refund_ref (service role)", {
      method: "PATCH", path: `/sessions?id=eq.${row3.id}&status=eq.payment_expired`, headers: SERVICE_REPR,
      body: { amount_paid_paise: AMOUNT_PAISE, refund_ref: ref("late_refund"), payment_provider: "stub" },
    });

    // ---- Malformed inserts: the trigger is not role-gated, so even the
    // service role must be refused here. ----
    console.log("\nMalformed inserts (must be refused even under the service role):");
    const base = {
      student_id: STUDENT_ID, teacher_id: TEACHER_ID, curriculum: "CBSE", grade: "10th",
      stream: "Science", subject: "Mathematics", type: "instant",
    };

    {
      const res = await fetch(`${URL}/rest/v1/sessions`, {
        method: "POST", headers: jsonHeaders({ ...SERVICE, prefer: "return=representation" }),
        body: JSON.stringify({ ...base, status: "pending", accept_deadline: new Date(Date.now() + 30_000).toISOString(), hourly_rate: 99_999 }),
      });
      refused(!res.ok, "inflated hourly_rate (99999, teacher's actual rate is 500)");
      if (res.ok) console.error("      an inflated-rate row was created:", await res.json());
    }
    {
      const res = await fetch(`${URL}/rest/v1/sessions`, {
        method: "POST", headers: jsonHeaders({ ...SERVICE, prefer: "return=representation" }),
        body: JSON.stringify({ ...base, status: "active", hourly_rate: TEACHER_HOURLY_RATE, started_at: new Date().toISOString(), daily_room_url: "https://daily.example/forged" }),
      });
      refused(!res.ok, "a row arriving already ACTIVE");
      if (res.ok) console.error("      a pre-active row was created:", await res.json());
    }
    {
      const res = await fetch(`${URL}/rest/v1/sessions`, {
        method: "POST", headers: jsonHeaders({ ...SERVICE, prefer: "return=representation" }),
        body: JSON.stringify({ ...base, status: "pending", accept_deadline: new Date(Date.now() + 3_600_000).toISOString(), hourly_rate: TEACHER_HOURLY_RATE }),
      });
      refused(!res.ok, "a self-granted hour-long accept window");
      if (res.ok) console.error("      an hour-long-window row was created:", await res.json());
    }
  } finally {
    for (const id of seededIds) {
      await fetch(`${URL}/rest/v1/sessions?id=eq.${id}`, { method: "DELETE", headers: SERVICE });
    }
    const countAfter = await tableCount();
    console.log();
    permitted(countAfter === countBefore, `table returned to its original ${countBefore} row(s) (now ${countAfter})`);
  }

  console.log();
  if (failures === 0) {
    console.log("ALL LEGITIMATE WRITES PERMITTED, ALL MALFORMED INSERTS REFUSED — no regression.");
    process.exit(0);
  } else {
    console.log(`${failures} CHECK(S) FAILED — migration 0005 broke a write the app depends on, or let a malformed one through.`);
    process.exit(1);
  }
})().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
