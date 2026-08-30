import { describe, it, expect } from "vitest";
import { nextSetupAction, type SetupFacts } from "./state";

const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  isIOS: false, standalone: false, permission: "default", hasSubscription: false, ...over,
});

describe("nextSetupAction", () => {
  // iOS is checked FIRST and deliberately. An iPhone Safari tab has no
  // PushManager at all, so asking for permission there is impossible — the
  // install is the only next step that can lead anywhere.
  it("asks an iPhone in a Safari tab to install, whatever else is true", () => {
    expect(nextSetupAction(facts({ isIOS: true }))).toBe("install_ios");
    expect(nextSetupAction(facts({ isIOS: true, permission: "granted" }))).toBe("install_ios");
  });

  it("does not ask a desktop or Android user to install anything", () => {
    // Push works in an ordinary tab everywhere except iOS. Pushing an install
    // on Android would be friction with nothing behind it.
    expect(nextSetupAction(facts())).toBe("enable");
  });

  it("asks an installed iPhone to enable", () => {
    expect(nextSetupAction(facts({ isIOS: true, standalone: true }))).toBe("enable");
  });

  // A denied permission is close to permanent — browsers will not let us ask
  // twice — so this state gets its own honest dead end rather than a button
  // that silently does nothing.
  it("reports a dead end when permission is denied", () => {
    expect(nextSetupAction(facts({ permission: "denied" }))).toBe("blocked");
    expect(nextSetupAction(facts({ isIOS: true, standalone: true, permission: "denied" }))).toBe("blocked");
  });

  it("is done once permission is granted and a subscription exists", () => {
    expect(nextSetupAction(facts({ permission: "granted", hasSubscription: true }))).toBe("done");
  });

  // Granted but no subscription is repaired silently by the mount-time
  // registration, so the teacher is never shown a button for it.
  it("is done when granted even without a subscription yet", () => {
    expect(nextSetupAction(facts({ permission: "granted", hasSubscription: false }))).toBe("done");
  });
});
