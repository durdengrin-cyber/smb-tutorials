import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const APP = join(process.cwd(), "src", "app");
const GROUPS = ["(marketing)", "(app)", "(fullscreen)"];

function findPages(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findPages(full, found);
    else if (entry.name === "page.tsx") found.push(full);
  }
  return found;
}

describe("route groups", () => {
  // A page outside a group has no layout above it, therefore no auth gate.
  // This is what makes "protected because of where it lives" a guarantee
  // rather than a convention someone has to remember.
  it("puts every page inside a route group", () => {
    const offenders = findPages(APP)
      .map((p) => relative(APP, p))
      .filter((rel) => !GROUPS.includes(rel.split(sep)[0]));
    expect(offenders).toEqual([]);
  });

  it("finds the pages it is supposed to be checking", () => {
    expect(findPages(APP).length).toBeGreaterThan(5);
  });
});
