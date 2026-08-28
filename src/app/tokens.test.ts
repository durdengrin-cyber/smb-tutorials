import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio } from "@/lib/contrast";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`));
  if (!match) throw new Error(`token --${name} not found as a hex value`);
  return match[1];
}

describe("brand tokens", () => {
  it("defines the primary pair", () => {
    expect(token("primary")).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(token("primary-foreground")).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("meets WCAG AA for normal text on the primary button", () => {
    expect(contrastRatio(token("primary"), token("primary-foreground"))).toBeGreaterThanOrEqual(4.5);
  });

  it("meets WCAG AA for destructive actions", () => {
    expect(contrastRatio(token("destructive"), token("destructive-foreground"))).toBeGreaterThanOrEqual(4.5);
  });
});
