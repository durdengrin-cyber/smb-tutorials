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
  // Granted but holding no subscription. This is NOT a theoretical state: it
  // is exactly where the ordinary sign-out path leaves a teacher, because
  // removeThisDevice() calls sub.unsubscribe() while the permission grant
  // survives. registerExistingSubscription now re-subscribes on mount, so
  // this usually self-heals before anyone sees it — but if that subscribe
  // fails (a stale VAPID key, a browser that drops the push service), the
  // teacher must get a button rather than a dashboard that says "done".
  //
  // Getting this wrong is the worst failure this cycle has: no card, no
  // warning, no device row, and — with the tab open — a pill still promising
  // "we'll notify you even with your phone locked" (spec §6.3).
  if (!f.hasSubscription) return "enable";
  return "done";
}
