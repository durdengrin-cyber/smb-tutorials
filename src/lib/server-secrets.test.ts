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

// These names run on the server by convention, NOT by guarantee: any of them
// can open with a "use client" directive and opt itself into the browser
// bundle instead, and Next honours that regardless of the filename. A
// page.tsx marked "use client" that reads a secret is exactly the leak this
// guard exists to catch, so the exemption below is conditional on the
// directive being absent — never on the name alone.
const FRAMEWORK_SERVER_FILES = ["page.tsx", "layout.tsx", "route.ts", "middleware.ts"];

// The file's first non-blank, non-"//"-comment line, or undefined for a file
// that is all blank lines and comments. Directives must be the first
// statement in the file for Next (or any bundler) to honour them, so this is
// the only line worth checking.
function firstStatementLine(src: string): string | undefined {
  return src
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("//"));
}

// True only when `filename` is one of the framework names above AND the file
// does not open with "use client". Extracted from the walk below so it can
// be tested directly against a crafted source string — proving the directive
// defeats the exemption does not require a real "use client" file with a
// secret sitting in the tree, which would itself be the leak.
function isExemptFrameworkFile(filename: string, src: string): boolean {
  if (!FRAMEWORK_SERVER_FILES.includes(filename)) return false;
  const first = firstStatementLine(src);
  return first !== '"use client";' && first !== "'use client';" &&
    first !== '"use client"' && first !== "'use client'";
}

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
      const src = readFileSync(f, "utf8");
      if (isExemptFrameworkFile(f.split("/").pop()!, src)) continue;
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

  describe("the FRAMEWORK_SERVER_FILES exemption", () => {
    it("exempts a page.tsx with no directive", () => {
      const src = 'import { x } from "y";\nexport default function Page() { return x; }';
      expect(isExemptFrameworkFile("page.tsx", src)).toBe(true);
    });

    it('does NOT exempt a page.tsx that opens with "use client"', () => {
      // This is the exact hole the guard exists to close: a "use client"
      // page.tsx is compiled into the browser bundle like any other client
      // module, so a secret read in one is a real leak regardless of the
      // filename.
      const src =
        '"use client";\n\nexport default function Page() {\n' +
        "  return process.env.SUPABASE_SERVICE_ROLE_KEY;\n}\n";
      expect(isExemptFrameworkFile("page.tsx", src)).toBe(false);
      // Chained with the rest of the guard, this file would be flagged: it is
      // secret-shaped, unexempted, and carries no `import "server-only"`.
      expect(SECRET_SHAPED.test(src)).toBe(true);
      expect(/^import "server-only";/m.test(src)).toBe(false);
    });

    it('also refuses layout.tsx, route.ts and middleware.ts marked "use client"', () => {
      const src = "'use client';\nexport const x = 1;";
      for (const name of ["layout.tsx", "route.ts", "middleware.ts"]) {
        expect(isExemptFrameworkFile(name, src)).toBe(false);
      }
    });

    it("still exempts those names when undirected", () => {
      const src = "export const x = 1;";
      for (const name of ["page.tsx", "layout.tsx", "route.ts", "middleware.ts"]) {
        expect(isExemptFrameworkFile(name, src)).toBe(true);
      }
    });

    it("never exempts a name outside the framework list, directive or not", () => {
      expect(isExemptFrameworkFile("actions.ts", '"use client";\nexport const x = 1;')).toBe(
        false
      );
      expect(isExemptFrameworkFile("actions.ts", "export const x = 1;")).toBe(false);
    });
  });
});
