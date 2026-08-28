import { describe, it, expect } from "vitest";
import { resolveHome, signInRedirect, safeNext } from "./routes";

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

describe("safeNext", () => {
  it("passes through a same-origin path", () => {
    expect(safeNext("/dashboard", "/home")).toBe("/dashboard");
  });

  it("keeps the query string", () => {
    expect(safeNext("/waiting/abc?paid=1", "/home")).toBe("/waiting/abc?paid=1");
  });

  it("falls back when absent", () => {
    expect(safeNext(null, "/home")).toBe("/home");
    expect(safeNext("", "/home")).toBe("/home");
  });

  it("refuses an absolute URL", () => {
    expect(safeNext("https://evil.example/x", "/home")).toBe("/home");
  });

  it("refuses a protocol-relative URL", () => {
    expect(safeNext("//evil.example", "/home")).toBe("/home");
  });

  it("refuses a backslash-smuggled protocol-relative URL", () => {
    expect(safeNext("/\\evil.example", "/home")).toBe("/home");
  });

  // The URL parser strips ASCII tab/CR/LF from anywhere in the input before
  // parsing, so each of these collapses to "//evil.example" in a browser.
  it("refuses a tab-smuggled protocol-relative URL", () => {
    expect(safeNext("/\t/evil.example", "/home")).toBe("/home");
  });

  it("refuses CR- and LF-smuggled protocol-relative URLs", () => {
    expect(safeNext("/\r/evil.example", "/home")).toBe("/home");
    expect(safeNext("/\n/evil.example", "/home")).toBe("/home");
  });

  // Tab-stripping and backslash-normalisation compose: remove the tab and the
  // backslash becomes the second slash.
  it("refuses a tab-plus-backslash payload", () => {
    expect(safeNext("/\t\\evil.example", "/home")).toBe("/home");
  });

  it("refuses a non-string value such as an uploaded File part", () => {
    expect(safeNext(new File([""], "x"), "/home")).toBe("/home");
  });
});
