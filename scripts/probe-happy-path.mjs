#!/usr/bin/env node
// The regression guard. probe-session-rls proves migration 0005's trigger
// REFUSES every attack; this proves the same trigger still PERMITS every
// write the application actually makes. A migration that blocks a
// legitimate write is worse than the bug it closed — run both together.
//
// Both participants are throwaway accounts created and deleted inside this
// run (see probe-accounts.mjs), so every step the app performs with a user's
// own token is performed here with a real JWT for that user — including the
// student's insert and the student's cancel, neither of which the service
// role can stand in for. The `cancelled` gate is the reason this matters:
// the trigger reads `uid is distinct from old.student_id` with NO
// service-role escape, unlike the payment-column gate, so a service-role
// run would prove nothing about it.
//
// Seeds four throwaway sessions, drives each through a real lifecycle, then
// deletes them and both accounts and confirms the sessions and profiles
// counts are unchanged.
//
// Usage: node scripts/probe-happy-path.mjs
import crypto from "node:crypto";
import {
  readEnv, jsonHeaders, serviceHeaders, serviceRepr, userHeaders,
  createThrowawayUser, deleteThrowawayUser, profileCount,
} from "./probe-accounts.mjs";

const env = readEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = serviceHeaders(env);
const SERVICE_REPR = serviceRepr(env);
const HOURLY_RATE = 500;
const AMOUNT_PAISE = 50_000; // amountPaiseFor(500, 60) — ₹500/hr * 60min

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

