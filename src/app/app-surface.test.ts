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
const PENDING = new Set([
  "src/components/notification-setup.tsx",
  "src/app/(app)/(student)/teachers/page.tsx",
  "src/app/(app)/(student)/teachers/teacher-card.tsx",
  "src/app/(app)/(student)/teachers/online-list.tsx",
  "src/app/(app)/(teacher)/dashboard/page.tsx",
  "src/app/(app)/(teacher)/dashboard/incoming-request.tsx",
  "src/app/(app)/(teacher)/dashboard/session-history.tsx",
  "src/app/(app)/(student)/find/page.tsx",
  "src/app/(app)/(student)/sessions/page.tsx",
  "src/app/(app)/(student)/waiting/[sessionId]/waiting-client.tsx",
  "src/app/(gate)/consent/page.tsx",
  "src/app/(gate)/consent/consent-form.tsx",
]);

const checked = () => files.filter((f) => !PENDING.has(f));

describe("the app surface", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  // Wider than the marketing guard: the dashboard expressed teacher status in
  // raw emerald/amber/red before --success existed.
  it("takes its colour from tokens, not literals", () => {
    const literal =
      /\b(bg|text|border|ring|from|to|via)-(gray|slate|teal|zinc|cyan|neutral|emerald|red|amber|green|blue|indigo|purple|orange|yellow|rose|stone)-\d{2,3}\b/;
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
