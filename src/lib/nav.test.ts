import { describe, it, expect } from "vitest";
import { NAV } from "./nav";
import { resolveHome } from "./routes";

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
    for (const role of ["student", "teacher"] as const) {
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
  // A nav pointing at a page that does not exist is the same defect as
  // marketing copy advertising a deferred feature.
  it("gives a student both their record and the way to find a teacher", () => {
    expect(NAV.student.map((i) => i.href)).toEqual(["/sessions", "/find"]);
  });
});