// Cleanup is neither a legitimate write nor a malformed one, so it gets its
// own reading rather than being forced through PERMITTED/REFUSED.
const cleanedUp = (ok, label) => {
  console.log(`  ${ok ? "\x1b[32mCLEAN    \x1b[0m" : "\x1b[31mLEFTOVER \x1b[0m"}  ${label}`);
  if (!ok) failures++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ref = (tag) => `probe_${tag}_${crypto.randomUUID()}`;

async function tableCount() {
  const res = await fetch(`${URL}/rest/v1/sessions?select=id`, { headers: SERVICE });
  return (await res.json()).length;
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

(async () => {
  console.log("probe-happy-path — proving migration 0005 still permits every legitimate write\n");

  const sessionsBefore = await tableCount();
  const profilesBefore = await profileCount(env);

  let teacher = null;
  let student = null;
  const seededIds = [];

  try {
    teacher = await createThrowawayUser(env, { role: "teacher", fullName: "Probe Teacher", hourlyRate: HOURLY_RATE });
    student = await createThrowawayUser(env, { role: "student", fullName: "Probe Student" });
    console.log(`throwaway teacher ${teacher.id} and student ${student.id} created and signed in\n`);

    const seedPending = (subject) =>
      write("the student's insert with their OWN token (pending request)", {
        method: "POST", path: "/sessions", headers: userHeaders(env, student.token),
        body: {
          student_id: student.id,
          teacher_id: teacher.id,
          curriculum: "CBSE",
          grade: "10th",
          stream: "Science",
          subject,
          type: "instant",
          status: "pending",
          accept_deadline: new Date(Date.now() + 30_000).toISOString(),
          hourly_rate: HOURLY_RATE,
        },
      });

    // ---- Row 1: full lifecycle pending -> accepted -> paid -> active -> completed ----
    console.log("Row 1 — full lifecycle to completion:");
    const row1 = await seedPending("Mathematics");
    seededIds.push(row1.id);

    const paymentDeadline1 = new Date(Date.now() + 90_000).toISOString();
    await write("teacher's pending -> accepted, carrying payment_deadline", {
      method: "PATCH", path: `/sessions?id=eq.${row1.id}`, headers: userHeaders(env, teacher.token),
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
      method: "PATCH", path: `/sessions?id=eq.${row1.id}&status=eq.active`, headers: userHeaders(env, teacher.token),
      body: { status: "completed" },
    });

    // ---- Row 2: accepted -> paid -> refunded ----
    console.log("\nRow 2 — paid, then refunded:");
    const row2 = await seedPending("Physics");
    seededIds.push(row2.id);

    await write("teacher's pending -> accepted (row 2)", {
      method: "PATCH", path: `/sessions?id=eq.${row2.id}`, headers: userHeaders(env, teacher.token),
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

    // ---- Row 4 (driven before row 3, which has to wait on a real clock):
    // the student backs out of the payment window. Spec §3.1's table lists
    // `accepted -> cancelled | student`, and the trigger gates it on
    // `uid is distinct from old.student_id` with no service-role escape —
    // this is the one legitimate M3 write only a real student JWT can prove.
    // NOTE: no app code currently makes this write (cancelSession filters on
    // status = 'pending' and the waiting screen hides Cancel once accepted).
    // This asserts the database contract the spec states, not a path the UI
    // reaches today. See the M3 spec's known-gaps section. ----
    console.log("\nRow 4 — the student backs out of the payment window:");
    const row4 = await seedPending("Biology");
    seededIds.push(row4.id);

    await write("teacher's pending -> accepted (row 4)", {
      method: "PATCH", path: `/sessions?id=eq.${row4.id}`, headers: userHeaders(env, teacher.token),
      body: { status: "accepted", payment_deadline: new Date(Date.now() + 90_000).toISOString() },
    });

    const ref4 = ref("checkout");
    await write("checkout was already created before they backed out (row 4, service role)", {
      method: "PATCH", path: `/sessions?id=eq.${row4.id}&status=eq.accepted&payment_ref=is.null`, headers: SERVICE_REPR,
      body: { payment_ref: ref4, payment_provider: "stub", payment_checkout_url: `https://pay.example/${ref4}` },
    });

    await write("accepted -> cancelled BY THE STUDENT, with their own token", {
      method: "PATCH", path: `/sessions?id=eq.${row4.id}&status=eq.accepted`, headers: userHeaders(env, student.token),
      body: { status: "cancelled" },
    });

    // ---- Row 3: accepted -> payment_expired, then a late webhook pays it out ----
    // Kicked off before the async work below finishes so the 60s minimum
    // payment_deadline has real time to elapse while this script does other
    // work, rather than the script blocking on a bare sleep.
    console.log("\nRow 3 — payment window expires, then a late success webhook arrives:");
    const row3 = await seedPending("Chemistry");
    seededIds.push(row3.id);
    const paymentDeadline3 = new Date(Date.now() + 61_000).toISOString(); // minimum allowed window

    await write("teacher's pending -> accepted (row 3)", {
      method: "PATCH", path: `/sessions?id=eq.${row3.id}`, headers: userHeaders(env, teacher.token),
      body: { status: "accepted", payment_deadline: paymentDeadline3 },
    });
    const ref3 = ref("checkout");
    await write("checkout was created before the window expired (row 3, service role)", {
      method: "PATCH", path: `/sessions?id=eq.${row3.id}&status=eq.accepted&payment_ref=is.null`, headers: SERVICE_REPR,
      body: { payment_ref: ref3, payment_provider: "stub", payment_checkout_url: `https://pay.example/${ref3}` },
    });

    // ---- Malformed inserts: the trigger is not role-gated, so even the
    // service role must be refused here. Run while row 3's clock runs down. ----
    console.log("\nMalformed inserts (must be refused even under the service role):");
    const base = {
      student_id: student.id, teacher_id: teacher.id, curriculum: "CBSE", grade: "10th",
      stream: "Science", subject: "Mathematics", type: "instant",
    };

    // This section exists to catch a regression where one of these STOPS
    // failing — and in exactly that case the created row would otherwise be
    // left behind in the live table, permanently carrying forged or inflated
    // data and poisoning the row-count baseline for every later probe run and
    // for reconcile-payments. So capture the id into the cleanup list FIRST,
    // then report. The verdict still fails the run; it just no longer leaks.
    const malformedInsert = async (label, body) => {
      const res = await fetch(`${URL}/rest/v1/sessions`, {
        method: "POST", headers: jsonHeaders(SERVICE_REPR), body: JSON.stringify(body),
      });
      let rows = [];
      try { rows = await res.json(); } catch { /* no body */ }
      if (res.ok) {
        for (const r of Array.isArray(rows) ? rows : [rows]) {
          if (r?.id) seededIds.push(r.id);
        }
      }
      refused(!res.ok, label);
      if (res.ok) console.error("      a malformed row was created (queued for cleanup):", rows);
    };

    await malformedInsert("inflated hourly_rate (99999, teacher's actual rate is 500)", {
      ...base, status: "pending", accept_deadline: new Date(Date.now() + 30_000).toISOString(), hourly_rate: 99_999,
    });
    await malformedInsert("a row arriving already ACTIVE", {
      ...base, status: "active", hourly_rate: HOURLY_RATE,
      started_at: new Date().toISOString(), daily_room_url: "https://daily.example/forged",
    });
    await malformedInsert("a self-granted hour-long accept window", {
      ...base, status: "pending", accept_deadline: new Date(Date.now() + 3_600_000).toISOString(), hourly_rate: HOURLY_RATE,
    });
    await malformedInsert("a request arriving with payment data already on it", {
      ...base, status: "pending", accept_deadline: new Date(Date.now() + 30_000).toISOString(),
      hourly_rate: HOURLY_RATE, amount_paid_paise: AMOUNT_PAISE, payment_ref: ref("forged"),
    });

    console.log("\nRow 3, continued:");
    const remainingMs = new Date(paymentDeadline3).getTime() - Date.now() + 1_000;
    if (remainingMs > 0) {
      console.log(`  (waiting ${Math.ceil(remainingMs / 1000)}s for row 3's payment_deadline to actually pass — Postgres now(), not this script's clock, is the authority)`);
      await sleep(remainingMs);
    }

    await write("accepted -> payment_expired after its deadline (teacher settles on read, as acceptSession does)", {
      method: "PATCH", path: `/sessions?id=eq.${row3.id}&status=eq.accepted`, headers: userHeaders(env, teacher.token),
      body: { status: "payment_expired" },
    });

    await write("late success webhook: row KEEPS its status, gains amount_paid_paise + refund_ref (service role)", {
      method: "PATCH", path: `/sessions?id=eq.${row3.id}&status=eq.payment_expired`, headers: SERVICE_REPR,
      body: { amount_paid_paise: AMOUNT_PAISE, refund_ref: ref("late_refund"), payment_provider: "stub" },
    });
  } finally {
    for (const id of seededIds) {
      await fetch(`${URL}/rest/v1/sessions?id=eq.${id}`, { method: "DELETE", headers: SERVICE });
    }
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
