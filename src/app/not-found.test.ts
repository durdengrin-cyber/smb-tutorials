import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Four not-found.tsx files already existed — one per route group — and every
// one of them looked fine, so nobody noticed that a URL matching NO group had
// nothing to catch it. Those four sit inside a group layout that supplies a
// header, a footer and a way out; this one renders inside RootLayout, which
// supplies none of that. Found by opening /no-such-page-here on production
// and getting Next's built-in "404 | This page could not be found" on black.
const PATH = join("src", "app", "not-found.tsx");

describe("the root not-found page", () => {
  it("exists, so an unmatched URL never reaches the framework default", () => {
    expect(
      existsSync(PATH),
      "src/app/not-found.tsx is missing — a URL matching no route group falls through to Next's unstyled default"
    ).toBe(true);
  });

  const SRC = existsSync(PATH) ? readFileSync(PATH, "utf8") : "";

  // RootLayout renders <body> and nothing else: no header, no footer, no
  // navigation. Without these the page is one sentence floating on an empty
  // ground, which reads as a broken deployment rather than a handled error.
  it("brings its own chrome, because RootLayout has none", () => {
    expect(SRC).toMatch(/MarketingHeader/);
    expect(SRC).toMatch(/MarketingFooter/);
  });

  // The same reasoning as (marketing)/layout.tsx, which carries the comment:
  // identity decides only whether the header says "Sign in" or "Go to your
  // dashboard", so a transient Supabase failure must degrade to the
  // signed-out header rather than replacing the 404 with a 500.
  it("degrades to the signed-out header if identity lookup fails", () => {
    expect(SRC).toMatch(/try\s*{/);
    expect(SRC).toMatch(/catch/);
  });

  // The trap this page exists to avoid. /find, /home, /sessions and
  // /dashboard all require a session; offering one to a signed-out visitor
  // turns the way out into a second dead end at /signin. The root 404 cannot
  // know who is reading it, so its only link is the one route that works for
  // everyone. (gate)/not-found.tsx learned the same lesson about /home.
  it("offers only a route that works signed in or signed out", () => {
    const hrefs = [...SRC.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(
        ["/find", "/home", "/sessions", "/dashboard", "/profile", "/setup", "/admin"],
        `root 404 links to ${href}, which requires a session — a signed-out visitor lands on /signin instead`
      ).not.toContain(href);
    }
  });

  it("says what happened in the same plain voice as the other four", () => {
    expect(SRC).toMatch(/not found/i);
  });
});
