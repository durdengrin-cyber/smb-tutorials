#!/usr/bin/env node
// Proves, against PRODUCTION, that register_device and the teacher_devices
// trigger agree about who may register a push device.
//
// Why this exists: 0029 widened register_device's own gate to
// `role in ('teacher','admin')` and was applied to production, where it did
// nothing at all. Its insert still hit teacher_devices_guard — the BEFORE
// INSERT trigger from 0009 — whose function required `role = 'teacher'`. The
// function permitted the admin; the table refused one layer down, and the admin
// alert the migration was written to enable still could not fire. Nothing
// failed, nothing logged, and `supabase migration list` showed 0029 applied.
//
// Two role lists in two functions in two migrations, where the narrower one
// silently wins. src/lib/device-registration.test.ts pins them to each other in
// the repo; this proves what is actually live.
//
// The student case is the one that must never regress: teacher_devices' RLS
// policy is `auth.uid() = teacher_id`, which a student posting under their own
// id trivially satisfies. The guard is the only thing standing there, and 0030
// widened it.
//
// Usage: node scripts/probe-device-registration.mjs
// Requires the three burner accounts (scripts/test-accounts.mjs setup).
import crypto from "node:crypto";
import { readEnv, serviceHeaders } from "./probe-accounts.mjs";

const env = readEnv();
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
const SERVICE = { ...serviceHeaders(env), "Content-Type": "application/json" };
const TAG = "probe-device-registration";

/** A real user JWT, obtained without a password: mint a link, follow the hop. */
async function jwtFor(email) {
  const g = await fetch(`${URL_}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: SERVICE,
    body: JSON.stringify({
      type: "magiclink",
      email,
      redirect_to: "http://localhost:3000/auth/callback",
    }),
  });
  const j = await g.json();
  const link = j.action_link ?? j.properties?.action_link;
  if (!link) throw new Error(`no link for ${email}: ${JSON.stringify(j).slice(0, 200)}`);
  const r = await fetch(link, { redirect: "manual", headers: { apikey: ANON } });
  const frag = (r.headers.get("location") ?? "").split("#")[1] ?? "";
  const token = new URLSearchParams(frag).get("access_token");
  if (!token) throw new Error(`no access_token for ${email}`);
  return token;
}

const CASES = [
  { email: "smb-test-teacher@example.com", expect: "allowed" },
  { email: "smb-test-admin@example.com", expect: "allowed" },
  { email: "smb-test-student@example.com", expect: "refused" },
];

let failures = 0;
for (const { email, expect } of CASES) {
  const token = await jwtFor(email);
  const r = await fetch(`${URL_}/rest/v1/rpc/register_device`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_endpoint: `https://fcm.googleapis.com/fcm/send/${TAG}-${crypto.randomUUID()}`,
      p_p256dh:
        "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      p_auth: "tBHItJI5svbpez7KI4CCXg",
      p_user_agent: TAG,
    }),
  });
  const got = r.status === 204 ? "allowed" : "refused";
  const ok = got === expect;
  if (!ok) failures++;
  const role = email.replace("smb-test-", "").replace("@example.com", "");
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${role.padEnd(8)} ${got.padEnd(8)} (expected ${expect})` +
      (got === "refused" ? `  ${(await r.json()).message ?? ""}` : "")
  );
}

// Every row this probe wrote, and nothing else.
const del = await fetch(`${URL_}/rest/v1/teacher_devices?user_agent=eq.${TAG}`, {
  method: "DELETE",
  headers: { ...SERVICE, Prefer: "return=representation" },
});
console.log(`cleanup: removed ${(await del.json()).length} probe device row(s)`);

console.log(failures ? `\n${failures} FAILED` : "\nall 3 assertions passed");
process.exit(failures ? 1 : 0);
