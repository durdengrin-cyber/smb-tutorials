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
      // Ten digits, no country code: the profile form rejects "+91..." with
      // "Enter a 10-digit phone number." and the save cannot complete. Seeded
      // wrong first time and found by driving the form.
      phone: "9999900001",
      qualification: "M.Sc. Mathematics",
      experience_years: 5,
      specialization: "Algebra",
      // Both are CHECK-constrained enums, not free text: teaching_level is
      // school|college|both, and hours_per_week is a bucket string, not a
      // number. Guessed wrong once; the constraint is the spec.
      teaching_level: "school",
      hourly_rate: 500,
      hours_per_week: "10-20",
      bio: "Burner account for automated testing.",
      demo_video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    },
  },
  admin: {
    // handle_new_user coerces every role that is not "teacher" to "student"
    // (0001), so admin is unreachable through any signup path by design. The
    // role is set by the SQL below, not here: profiles_role_immutable refuses
    // any role change unless app.allow_role_change is 'on', and PostgREST has
    // no way to set a session GUC.
    email: `${TEST_ACCOUNT_PREFIX}admin@example.com`,
    metadata: { role: "admin", full_name: "Test Admin" },
    profile: {},
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

  await status();
  console.log(PRIVILEGED_SQL_NOTE);
  sql();
}

// profiles_role_immutable and profiles_vetting_immutable both refuse their
// column unless a session GUC is set, and PostgREST cannot set one — so these
// two changes are unreachable over REST by design, not by accident. A DO block
// runs in a single transaction, which is what makes set_config(..., true) hold
// for the updates inside it.
//
// Cleared LAST: 0024 sends a cleared teacher back to unvetted on any profile
// change, so clearing before the field writes above would undo itself.
const PRIVILEGED_SQL_NOTE = `
Two changes remain and cannot be made over REST — run this yourself:

  supabase db query --linked "$(node scripts/test-accounts.mjs sql)"
`;

function sql() {
  console.log(`do $$
begin
  perform set_config('app.allow_role_change', 'on', true);
  update public.profiles set role = 'admin'
   where email = '${ACCOUNTS.admin.email}';

  perform set_config('app.allow_vetting_change', 'on', true);
  update public.profiles set vetting_state = 'cleared'
   where email = '${ACCOUNTS.teacher.email}';
end $$;`);
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
  // Prefer the hashed token over action_link. action_link points at Supabase's
  // /auth/v1/verify, which on success returns the session in a URL FRAGMENT —
  // and a fragment never reaches the server, so our /auth/callback sees neither
  // ?code nor ?token_hash and bounces to /signin?error=oauth. Going straight to
  // our own callback with token_hash uses the verifyOtp branch, which is the
  // path the app actually supports. Found by driving it, 2026-09-10.
  const hashed = j.properties?.hashed_token ?? j.hashed_token;
  if (hashed) {
    console.log(`${base}/auth/callback?token_hash=${hashed}&type=magiclink`);
    return;
  }
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
// `signin <role> [baseUrl]` — the base defaults to localhost. Production works
// because Supabase always permits its own Site URL; an arbitrary Vercel preview
// hostname does NOT, and is silently swapped for the Site URL instead.
const baseArg = process.argv[4]; // argv: [node, script, cmd, role, base]
const commands = {
  setup,
  signin: () => signin(arg ?? "student", baseArg ?? "http://localhost:3000"),
  status,
  sql,
  delete: remove,
};
if (!commands[cmd]) {
  console.error(`usage: node scripts/test-accounts.mjs <setup|signin [role] [baseUrl]|status|sql|delete>`);
  process.exit(1);
}
await commands[cmd]();
