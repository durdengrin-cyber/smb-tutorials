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

/**
 * The configured VAPID public key as bytes, or null if this deployment has
 * none usable.
 *
 * Exists so the key can be checked BEFORE Notification.requestPermission().
 * The order used to be: register, request permission, then subscribe with
 * `process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""`. With the variable unset
 * that is an empty key, and subscribe throws InvalidAccessError — but only
 * AFTER the teacher has already granted permission. The comment on that
 * subscribe call has always said it is "the one call in the flow with no
 * second chance", and spec §6.4 says the permission must never be spent
 * carelessly; a missing environment variable was quietly doing exactly that,
 * behind a generic "try again" that no amount of trying could fix.
 *
 * Found on 2026-09-09 when a local dev environment without the key surfaced
 * InvalidAccessError from the dashboard's "Turn on notifications" button.
 * Vercel has the key in all three environments, so this was never a
 * production outage — but nothing in the code made that the difference
 * between a clear refusal and a burnt permission grant.
 */
function applicationServerKey(): Uint8Array<ArrayBuffer> | null {
  const raw = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
  if (!raw) return null;

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = urlBase64ToUint8Array(raw);
  } catch {
    // atob throws on anything that is not base64.
    return null;
  }

  // An uncompressed P-256 public key: the 0x04 tag followed by two 32-byte
  // coordinates. Checking the shape here is what turns a truncated or
  // pasted-wrong key into a refusal instead of a spent permission.
  if (bytes.length !== 65 || bytes[0] !== 0x04) return null;
  return bytes;
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
  // BEFORE requestPermission, never after. A missing or malformed key makes
  // subscribe throw, and by then the permission has been spent on a request
  // that could not have succeeded. This is the whole reason the check exists
  // as a separate step.
  const key = applicationServerKey();
  if (!key) {
    console.error(
      "[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing or malformed — refusing to request notification permission, which would be spent on a subscribe that cannot succeed"
    );
    return {
      error:
        "Notifications aren't set up on this site yet. Nothing to fix on your side — please let us know.",
    };
  }

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
      // base64url DOMString, but Safari has lagged here.
      applicationServerKey: key,
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
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      // Re-subscribe rather than return. Signing out unsubscribes this
      // browser (removeThisDevice), but the PERMISSION grant survives it, so
      // a teacher signing back in lands here holding a grant and no
      // subscription — and nothing else in the app can create one except the
      // button that "done" hides. Returning here is what made that teacher
      // silently unreachable.
      //
      // Safe to do without a prompt precisely because permission is already
      // granted: subscribe() only prompts from "default", which the guard
      // above has excluded. Nothing is spent, so §6.4's "never spend the
      // permission on a load nobody asked for" is not in play here.
      // Guarded here too, but only on the re-subscribe branch: an existing
      // subscription is still worth posting even if the key has since gone
      // missing, because that repairs the server's record of a device that
      // already works.
      const key = applicationServerKey();
      if (!key) {
        console.error("[push] re-subscribe skipped — VAPID public key missing or malformed");
        return;
      }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    }
    await postSubscription(sub);
  } catch (e) {
    // Deliberately swallowed: this runs on mount and must never break the
    // dashboard. The teacher is not left guessing, though — a failed
    // re-subscribe leaves hasSubscription false, which nextSetupAction now
    // turns into a visible "Turn on notifications" card.
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

// Spec §8's safety property: a shared family phone must not keep waking a
// teacher who signed out, or the next person to use it keeps receiving a
// teacher's session requests — and that teacher believes they are still
// reachable. Called from SignOutButton, before the signOut server action.
//
// Order is: read the current subscription, tell the server to forget it
// (DELETE /api/devices, RLS-scoped to the caller's own rows), then drop it
// locally. Each step is wrapped on its own, deliberately more granular than
// one outer try/catch — a failed DELETE still lets the local unsubscribe()
// happen, so this browser stops holding a subscription server-side cleanup
// couldn't reach. None of these steps is allowed to throw out of this
// function: being unable to tidy a device row must never trap someone who
// is trying to leave.
export async function removeThisDevice(): Promise<void> {
  let sub: PushSubscription | null = null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    sub = (await reg?.pushManager.getSubscription()) ?? null;
  } catch (e) {
    console.error("[push] could not read the local subscription", e);
  }
  if (!sub) return;

  try {
    const res = await fetch("/api/devices", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    // fetch only rejects on a network failure, not on a non-2xx response, so
    // a server-side rejection (bad payload, RLS finding no matching row,
    // etc.) would otherwise pass through unlogged and undistinguished from
    // success.
    if (!res.ok) {
      console.error("[push] could not remove this device", res.status);
    }
  } catch (e) {
    console.error("[push] could not remove this device", e);
  }

  try {
    await sub.unsubscribe();
  } catch (e) {
    console.error("[push] could not unsubscribe locally", e);
  }
}
