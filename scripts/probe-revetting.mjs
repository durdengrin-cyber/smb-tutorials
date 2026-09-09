#!/usr/bin/env node
// Migration 0023 — re-vetting when the vetted artefact changes.
//
// THE HOLE THIS PROVES CLOSED. The operator approves a teacher by watching
// their demo video. Until 0023 that video was editable afterwards with nothing
// re-checking it: clear a teacher, let them paste a different link, and
// students are shown a video nobody approved while vetting_state still reads
// 'cleared'.
//
// WHAT THIS PROBE CANNOT DO, stated up front because it is the most important
// assertion and it is NOT here. Driving a teacher to 'cleared' requires
// set_vetting_state, which requires an admin, and this probe cannot mint one:
// handle_new_user() coerces every role that is not 'teacher' to 'student'
// (checked against production on 2026-09-09), so a throwaway admin cannot be
// created over REST. The same limit is recorded in probe-vetting.mjs.
//
// So the positive path — cleared, video changed, back to unvetted, gone from
// the roster — is a MANUAL check, and it takes half a minute:
//
//   1. /admin, Clear "Task13 Tutor Verify" (a test account, not a real tutor).
//   2. Sign in as them, /profile, change the demo video link, Save.
//   3. /admin again: they read 'unvetted' and the "live" badge is gone.
//   4. Their teacher_vetting row still holds the original vetted_at/vetted_by.
//
// What IS covered here is everything reachable without an admin, including the
// case 0023 newly makes strict: a teacher who tries to change the video AND
// their own vetting_state in one PATCH is refused outright rather than quietly
// downgraded.
//
// Usage: node scripts/probe-revetting.mjs
import {
  readEnv, jsonHeaders, serviceHeaders, userHeaders,
  createThrowawayUser, deleteThrowawayUser, profileCount,
} from "./probe-accounts.mjs";

const env = readEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;

let failures = 0;
const ok = (pass, label) => {
  console.log(`  ${pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${label}`);
  if (!pass) failures++;
};

const VIDEO_A = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const VIDEO_B = "https://www.youtube.com/watch?v=aaaaaaaaaaa";

const before = await profileCount(env);
const created = [];

try {
  const teacher = await createThrowawayUser(env, {
    role: "teacher", fullName: "Re-vetting Probe", hourlyRate: 500,
  });
  created.push(teacher.id);
  const TH = userHeaders(env, teacher.token);
  const SVC = serviceHeaders(env);

  const stateOf = async () =>
    fetch(`${URL}/rest/v1/profiles?id=eq.${teacher.id}&select=vetting_state,demo_video_url`,
          { headers: SVC }).then((r) => r.json()).then((r) => r[0] ?? {});

  await fetch(`${URL}/rest/v1/profiles?id=eq.${teacher.id}`, {
    method: "PATCH", headers: jsonHeaders(SVC),
    body: JSON.stringify({ demo_video_url: VIDEO_A }),
  });

  // ---- 1. The ordinary edit still works ----------------------------------
  // The whole risk of a forced reset is that it breaks the normal path. An
  // unvetted teacher changing their video must simply succeed: there is
  // nothing to reset, and the trigger must not raise.
  const edit = await fetch(`${URL}/rest/v1/profiles?id=eq.${teacher.id}`, {
    method: "PATCH", headers: jsonHeaders(TH),
    body: JSON.stringify({ demo_video_url: VIDEO_B }),
  });
  const afterEdit = await stateOf();
  ok(edit.ok && afterEdit.demo_video_url === VIDEO_B && afterEdit.vetting_state === "unvetted",
     `an unvetted teacher can still change their demo video (HTTP ${edit.status}, state ${afterEdit.vetting_state})`);

  // ---- 2. An unrelated edit does not touch vetting ------------------------
  // IS DISTINCT FROM, not a blanket "profile changed": a teacher editing their
  // rate must not be knocked off the roster by a URL that did not move.
  const rate = await fetch(`${URL}/rest/v1/profiles?id=eq.${teacher.id}`, {
    method: "PATCH", headers: jsonHeaders(TH),
    body: JSON.stringify({ hourly_rate: 650 }),
  });
  const afterRate = await stateOf();
  ok(rate.ok && afterRate.vetting_state === "unvetted" && afterRate.demo_video_url === VIDEO_B,
     "changing only the rate leaves the demo video and the vetting state alone");

  // ---- 3. Re-saving the SAME url is not a change --------------------------
  const same = await fetch(`${URL}/rest/v1/profiles?id=eq.${teacher.id}`, {
    method: "PATCH", headers: jsonHeaders(TH),
    body: JSON.stringify({ demo_video_url: VIDEO_B }),
  });
  ok(same.ok && (await stateOf()).vetting_state === "unvetted",
     "re-saving the identical demo video link is accepted and changes nothing");

  // ---- 4. THE GATE IS STILL SHUT -----------------------------------------
  // 0021's property, re-proved because 0023 rewrote the function that enforces
  // it. If this fails, a teacher can clear themselves and 0023 broke the thing
  // it was extending.
  const selfClear = await fetch(`${URL}/rest/v1/profiles?id=eq.${teacher.id}`, {
    method: "PATCH", headers: jsonHeaders(TH),
    body: JSON.stringify({ vetting_state: "cleared" }),
  });
  ok(!selfClear.ok && (await stateOf()).vetting_state === "unvetted",
     `a teacher still cannot PATCH their own vetting_state (HTTP ${selfClear.status})`);

  // ---- 5. NEW IN 0023: the two cannot be smuggled together ---------------
  // The reset assigns to new.vetting_state, so a naive implementation would
  // let this PATCH through and silently downgrade it to 'unvetted' — telling
  // the caller nothing about the attempt. 0023 judges the CALLER's attempted
  // value, so this is refused outright.
  const combined = await fetch(`${URL}/rest/v1/profiles?id=eq.${teacher.id}`, {
    method: "PATCH", headers: jsonHeaders(TH),
    body: JSON.stringify({ demo_video_url: VIDEO_A, vetting_state: "cleared" }),
  });
  const afterCombined = await stateOf();
  ok(!combined.ok && afterCombined.vetting_state === "unvetted" && afterCombined.demo_video_url === VIDEO_B,
     `a video change cannot carry a vetting_state change with it (HTTP ${combined.status}, video unchanged)`);

  // ---- 6. The service role is not a way around it either ------------------
  const svcClear = await fetch(`${URL}/rest/v1/profiles?id=eq.${teacher.id}`, {
    method: "PATCH", headers: jsonHeaders(SVC),
    body: JSON.stringify({ vetting_state: "cleared" }),
  });
  ok(!svcClear.ok && (await stateOf()).vetting_state === "unvetted",
     `even the service role must go through set_vetting_state (HTTP ${svcClear.status})`);
} finally {
  for (const id of created) await deleteThrowawayUser(env, id);
  const after = await profileCount(env);
  ok(after === before, `no throwaway rows left behind (${before} -> ${after})`);
}

console.log(
  failures === 0
    ? "\n\x1b[32mAll re-vetting assertions passed.\x1b[0m Positive path is the manual check in this file's header.\n"
    : `\n\x1b[31m${failures} assertion(s) failed.\x1b[0m\n`
);
process.exit(failures === 0 ? 0 : 1);
