#!/usr/bin/env node
// Asserts that the auth providers the product depends on are actually enabled
// on the live Supabase project. Google being off was invisible until someone
// clicked the button; this makes it a check rather than a discovery.
//
// Run: node scripts/probe-auth-providers.mjs
//
// Uses the SHARED readEnv rather than parsing .env.local itself. It had its own
// copy, and that copy did not strip surrounding quotes — .env.local is written
// by the Vercel CLI, which quotes values, so this probe built
// `"https://…"/auth/v1/settings` and died with an Invalid URL TypeError. It had
// therefore never once reported a provider state, while project_state.md
// recorded it as "exits 1 naming google". A check that cannot run is worse than
// no check: it looks like coverage. Deleted the duplicate instead of patching
// it, since the bug existed only because it was a duplicate.
//
// Note the shared helper resolves .env.local relative to the CWD, so run this
// from the repo root, as with every other probe here.
import { readEnv } from "./probe-accounts.mjs";

const REQUIRED = ["email", "google"];

const env = readEnv();

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  process.exit(1);
}

const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
if (!res.ok) {
  console.error(`settings endpoint returned ${res.status}`);
  process.exit(1);
}

const { external = {} } = await res.json();
const missing = REQUIRED.filter((p) => !external[p]);

for (const p of REQUIRED) {
  console.log(`  ${external[p] ? "OK  " : "FAIL"} ${p}`);
}

if (missing.length) {
  console.error(`\nProviders not enabled: ${missing.join(", ")}`);
  console.error("Enable them in Supabase -> Authentication -> Providers.");
  process.exit(1);
}
console.log("\nAll required auth providers are enabled.");
