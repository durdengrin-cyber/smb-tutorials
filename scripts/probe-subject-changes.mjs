#!/usr/bin/env node
// Migration 0027 — subjects stop being self-service.
//
// THE HOLE THIS PROVES CLOSED. A teacher was cleared to teach the subjects an
// admin watched them demonstrate. Before 0027 they could add another with one
// PATCH and be picked for it by a student the same minute — no video, no
// review, still 'cleared'. Assertions 1 and 2 are that PATCH and that DELETE.
//
// WHAT THIS CANNOT PROVE, stated up front. Approving a request needs an admin,
// and handle_new_user() coerces every role that is not 'teacher' to 'student',
// so no throwaway admin can be minted over REST — the same limit recorded in
// probe-vetting.mjs and probe-revetting.mjs. The approval path is a manual
// check:
//
//   1. As a teacher: /profile -> Request a change -> pick a subject, paste a
//      YouTube link, send.
//   2. As admin: /admin shows it above the roster. Watch the video, Approve.
//   3. The teacher's subjects are replaced, the new video is their demo video,
//      and they read 'cleared' — without a second trip through the queue.
//
// Usage: node scripts/probe-subject-changes.mjs
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

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const before = await profileCount(env);
const created = [];

try {
  const teacher = await createThrowawayUser(env, {
    role: "teacher", fullName: "Subject Change Probe", hourlyRate: 500,
  });
  created.push(teacher.id);
  const TH = userHeaders(env, teacher.token);
  const SVC = serviceHeaders(env);

  const subjectCount = async () =>
    fetch(`${URL}/rest/v1/teacher_subjects?teacher_id=eq.${teacher.id}&select=subject`,
          { headers: SVC }).then((r) => r.json()).then((r) => r.length);

  const rpc = (name, body, headers) =>
    fetch(`${URL}/rest/v1/rpc/${name}`, {
      method: "POST", headers: jsonHeaders(headers), body: JSON.stringify(body),
    });

  // ---- 1. set_initial_subjects is the ONE way in, and only once ----------
  const first = await rpc("set_initial_subjects", {
    p_subjects: [{ curriculum: "CBSE", grade: "10th", stream: "Science", subject: "Physics" }],
  }, TH);
  ok(first.ok && (await subjectCount()) === 1,
     `a new teacher can set their subjects once (HTTP ${first.status})`);

  const second = await rpc("set_initial_subjects", {
    p_subjects: [{ curriculum: "CBSE", grade: "12th", stream: "Science", subject: "Mathematics" }],
  }, TH);
  ok(!second.ok && (await subjectCount()) === 1,
     `...and cannot call it again to slip a second subject in (HTTP ${second.status})`);

  // ---- 2. THE LOCKDOWN ---------------------------------------------------
  // The PATCH that used to work. If this passes, a teacher can claim to teach
  // anything, be picked for it, and nothing here matters.
  const sneak = await fetch(`${URL}/rest/v1/teacher_subjects`, {
    method: "POST", headers: jsonHeaders(TH),
    body: JSON.stringify({
      teacher_id: teacher.id, curriculum: "CBSE",
      grade: "12th", stream: "Science", subject: "Mathematics",
    }),
  });
  ok(!sneak.ok && (await subjectCount()) === 1,
     `a teacher cannot INSERT a subject directly (HTTP ${sneak.status})`);

  const wipe = await fetch(
    `${URL}/rest/v1/teacher_subjects?teacher_id=eq.${teacher.id}`,
    { method: "DELETE", headers: TH }
  );
  ok((await subjectCount()) === 1,
     `a teacher cannot DELETE their subjects directly (HTTP ${wipe.status})`);

  // ---- 3. A request needs a video ---------------------------------------
  const noVideo = await rpc("request_subject_change", {
    p_subjects: [{ curriculum: "CBSE", grade: "12th", stream: "Science", subject: "Mathematics" }],
    p_demo_video_url: "   ",
  }, TH);
  ok(!noVideo.ok,
     `a request without a demo video is refused (HTTP ${noVideo.status})`);

  const asked = await rpc("request_subject_change", {
    p_subjects: [{ curriculum: "CBSE", grade: "12th", stream: "Science", subject: "Mathematics" }],
    p_demo_video_url: VIDEO,
  }, TH);
  ok(asked.ok, `a request with a video is accepted (HTTP ${asked.status})`);

  // Asking does not change anything yet — that is the whole point.
  ok((await subjectCount()) === 1,
     "asking does NOT change the subjects; only an approval does");

  const twice = await rpc("request_subject_change", {
    p_subjects: [{ curriculum: "CBSE", grade: "11th", stream: "Science", subject: "Chemistry" }],
    p_demo_video_url: VIDEO,
  }, TH);
  ok(!twice.ok,
     `a second open request is refused (HTTP ${twice.status})`);

  // ---- 4. Only an admin decides -----------------------------------------
  const reqRow = await fetch(
    `${URL}/rest/v1/subject_change_requests?teacher_id=eq.${teacher.id}&select=id`,
    { headers: SVC }
  ).then((r) => r.json());

  const selfApprove = await rpc("decide_subject_change", {
    p_request_id: reqRow[0]?.id, p_approve: true, p_note: "me",
  }, TH);
  ok(!selfApprove.ok && (await subjectCount()) === 1,
     `a teacher cannot approve their own request (HTTP ${selfApprove.status})`);

  // ---- 5. The request is not readable by another teacher ----------------
  const other = await createThrowawayUser(env, {
    role: "teacher", fullName: "Other Teacher", hourlyRate: 400,
  });
  created.push(other.id);
  const seen = await fetch(
    `${URL}/rest/v1/subject_change_requests?select=id`,
    { headers: userHeaders(env, other.token) }
  ).then((r) => r.json());
  ok(Array.isArray(seen) && seen.length === 0,
     "another teacher sees none of it");
} finally {
  for (const id of created) await deleteThrowawayUser(env, id);
  const after = await profileCount(env);
  ok(after === before, `no throwaway rows left behind (${before} -> ${after})`);
}

console.log(
  failures === 0
    ? "\n\x1b[32mAll subject-change assertions passed.\x1b[0m Approval is the manual check in this file's header.\n"
    : `\n\x1b[31m${failures} assertion(s) failed.\x1b[0m\n`
);
process.exit(failures === 0 ? 0 : 1);
