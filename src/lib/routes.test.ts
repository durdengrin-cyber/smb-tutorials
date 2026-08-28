import { describe, it, expect } from "vitest";
import { resolveHome, signInRedirect } from "./routes";

describe("resolveHome", () => {
  it("sends a teacher to their dashboard", () => {
    expect(resolveHome("teacher")).toBe("/dashboard");
  });

  it("sends a student to find a teacher", () => {
    expect(resolveHome("student")).toBe("/find");
  });

  it("sends an admin to the admin surface", () => {
    expect(resolveHome("admin")).toBe("/admin");
  });
});

describe("signInRedirect", () => {
  it("carries the attempted path so the user returns to it", () => {
    expect(signInRedirect("/dashboard")).toBe("/signin?next=%2Fdashboard");
  });

  it("encodes query strings in the attempted path", () => {
    expect(signInRedirect("/waiting/abc?paid=1")).toBe("/signin?next=%2Fwaiting%2Fabc%3Fpaid%3D1");
  });

  it("does not loop when the attempted path is already /signin", () => {
    expect(signInRedirect("/signin")).toBe("/signin");
  });
});
