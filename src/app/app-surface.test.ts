import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Walk the product surface, plus the two shared components that carry literals.
const files: string[] = [
  "src/components/status-pill.tsx",
  "src/components/notification-setup.tsx",
];
for (const dir of ["src/app/(app)", "src/app/(gate)"]) {
  (function walk(d: string) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx")) files.push(p);
    }
  })(dir);
}

// Files not yet repainted. This list only ever SHRINKS — a task that cannot
// empty its own entries is not done. Task 7 asserts it reaches zero, after
// which this file becomes a plain regression guard like the marketing one.
const PENDING = new Set<string>([]);

const checked = () => files.filter((f) => !PENDING.has(f));

describe("the app surface", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  // Wider than the marketing guard: the dashboard expressed teacher status in
  // raw emerald/amber/red before --success existed.
  it("takes its colour from tokens, not literals", () => {
    // white/black carry no numeric shade (bg-white, not bg-white-50), so they
    // get their own branch rather than joining the shaded families above —
    // folding them into that group would require the \d{2,3} suffix they
    // never have, silently matching nothing.
    const literal =
      /\b(bg|text|border|ring|from|to|via)-(gray|slate|teal|zinc|cyan|neutral|emerald|red|amber|green|blue|indigo|purple|orange|yellow|rose|stone)-\d{2,3}\b|\b(bg|text|border|ring|from|to|via)-(white|black)\b/;
    for (const f of checked()) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(literal);
    }
  });

  it("uses no emoji as iconography", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const f of checked()) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(emoji);
    }
  });
});
