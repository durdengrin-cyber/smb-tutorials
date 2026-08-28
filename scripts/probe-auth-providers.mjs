#!/usr/bin/env node
// Asserts that the auth providers the product depends on are actually enabled
// on the live Supabase project. Google being off was invisible until someone
// clicked the button; this makes it a check rather than a discovery.
//
// Run: node scripts/probe-auth-providers.mjs
import { readFileSync } from "node:fs";

const REQUIRED = ["email", "google"];

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

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
