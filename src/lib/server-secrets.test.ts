import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Seven of the eight modules holding a server-side secret said "SERVER ONLY"
// in a comment and enforced it with nothing. `settle.ts` opened with
// "SERVER ONLY. Holds the service role" and would have compiled into a
// browser bundle without complaint if anything had ever imported it from a
// client component — inlining SUPABASE_SERVICE_ROLE_KEY, which bypasses every
// RLS policy in the database, into JavaScript served to the public.
//
// Nothing had made that mistake. The guard is here because "nobody has done
// it yet" is not a control, and the failure is silent, total and permanent:
// a leaked service role key is not recoverable by fixing the import.
//
// `server-only` turns it into a build error instead. vitest.config.mts
// already aliases the package to an empty module (Next's own documented
// pattern for Jest), so importing it costs the test suite nothing.

// Secret by SHAPE, not by a list of the six names that exist today — a rule
// naming today's variables cannot see tomorrow's. NEXT_PUBLIC_ is Next's own
// marker for "this is compiled into the client bundle on purpose", so those
// are excluded by definition, and RAZORPAY_KEY_ID stays out because a key id
// is public where a key secret is not.
const SECRET_SHAPED = /process\.env\.(?!NEXT_PUBLIC_)([A-Z][A-Z0-9_]*(?:_KEY|_SECRET|_TOKEN|_PASSWORD))\b/;

// Next guarantees these run on the server by virtue of what they are, so
// `server-only` in one would be belt on top of braces.
const FRAMEWORK_SERVER_FILES = ["page.tsx", "layout.tsx", "route.ts", "middleware.ts"];

function walk(dir: string, out: string[]) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (
      (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) &&
      !e.name.includes(".test.")
    )
      out.push(p);
  }
}

const files: string[] = [];
walk("src", files);

describe("server-side secrets", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("never reads a secret from a module a client component could import", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (FRAMEWORK_SERVER_FILES.includes(f.split("/").pop()!)) continue;
      const src = readFileSync(f, "utf8");
      if (!SECRET_SHAPED.test(src)) continue;
      if (!/^import "server-only";/m.test(src)) offenders.push(f);
    }
    // Named in the failure, all at once: this guard is most useful the day
    // someone adds a seventh secret-holding module, and naming one file at a
    // time would cost them a run per offender.
    expect(offenders, `missing 'import "server-only"':\n${offenders.join("\n")}`).toEqual([]);
  });

  it("does not mistake a NEXT_PUBLIC_ variable for a secret", () => {
    expect(SECRET_SHAPED.test('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY')).toBe(false);
    expect(SECRET_SHAPED.test('process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY')).toBe(false);
    // Proves the rule can fire, so a green run means something.
    expect(SECRET_SHAPED.test('process.env.SUPABASE_SERVICE_ROLE_KEY')).toBe(true);
    expect(SECRET_SHAPED.test('process.env.VAPID_PRIVATE_KEY')).toBe(true);
  });
});
