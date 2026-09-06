import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "./nav";
import { resolveHome, type Role } from "./routes";

// Does a route exist for this href? App Router puts a page at some
// src/app/<any nesting of (groups)>/<segment>/page.tsx, so the group
// directories have to be walked rather than guessed at.
function routeExists(href: string): boolean {
  const segment = href.split("/").filter(Boolean)[0];
  if (!segment) return existsSync(join("src", "app", "page.tsx"));
  const search = (dir: string): boolean => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name === segment) return existsSync(join(dir, e.name, "page.tsx"));
      // Route groups are parentheses-wrapped and contribute nothing to the
      // URL, so a page inside one still answers at /<segment>.
      if (e.name.startsWith("(") && search(join(dir, e.name))) return true;
    }
    return false;
  };
  return search(join("src", "app"));
}

// `admin` is a forward declaration, not an oversight: migration 0006 widens
// profiles.role to include it and is deliberately parked in
// supabase/migrations-deferred/, so no admin account can exist. 0006's own
// comment gives the reason the nav entry was written early — "requireRole,
// the nav config and the /home resolver are written once for three roles
// rather than rewritten for a third".
//
// The exception EXPIRES BY ITSELF. The moment someone activates 0006 by
// moving it into supabase/migrations/, the role becomes real, and this
// exception stops applying — so /admin has to exist by then or the guard
// goes red. That is the difference between a documented deferral and a dead
// link nobody is tracking.
const ADMIN_ROLE_IS_DEFERRED = existsSync(
  join("supabase", "migrations-deferred", "0006_roles_admin.sql")
);
const REACHABLE_ROLES = (
  ADMIN_ROLE_IS_DEFERRED ? ["student", "teacher"] : ["student", "teacher", "admin"]
) as readonly Role[];

describe("nav config", () => {
  it("gives a teacher their dashboard", () => {
    expect(NAV.teacher.map((i) => i.href)).toContain("/dashboard");
  });

  it("gives a student the find flow", () => {
    expect(NAV.student.map((i) => i.href)).toContain("/find");
  });

  it("never shows a role a link it cannot reach", () => {
    expect(NAV.student.map((i) => i.href)).not.toContain("/dashboard");
    expect(NAV.teacher.map((i) => i.href)).not.toContain("/find");
  });

  it("starts each role at a link it actually has", () => {
    for (const role of REACHABLE_ROLES) {
      expect(NAV[role].map((i) => i.href)).toContain(resolveHome(role));
    }
  });

  it("labels every item", () => {
    for (const items of Object.values(NAV)) {
      for (const item of items) expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("NAV", () => {
  it("gives a student both their record and the way to find a teacher", () => {
    expect(NAV.student.map((i) => i.href)).toEqual(["/sessions", "/find"]);
  });

  // nav.ts has always CLAIMED this rule — "a nav pointing at pages that do
  // not exist is the same defect as marketing copy advertising features that
  // do not exist" — and nothing enforced it. NAV.admin has pointed at
  // /admin, which has no page.tsx, since it was written. A comment stating a
  // rule no test checks is the shape of defect that survives every review,
  // because everyone reads the comment and assumes something is watching.
  it("never points a reachable role at a route that does not exist", () => {
    for (const role of REACHABLE_ROLES) {
      for (const item of NAV[role]) {
        expect(routeExists(item.href), `${role} nav: ${item.href}`).toBe(true);
      }
    }
  });

  it("sends every reachable role somewhere that exists", () => {
    for (const role of REACHABLE_ROLES) {
      expect(routeExists(resolveHome(role)), `resolveHome(${role})`).toBe(true);
    }
  });

  // Proves the guard above can fail, rather than passing because routeExists
  // returns true for everything.
  it("routeExists says no to a route that is not there", () => {
    expect(routeExists("/admin")).toBe(false);
    expect(routeExists("/find")).toBe(true);
  });
});
