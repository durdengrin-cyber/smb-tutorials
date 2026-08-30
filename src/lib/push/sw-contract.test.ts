import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REQUEST_TAG } from "@/lib/notifications/payload";

// public/sw.js is registered as a CLASSIC script (client.ts's
// navigator.serviceWorker.register(SW_PATH) passes no {type: "module"}), so
// it can never import REQUEST_TAG — it hardcodes the same string as a
// literal instead. Nothing else protects that pairing: not a type check
// (sw.js isn't compiled), not a lint rule, not the browser. If the two ever
// drift, closeStaleNotifications silently stops clearing anything — no
// error, no symptom except stale notifications piling up on a teacher's
// lock screen. This test is the tripwire.
describe("public/sw.js contract with REQUEST_TAG", () => {
  it("hardcodes the same tag @/lib/notifications/payload exports", () => {
    const swSource = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
    // The quoted literal, not a bare substring check: "session-request"
    // would still be found inside a drifted "session-request-v2", which
    // would defeat the point of this test. JSON.stringify produces the
    // exact double-quoted form a JS string literal takes in the source.
    expect(swSource).toContain(JSON.stringify(REQUEST_TAG));
  });
});
