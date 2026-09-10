import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Three burner accounts (smb-test-student / -teacher / -admin) live in the
// PRODUCTION database so an agent can test all three roles without the owner
// signing in by hand. One of them is an admin. They must not survive to launch.
//
// "We'll delete them before we go live" is a promise with no enforcer, and this
// repo has already shipped six of those in a single day — see
// _memory/promises-need-an-enforcer.md. This is the enforcer.
//
// It cannot query the database (the suite is offline and has no service-role
// key), so it does the next best thing: it holds the LAUNCH to the accounts
// being gone, by failing whenever someone declares launch readiness while the
// setup script still exists. Deleting the accounts means deleting the script,
// and the script is what this can see.
describe("the burner test accounts do not survive to launch", () => {
  const SCRIPT = join("scripts", "test-accounts.mjs");

  const launchReady = process.env.SMB_LAUNCH_READY === "1";

  it.runIf(launchReady)(
    "has no test-account tooling left when SMB_LAUNCH_READY=1",
    () => {
      let exists = true;
      try {
        readFileSync(SCRIPT, "utf8");
      } catch {
        exists = false;
      }
      expect(
        exists,
        `SMB_LAUNCH_READY=1 but ${SCRIPT} is still here. Run "node ${SCRIPT} delete" to remove smb-test-student/-teacher/-admin from production — one of them is an admin — then delete the script and this test.`
      ).toBe(false);
    }
  );

  // Runs always: the flag above is opt-in, so without this the whole guard
  // could rot unnoticed and pass vacuously on the one day it matters.
  it("keeps the deletion command discoverable while they exist", () => {
    let script: string;
    try {
      script = readFileSync(SCRIPT, "utf8");
    } catch {
      return; // Already cleaned up. Nothing to guard.
    }
    expect(script, "the script must offer a teardown, not only a setup").toMatch(
      /delete: remove/
    );
    expect(script, "the prefix is the contract that makes them findable").toMatch(
      /TEST_ACCOUNT_PREFIX = "smb-test-"/
    );
    expect(
      script,
      "the script must not hard-code a password — sign-in is via a minted link"
    ).not.toMatch(/password:\s*"[^"]+"/);
  });
});
