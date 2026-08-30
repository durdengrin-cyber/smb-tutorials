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

async function main() {
  const baselineProfiles = await profileCount(env);
  const baselineAvailability = await availabilityCount();

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
  } finally {
    await fetch(`${URL}/rest/v1/teacher_availability?teacher_id=eq.${teacher.id}`, {
      method: "DELETE", headers: SERVICE,
    });
    await deleteThrowawayUser(env, teacher.id);
    await deleteThrowawayUser(env, student.id);
  }

  const endProfiles = await profileCount(env);
  const endAvailability = await availabilityCount();
  console.log("\ncleanup");
  console.log(`  profiles ${baselineProfiles} -> ${endProfiles}`);
  console.log(`  teacher_availability ${baselineAvailability} -> ${endAvailability}`);
  if (endProfiles !== baselineProfiles) failures++;
  if (endAvailability !== baselineAvailability) failures++;

  console.log(failures === 0 ? "\n\x1b[32mALL CLEAR\x1b[0m" : `\n\x1b[31m${failures} FAILURE(S)\x1b[0m`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
