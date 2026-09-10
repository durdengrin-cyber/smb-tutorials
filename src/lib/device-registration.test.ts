import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Migration 0029 ("the admin alert could never have fired — give the admin a
// device to register") was applied to production and changed nothing.
//
// register_device's own gate was widened to `role in ('teacher','admin')`. Its
// insert then hits teacher_devices_guard, the BEFORE INSERT trigger from 0009,
// whose function still said `role = 'teacher'`. The function permitted the
// admin; the table refused them one layer down. Proven on 2026-09-10 by calling
// register_device with a real admin JWT (P0001 "teacher_devices requires a
// teacher profile") and a real teacher JWT (204). 0030 closes it.
//
// Two role lists in two functions, in two different migrations, that must agree
// or the feature silently does nothing. That is a promise with no enforcer —
// the pattern this repo has shipped repeatedly — so this is the enforcer.
const DIR = join("supabase", "migrations");
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort(); // 0001..0030 — lexical order is definition order here.

/**
 * The role list in the LAST migration that defines this function. Later
 * migrations replace earlier ones, so only the final definition is live —
 * asserting against 0009's original text would pin the bug, not the fix.
 */
function liveRoleList(fn: string): { file: string; roles: string[] } {
  let found: { file: string; roles: string[] } | null = null;
  for (const f of FILES) {
    const sql = readFileSync(join(DIR, f), "utf8");
    // Anchor on the DEFINITION, and stop at the end of its body. Anchoring on
    // "function public.<fn>(" instead matched the trailing `comment on
    // function ...` and `grant execute on function ...` lines, whose slice
    // contains no role list at all — so this silently read the wrong migration
    // and reported the bug as the fix.
    const at = sql.lastIndexOf(`create or replace function public.${fn}(`);
    if (at === -1) continue;
    const end = sql.indexOf("$$;", at);
    const body = sql.slice(at, end === -1 ? undefined : end);
    // Either `role in ('a', 'b')` or `role = 'a'`.
    const inList = body.match(/role\s+in\s*\(([^)]*)\)/i);
    const single = body.match(/role\s*=\s*'([a-z]+)'/i);
    const roles = inList
      ? inList[1].split(",").map((s) => s.trim().replace(/'/g, ""))
      : single
        ? [single[1]]
        : [];
    if (roles.length) found = { file: f, roles: roles.sort() };
  }
  if (!found) throw new Error(`no role list found for ${fn}`);
  return found;
}

describe("device registration agrees with itself across both layers", () => {
  it("register_device and the teacher_devices trigger accept the same roles", () => {
    const gate = liveRoleList("register_device");
    const guard = liveRoleList("devices_requires_teacher");
    expect(
      guard.roles,
      `register_device (${gate.file}) accepts [${gate.roles}] but the teacher_devices trigger (${guard.file}) accepts [${guard.roles}]. Whichever is narrower wins at runtime, silently — that is how 0029 shipped to production and did nothing.`
    ).toEqual(gate.roles);
  });

  it("both still admit a teacher, and neither admits a student", () => {
    for (const fn of ["register_device", "devices_requires_teacher"]) {
      const { roles, file } = liveRoleList(fn);
      expect(roles, `${fn} (${file}) no longer admits a teacher`).toContain("teacher");
      expect(
        roles,
        `${fn} (${file}) admits a student — 0009's guard exists because the RLS policy is auth.uid() = teacher_id, which a student trivially satisfies`
      ).not.toContain("student");
    }
  });

  // The guard's message named only teachers while refusing an admin, which is
  // what made the 400 from /api/devices read as a role problem that 0029 had
  // already fixed.
  it("the guard says what it actually requires", () => {
    const sql = readFileSync(
      join(DIR, "0030_devices_guard_matches_register_device.sql"),
      "utf8"
    );
    expect(sql).toMatch(/requires a teacher or admin profile/);
    // db push wraps each file in its own transaction; an explicit commit
    // inside would end it early and run the rest unprotected.
    expect(sql).not.toMatch(/^\s*(begin|commit)\s*;/im);
  });
});
