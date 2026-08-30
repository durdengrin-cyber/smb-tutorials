"use client";

import type { SetupFacts } from "./state";
import { REQUEST_TAG } from "@/lib/notifications/payload";

const SW_PATH = "/sw.js";

// VAPID keys travel as base64url; PushManager wants bytes.
//
// Returns Uint8Array<ArrayBuffer> rather than the bare Uint8Array: TS's lib
// types default the unparameterized alias to Uint8Array<ArrayBufferLike>,
// which admits SharedArrayBuffer and so is NOT assignable to
// PushSubscriptionOptionsInit's applicationServerKey (BufferSource, i.e.
// ArrayBufferView<ArrayBuffer>). Uint8Array.from() below already only ever
// backs onto a freshly allocated ArrayBuffer, so naming that explicitly is
// a correction to the annotation's precision, not a cast around it.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as MacIntel with touch points, which is why the
  // user-agent test alone is not enough.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export async function readSetupFacts(): Promise<SetupFacts> {
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  if (!supported) {
    return {
      isIOS: detectIOS(),
      standalone: detectStandalone(),
      permission: "default",
      hasSubscription: false,
    };
  }

  let hasSubscription = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    hasSubscription = Boolean(await reg?.pushManager.getSubscription());
  } catch {
    // A blocked storage context throws here. Treat it as "no subscription"
    // rather than crashing the dashboard.
  }

  return {
    isIOS: detectIOS(),
    standalone: detectStandalone(),
    permission: Notification.permission,
    hasSubscription,
  };
}

// Called ONLY from a user's explicit tap. Never on page load: a denied
// permission is close to permanent, and spending it on a load nobody asked
// for costs that teacher the push road forever (spec §6.4).
export async function enableNotifications(): Promise<
  { ok: true } | { error: string }
> {
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH);
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { error: "Notifications are blocked for this site." };
    }
    const sub = await reg.pushManager.subscribe({
      // Mandatory. There is no silent push, which is also why there is no
      // silent way to test whether a device is still reachable.
      userVisibleOnly: true,
      // Converted rather than passed as a string. Current browsers accept a
      // base64url DOMString, but Safari has lagged here and this is the one
      // call in the flow with no second chance: a rejected subscribe spends
      // the permission and leaves the teacher unreachable with no way to
      // re-ask.
      applicationServerKey: urlBase64ToUint8Array(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""
      ),
    });
    await postSubscription(sub);
    return { ok: true };
  } catch (e) {
    console.error("[push] enable failed", e);
    return { error: "Couldn't turn on notifications — try again." };
  }
}

// The re-registration-on-launch path (spec §8). Idempotent, cheap, and it
// repairs drift without anyone noticing — including a subscription rotated
// while the app was closed, which pushsubscriptionchange cannot be relied on
// to report.
export async function registerExistingSubscription(): Promise<void> {
  try {
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.register(SW_PATH);
    const sub = await reg.pushManager.getSubscription();
    if (sub) await postSubscription(sub);
  } catch (e) {
    console.error("[push] re-registration failed", e);
  }
}

// Spec §5.2. A teacher who arrives by notification lands on a dashboard that
// already shows the request via the existing catch-up query — so the
// notification behind it is stale the instant they get here. There is no
// dismissal push available to us (userVisibleOnly means every push must be
// visible), so the only way to clear it is from the page itself.
export async function closeStaleNotifications(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    const open = await reg.getNotifications({ tag: REQUEST_TAG });
    open.forEach((n) => n.close());
  } catch {
    // A browser that cannot enumerate notifications simply keeps showing one
    // that is merely redundant, never wrong. Not worth failing over.
  }
}

async function postSubscription(sub: PushSubscription): Promise<void> {
  await fetch("/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
}
