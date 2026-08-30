#!/usr/bin/env node
// Cycle 2's security probe. teacher_availability and teacher_devices are new
// attack surface, and one of them holds capabilities: a push endpoint is not
// data, it is the ability to wake someone's phone. The single most important
// assertion in this file is that a student cannot read another teacher's
// device row.
//
// Usage: node scripts/probe-availability.mjs
import {
  readEnv, jsonHeaders, serviceHeaders, serviceRepr, userHeaders,
  createThrowawayUser, deleteThrowawayUser, profileCount,
} from "./probe-accounts.mjs";

const env = readEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = serviceHeaders(env);

let failures = 0;
const permitted = (ok, label) => {
  console.log(`  ${ok ? "\x1b[32mPERMITTED\x1b[0m" : "\x1b[31mREFUSED  \x1b[0m"}  ${label}`);
  if (!ok) failures++;
};
const refused = (ok, label) => {
  console.log(`  ${ok ? "\x1b[32mREFUSED  \x1b[0m" : "\x1b[31mPERMITTED\x1b[0m"}  ${label}`);
  if (!ok) failures++;
};

async function availabilityCount() {
  const res = await fetch(`${URL}/rest/v1/teacher_availability?select=teacher_id`, { headers: SERVICE });
  return (await res.json()).length;
}

async function deviceCount() {
  const res = await fetch(`${URL}/rest/v1/teacher_devices?select=id`, { headers: SERVICE });
  return (await res.json()).length;
}

