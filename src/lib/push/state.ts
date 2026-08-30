// Onboarding is a state machine, not a wizard (spec §7.2). The shape is
// forced by a browser fact: an installed iOS web app has its OWN cookie jar,
// storage and service worker, so a teacher who signs up in Safari and then
// installs lands in a signed-out app. The permission ask therefore cannot
// live in the signup flow on iOS — the tab where they sign up can never hold
// a subscription. It has to happen wherever they land after installing,
// which is the dashboard.
//
// Keeping this pure is what makes the four-way table testable without a
// browser; the impure reads live in client.ts.

export interface SetupFacts {
  isIOS: boolean;
  standalone: boolean;
  permission: NotificationPermission;
  hasSubscription: boolean;
}

export type SetupAction = "install_ios" | "enable" | "blocked" | "done";

export function nextSetupAction(f: SetupFacts): SetupAction {
  // Order matters. iOS Safari reports permission "default" and has no
  // PushManager, so any other branch first would offer a button that cannot
  // work.
  if (f.isIOS && !f.standalone) return "install_ios";
  if (f.permission === "denied") return "blocked";
  if (f.permission === "default") return "enable";
  // Granted. A missing subscription is repaired silently by the mount-time
  // registration, so it is not something to put a button in front of.
  return "done";
}
