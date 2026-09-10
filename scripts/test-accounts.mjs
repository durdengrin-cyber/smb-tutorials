#!/usr/bin/env node
// The three burner accounts, one per role, that let an agent test without the
// owner at the keyboard.
//
// WHY THIS EXISTS AS A SCRIPT AND NOT A TRANSCRIPT: no password for these ever
// needs to exist anywhere a human or a log can see it. Each is created with a
// random password that is generated here, used for nothing, and never printed.
// Signing in is done with `signin`, which mints a one-time service-role link —
// so there is no standing credential to leak, paste or rotate.
//
// WHY A HUMAN RUNS `setup`: it escalates one profile to admin and sets another
// to `cleared`. Both are privileged writes to the production database, and
// Claude Code's permission classifier refuses them from the agent, deliberately
// (CLAUDE.md, "Database migrations — use the CLI, never paste": the agent
// prepares and verifies, a human applies). Run it yourself:
//
//   node scripts/test-accounts.mjs setup
//   node scripts/test-accounts.mjs signin teacher     # prints a sign-in URL
//   node scripts/test-accounts.mjs status
//   node scripts/test-accounts.mjs delete             # before launch
//
// THESE MUST NOT SURVIVE TO LAUNCH. `npm run test` fails while they exist and
// SMB_LAUNCH_READY=1 is set — see src/lib/test-accounts.test.ts. That is the
// enforcer; this comment is not.
import crypto from "node:crypto";
import { readEnv, serviceHeaders } from "./probe-accounts.mjs";

const env = readEnv();
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const AUTH = serviceHeaders(env);
const JSON_HEADERS = { ...AUTH, "Content-Type": "application/json" };

/** The prefix is the contract: anything matching it is disposable. */
export const TEST_ACCOUNT_PREFIX = "smb-test-";

// Deliberately the SUPERSEDED consent version. It is the state every real
// account is in, and it is what exercises the 2026-09-10 consent-gate fixes:
// the re-consent notice, the prefilled learner fields, and the dashboard
// redirect on a refused renewal. Consenting once in the app moves them on.
const STALE_CONSENT = "2026-09-05-guardian";

const ACCOUNTS = {
  student: {
    email: `${TEST_ACCOUNT_PREFIX}student@example.com`,
    metadata: {
      role: "student",
      full_name: "Test Student Guardian",
      learner_first_name: "Testy",
      learner_grade: "9th",
    },
    profile: {},
  },
  teacher: {
    email: `${TEST_ACCOUNT_PREFIX}teacher@example.com`,
    metadata: { role: "teacher", full_name: "Test Teacher" },
    // A completable profile: the editor rejects a save missing any required
    // field, and a change to ANY field is what 0024 re-vets on.
    profile: {
      phone: "+919999900001",
      qualification: "M.Sc. Mathematics",
      experience_years: 5,
      specialization: "Algebra",
      teaching_level: "Secondary",
      hourly_rate: 500,
      hours_per_week: 10,
      bio: "Burner account for automated testing.",
      demo_video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    },
  },
  admin: {
    // handle_new_user coerces every role that is not "teacher" to "student"
    // (0001), so admin is unreachable through any signup path by design and
    // has to be set afterwards.
    email: `${TEST_ACCOUNT_PREFIX}admin@example.com`,
    metadata: { role: "admin", full_name: "Test Admin" },
    profile: { role: "admin" },
  },
};

async function findUser(email) {
  const r = await fetch(
    `${URL_}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    { headers: AUTH }
  );
  const j = await r.json();
  return (j.users ?? []).find((u) => u.email === email) ?? null;
}

async function patchProfile(email, body) {
  const r = await fetch(
    `${URL_}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`,
    { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) }
  );
  if (!r.ok) throw new Error(`patch ${email}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function setup() {
  for (const [role, acct] of Object.entries(ACCOUNTS)) {
    let user = await findUser(acct.email);
    if (user) {
      console.log(`${role}: exists (${user.id})`);
    } else {
      const r = await fetch(`${URL_}/auth/v1/admin/users`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          email: acct.email,
          // Generated, used for nothing, never printed. `signin` is the way in.
          password: crypto.randomUUID() + "aA1!",
          email_confirm: true,
          user_metadata: {
            ...acct.metadata,
            consent_accepted_at: new Date().toISOString(),
            consent_version: STALE_CONSENT,
          },
        }),
      });
      const j = await r.json();
      if (!j.id) throw new Error(`create ${role}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
      console.log(`${role}: created (${j.id})`);
    }
    if (Object.keys(acct.profile).length) await patchProfile(acct.email, acct.profile);
  }

  // Cleared LAST: 0024 sends a cleared teacher back to unvetted on any profile
  // change, so clearing before the field writes above would undo itself.
  await patchProfile(ACCOUNTS.teacher.email, { vetting_state: "cleared" });
  await status();
}

async function signin(role, base = "http://localhost:3000") {
  const acct = ACCOUNTS[role];
  if (!acct) throw new Error(`unknown role "${role}" — one of ${Object.keys(ACCOUNTS).join(", ")}`);
  const r = await fetch(`${URL_}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      type: "magiclink",
      email: acct.email,
      // Top level, NOT nested under `options`: the REST API ignores it there
      // and silently substitutes the project's Site URL, which is the
      // production deployment. Verified 2026-09-10.
      redirect_to: `${base}/auth/callback`,
    }),
  });
  const j = await r.json();
  const link = j.action_link ?? j.properties?.action_link;
  if (!link) throw new Error(`generate_link: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  // One-time and short-lived. The target origin must be in Supabase's redirect
  // allow-list or it is discarded for the Site URL; localhost:3000 is listed,
  // Vercel preview hostnames are not.
  console.log(link);
}

async function status() {
  const r = await fetch(
    `${URL_}/rest/v1/profiles?select=email,role,vetting_state,consent_version&email=like.${TEST_ACCOUNT_PREFIX}*&order=email`,
    { headers: AUTH }
  );
  console.log(JSON.stringify(await r.json(), null, 2));
}

async function remove() {
  for (const [role, acct] of Object.entries(ACCOUNTS)) {
    const user = await findUser(acct.email);
    if (!user) {
      console.log(`${role}: already gone`);
      continue;
    }
    const r = await fetch(`${URL_}/auth/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: AUTH,
    });
    console.log(`${role}: ${r.ok ? "deleted" : `FAILED ${r.status}`}`);
  }
}

const [cmd, arg] = process.argv.slice(2);
const commands = { setup, signin: () => signin(arg ?? "student"), status, delete: remove };
if (!commands[cmd]) {
  console.error(`usage: node scripts/test-accounts.mjs <setup|signin [role]|status|delete>`);
  process.exit(1);
}
await commands[cmd]();