async function main() {
  const baselineProfiles = await profileCount(env);
  const baselineAvailability = await availabilityCount();
  const baselineDevices = await deviceCount();

  // hourlyRate is not optional in practice: probe-accounts.mjs:81-84 records
  // that the session insert trigger refuses a teacher whose rate is null, and
  // Task 6's assertions seed real sessions for this teacher.
  const teacher = await createThrowawayUser(env, {
    role: "teacher", fullName: "Probe Teacher", hourlyRate: 500,
  });
  const student = await createThrowawayUser(env, {
    role: "student", fullName: "Probe Student",
  });

  try {
    console.log("\nteacher_availability — the declaration");

    // A teacher declares for themselves.
    let res = await fetch(`${URL}/rest/v1/teacher_availability`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, teacher.token)),
      body: JSON.stringify({
        teacher_id: teacher.id,
        declared: true,
        declared_at: new Date().toISOString(),
        declared_until: new Date(Date.now() + 4 * 3600_000).toISOString(),
      }),
    });
    permitted(res.ok, "teacher declares their own availability");

    // A teacher must not declare on someone else's behalf.
    res = await fetch(`${URL}/rest/v1/teacher_availability`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, student.token)),
      body: JSON.stringify({
        teacher_id: teacher.id,
        declared: true,
        declared_until: new Date(Date.now() + 4 * 3600_000).toISOString(),
      }),
    });
    refused(!res.ok, "student forges a declaration for a teacher");

    // A student cannot park a declaration on their own row either: the list
    // only reads teacher profiles, but a stray row is still junk in a table
    // whose whole point is to be authoritative.
    res = await fetch(`${URL}/rest/v1/teacher_availability`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, student.token)),
      body: JSON.stringify({
        teacher_id: student.id,
        declared: true,
        declared_until: new Date(Date.now() + 4 * 3600_000).toISOString(),
      }),
    });
    refused(!res.ok, "student declares availability for themselves");

    // A student must not be able to switch a teacher off.
    res = await fetch(
      `${URL}/rest/v1/teacher_availability?teacher_id=eq.${teacher.id}`,
      {
        method: "PATCH",
        headers: jsonHeaders(userHeaders(env, student.token)),
        body: JSON.stringify({ declared: false }),
      }
    );
    const after = await fetch(
      `${URL}/rest/v1/teacher_availability?teacher_id=eq.${teacher.id}&select=declared`,
      { headers: SERVICE }
    ).then((r) => r.json());
    refused(after[0]?.declared === true, "student switches a teacher offline");

    // Availability is not secret — the roster has to read it.
    res = await fetch(
      `${URL}/rest/v1/teacher_availability?teacher_id=eq.${teacher.id}&select=declared`,
      { headers: userHeaders(env, student.token) }
    );
    permitted(res.ok && (await res.json()).length === 1, "student reads a declaration");

    console.log("\nteacher_devices — endpoints are capabilities, not data");

    // Register through the RPC, the way the app does.
    res = await fetch(`${URL}/rest/v1/rpc/register_device`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, teacher.token)),
      body: JSON.stringify({
        p_endpoint: `https://push.example.test/${teacher.id}`,
        p_p256dh: "probe-p256dh",
        p_auth: "probe-auth",
        p_user_agent: "probe",
      }),
    });
    permitted(res.ok, "teacher registers their own device");

    // THE assertion. A push endpoint is the ability to wake someone's phone.
    // If a student can read this row, they can spam a teacher's device.
    res = await fetch(
      `${URL}/rest/v1/teacher_devices?teacher_id=eq.${teacher.id}&select=endpoint`,
      { headers: userHeaders(env, student.token) }
    );
    const leaked = res.ok ? await res.json() : [];
    refused(leaked.length === 0, "student reads a teacher's push endpoint");

    // The owner must still be able to read their own.
    res = await fetch(
      `${URL}/rest/v1/teacher_devices?teacher_id=eq.${teacher.id}&select=endpoint`,
      { headers: userHeaders(env, teacher.token) }
    );
    permitted(res.ok && (await res.json()).length === 1, "teacher reads their own device");

    // A student must not be able to insert a row pointing at their own
    // endpoint under a teacher's id, which would redirect that teacher's
    // requests to the student's phone.
    res = await fetch(`${URL}/rest/v1/teacher_devices`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, student.token)),
      body: JSON.stringify({
        teacher_id: teacher.id,
        transport: "webpush",
        endpoint: "https://push.example.test/hijack",
        p256dh: "x",
        auth: "y",
      }),
    });
    refused(!res.ok, "student inserts a device row for a teacher");

    // A student must not be able to park a device row on their own id
    // either. RLS alone permits this (auth.uid() = teacher_id is satisfied);
    // only the 0009 guard trigger, mirroring teacher_availability's, catches
    // a non-teacher profile.
    res = await fetch(`${URL}/rest/v1/teacher_devices`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, student.token)),
      body: JSON.stringify({
        teacher_id: student.id,
        transport: "webpush",
        endpoint: "https://push.example.test/self",
        p256dh: "x",
        auth: "y",
      }),
    });
    refused(!res.ok, "student inserts a device row for themselves");

    // Re-registering the same endpoint updates rather than duplicating.
    await fetch(`${URL}/rest/v1/rpc/register_device`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, teacher.token)),
      body: JSON.stringify({
        p_endpoint: `https://push.example.test/${teacher.id}`,
        p_p256dh: "probe-p256dh",
        p_auth: "probe-auth",
        p_user_agent: "probe-2",
      }),
    });
    const rows = await fetch(
      `${URL}/rest/v1/teacher_devices?teacher_id=eq.${teacher.id}&select=id`,
      { headers: SERVICE }
    ).then((r) => r.json());
    permitted(rows.length === 1, "re-registering the same endpoint does not duplicate");

    console.log("\navailable_teachers — the roster read");

    const taxonomy = {
      p_curriculum: "CBSE", p_grade: "10th", p_stream: "Science", p_subject: "Mathematics",
    };
    await fetch(`${URL}/rest/v1/teacher_subjects`, {
      method: "POST", headers: jsonHeaders(SERVICE),
      body: JSON.stringify({
        teacher_id: teacher.id, curriculum: "CBSE", grade: "10th",
        stream: "Science", subject: "Mathematics",
      }),
    });

    const roster = async () =>
      fetch(`${URL}/rest/v1/rpc/available_teachers`, {
        method: "POST",
        headers: jsonHeaders(userHeaders(env, student.token)),
        body: JSON.stringify(taxonomy),
      }).then((r) => r.json());

    let rosterRows = await roster();
    const mine = rosterRows.find((r) => r.teacher_id === teacher.id);
    permitted(Boolean(mine), "a declared teacher is returned");

    // An unfiltered browse must NOT come back empty: /teachers renders with
    // no criteria on a legitimate path, and a strict match would show a
    // student nothing while teachers sat available.
    const unfiltered = await fetch(`${URL}/rest/v1/rpc/available_teachers`, {
      method: "POST",
      headers: jsonHeaders(userHeaders(env, student.token)),
      body: JSON.stringify({ p_curriculum: null, p_grade: null, p_stream: null, p_subject: null }),
    }).then((r) => r.json());
    permitted(
      unfiltered.some((r) => r.teacher_id === teacher.id),
      "an unfiltered browse still returns a declared teacher"
    );

    // The defect this cycle's review caught: the RPC must PUBLISH
    // reachability, not APPLY it. A teacher who declared, has the dashboard
    // open and declined notifications is reachable RIGHT NOW — excluding
    // them here would refuse work to someone able to take it.
    permitted(mine?.has_device === true, "has_device is true once a device is registered");

    await fetch(`${URL}/rest/v1/teacher_devices?teacher_id=eq.${teacher.id}`, {
      method: "DELETE", headers: SERVICE,
    });
    rosterRows = await roster();
    const noDevice = rosterRows.find((r) => r.teacher_id === teacher.id);
    permitted(Boolean(noDevice), "a declared teacher with NO device is still returned");
    permitted(noDevice?.has_device === false, "…carrying has_device = false");

    // No endpoint may ever appear in this result, whatever columns are added
    // later.
    refused(
      !Object.keys(noDevice ?? {}).some((k) => /endpoint|p256dh|auth/.test(k)),
      "the roster result carries a subscription column"
    );

    // In-session exclusion, one status at a time, against hasOpenRequest.
    //
    // A session can only ever be INSERTED as pending — migration 0003's
    // enforce_session_insert trigger raises on any other starting status —
    // so the two pending cases seed directly. The accepted cases cannot: they
    // must be driven through the real pending -> accepted transition, by the
    // TEACHER's own token (0005's enforce_session_update: "only the teacher
    // may answer a request", uid is null under the service role), carrying a
    // payment_deadline inside 0005's 60..180s legal window at transition
    // time. Same pattern as probe-happy-path.mjs's "teacher's pending ->
    // accepted, carrying payment_deadline".
    const seedPending = async (patch) => {
      const res = await fetch(`${URL}/rest/v1/sessions`, {
        method: "POST", headers: jsonHeaders(serviceRepr(env)),
        body: JSON.stringify({
          student_id: student.id, teacher_id: teacher.id,
          curriculum: "CBSE", grade: "10th", stream: "Science",
          subject: "Mathematics", type: "instant", hourly_rate: 500,
          duration_minutes: 60, status: "pending", ...patch,
        }),
      });
      return (await res.json())[0];
    };
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();

    // Nothing forbids accepting after accept_deadline has passed — 0005's
    // deadline rule governs the `timed_out` transition only, the read-time
    // expiry rule lives in TypeScript — so a past accept_deadline on a
    // pending insert is legal in every case below.
    for (const [label, accept_deadline, expectListed] of [
      ["pending, deadline ahead", future, false],
      ["pending, deadline passed", past, true],
    ]) {
      const row = await seedPending({ accept_deadline });
      const listed = (await roster()).some((r) => r.teacher_id === teacher.id);
      permitted(listed === expectListed, `${label} -> ${expectListed ? "listed" : "hidden"}`);
      await fetch(`${URL}/rest/v1/sessions?id=eq.${row.id}`, { method: "DELETE", headers: SERVICE });
    }

    // The accepted cases, on ONE row driven through the real lifecycle,
    // rather than two independently-seeded rows: proving the exclusion
    // RELEASES on the same row is the stronger property this cycle actually
    // depends on — a busy teacher must become bookable again, not merely be
    // excluded while busy.
    const acceptedRow = await seedPending({ accept_deadline: past });
    const paymentDeadline = new Date(Date.now() + 65_000).toISOString();
    const acceptRes = await fetch(`${URL}/rest/v1/sessions?id=eq.${acceptedRow.id}`, {
      method: "PATCH",
      headers: jsonHeaders(userHeaders(env, teacher.token)),
      body: JSON.stringify({ status: "accepted", payment_deadline: paymentDeadline }),
    });
    if (!acceptRes.ok) {
      console.error("  accept transition failed:", acceptRes.status, await acceptRes.text());
    }
    permitted(acceptRes.ok, "teacher accepts, seeding the accepted row for the parity check");

    const listedWhileOpen = (await roster()).some((r) => r.teacher_id === teacher.id);
    permitted(listedWhileOpen === false, "accepted, window open -> hidden");

    // Waiting on a real Postgres deadline rather than mocking a clock —
    // this project's established practice for the same reason
    // probe-happy-path.mjs runs ~70s: available_teachers reads now() inside
    // Postgres itself, so nothing short of the wall clock actually passing
    // proves the release. Deliberate, not a stall.
    const waitMs = new Date(paymentDeadline).getTime() - Date.now() + 2_000;
    await new Promise((r) => setTimeout(r, Math.max(0, waitMs)));

    const listedAfterLapse = (await roster()).some((r) => r.teacher_id === teacher.id);
    permitted(listedAfterLapse === true, "accepted, window lapsed -> listed");

    await fetch(`${URL}/rest/v1/sessions?id=eq.${acceptedRow.id}`, { method: "DELETE", headers: SERVICE });
  } finally {
    await fetch(`${URL}/rest/v1/sessions?teacher_id=eq.${teacher.id}`, {
      method: "DELETE", headers: SERVICE,
    });
    await fetch(`${URL}/rest/v1/teacher_subjects?teacher_id=eq.${teacher.id}`, {
      method: "DELETE", headers: SERVICE,
    });
    await fetch(`${URL}/rest/v1/teacher_devices?teacher_id=eq.${teacher.id}`, {
      method: "DELETE", headers: SERVICE,
    });
    await fetch(`${URL}/rest/v1/teacher_availability?teacher_id=eq.${teacher.id}`, {
      method: "DELETE", headers: SERVICE,
    });
    await deleteThrowawayUser(env, teacher.id);
    await deleteThrowawayUser(env, student.id);
  }

  const endProfiles = await profileCount(env);
  const endAvailability = await availabilityCount();
  const endDevices = await deviceCount();
  console.log("\ncleanup");
  console.log(`  profiles ${baselineProfiles} -> ${endProfiles}`);
  console.log(`  teacher_availability ${baselineAvailability} -> ${endAvailability}`);
  console.log(`  teacher_devices ${baselineDevices} -> ${endDevices}`);
  if (endProfiles !== baselineProfiles) failures++;
  if (endAvailability !== baselineAvailability) failures++;
  if (endDevices !== baselineDevices) failures++;

  console.log(failures === 0 ? "\n\x1b[32mALL CLEAR\x1b[0m" : `\n\x1b[31m${failures} FAILURE(S)\x1b[0m`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
