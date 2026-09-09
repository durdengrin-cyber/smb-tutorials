// @vitest-environment jsdom
//
// removeThisDevice is where the actual safety risk in Task 15 lives: three
// sequential browser-API calls, each independently caught, in a specific
// order, sending a specific payload shape to /api/devices. SignOutButton's
// own tests only exercise orchestration against a vi.fn() stand-in for this
// function — they cannot catch a later regression that collapses the three
// independent try/catch blocks into one, or a drift between the DELETE
// payload shape here and what src/app/api/devices/route.ts's DELETE handler
// actually destructures (`body?.endpoint`). This file is that guard.
//
// jsdom does not implement the Service Worker / Push API at all, so
// navigator.serviceWorker has to be stubbed by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  removeThisDevice,
  registerExistingSubscription,
  enableNotifications,
} from "./client";

const ENDPOINT = "https://push.example.com/subscription/abc123";

function makeSubscription(
  overrides: Partial<{ unsubscribe: () => Promise<boolean> }> = {}
): PushSubscription {
  return {
    endpoint: ENDPOINT,
    unsubscribe: vi.fn().mockResolvedValue(true),
    // postSubscription sends sub.toJSON(), so a fixture without it makes the
    // POST throw into the caller's catch and vanish — the failure looks like
    // "fetch was never called" rather than "the fixture is incomplete".
    toJSON: () => ({
      endpoint: ENDPOINT,
      keys: { p256dh: "p256dh-test-key", auth: "auth-test-key" },
    }),
    ...overrides,
  } as unknown as PushSubscription;
}

// Object.defineProperty, not a plain assignment: lib.dom's Navigator type
// declares serviceWorker as a real (non-optional) ServiceWorkerContainer,
// and jsdom's Navigator has no setter for it either, so `navigator
// .serviceWorker = ...` fails both the type check and, in some jsdom
// versions, at runtime.
function stubServiceWorker(
  getSubscription: () => Promise<PushSubscription | null>
) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: () =>
        Promise.resolve({ pushManager: { getSubscription } }),
    },
  });
}

function stubBrokenServiceWorker(error: unknown) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: () => Promise.reject(error),
    },
  });
}

// registerExistingSubscription goes through register(), not getRegistration(),
// and gates on Notification.permission — neither of which jsdom provides.
function stubForRegistration(opts: {
  permission: NotificationPermission;
  existing: PushSubscription | null;
  subscribe?: () => Promise<PushSubscription>;
}) {
  const subscribe =
    opts.subscribe ?? vi.fn().mockResolvedValue(makeSubscription());
  const registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(opts.existing),
      subscribe,
    },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn().mockResolvedValue(registration) },
  });
  vi.stubGlobal("Notification", { permission: opts.permission });
  return registration;
}

let fetchMock: ReturnType<typeof vi.fn>;
// Every failure path below logs by design, so without this each of those
// tests dumps a real stack trace into the suite output and buries the signal.
// Held at file level rather than per-test so the four logging cases stay
// consistent, and exposed so the assertions can pin what was logged.
let errorSpy: ReturnType<typeof vi.spyOn>;

// 65 bytes: the 0x04 tag of an uncompressed P-256 point plus two 32-byte
// coordinates, base64url encoded the way a real VAPID key travels. A
// configured deployment is the DEFAULT state for this file — Vercel has the
// key in all three environments — so beforeEach stubs it and only the tests
// about a broken deployment override it.
function validKey(): string {
  const bytes = new Uint8Array(65);
  bytes[0] = 0x04;
  for (let i = 1; i < 65; i++) bytes[i] = i;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
  vi.stubGlobal("fetch", fetchMock);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", validKey());
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: undefined,
  });
});

describe("removeThisDevice", () => {
  it("DELETEs /api/devices with this subscription's endpoint, in the shape the route expects", async () => {
    const sub = makeSubscription();
    stubServiceWorker(async () => sub);

    await removeThisDevice();

    // The route (src/app/api/devices/route.ts DELETE) reads body?.endpoint
    // and nothing else — this pins that exact contract from this side.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/devices",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "content-type": "application/json" }),
        body: JSON.stringify({ endpoint: ENDPOINT }),
      })
    );
  });

  it("unsubscribes locally, after the DELETE", async () => {
    const sub = makeSubscription();
    stubServiceWorker(async () => sub);

    await removeThisDevice();

    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    // Order matters (brief: read -> DELETE -> unsubscribe). fetchMock and
    // sub.unsubscribe are two different mocks, so invocation order is
    // compared via each mock's recorded call time.
    const fetchOrder = fetchMock.mock.invocationCallOrder[0];
    const unsubscribeOrder = (sub.unsubscribe as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(fetchOrder).toBeLessThan(unsubscribeOrder);
  });

  it("does nothing when there is no current subscription", async () => {
    stubServiceWorker(async () => null);

    await removeThisDevice();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs but does not throw when the DELETE responds with a non-2xx status", async () => {
    const sub = makeSubscription();
    stubServiceWorker(async () => sub);
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(removeThisDevice()).resolves.toBeUndefined();

    // Assert the STATUS reaches the log, not merely that something logged:
    // carrying res.status is the entire point of the !res.ok branch, since
    // fetch does not reject on a non-2xx and the failure would otherwise be
    // indistinguishable from success.
    expect(errorSpy).toHaveBeenCalledWith(
      "[push] could not remove this device",
      500
    );
    // Still unsubscribes locally — a server-side failure to record the
    // delete must not stop this browser from dropping its own copy.
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
  });

  // The three failure combinations the safety property depends on: none of
  // them may cause removeThisDevice itself to reject, because that would
  // propagate into SignOutButton and (per Finding 1's own lesson) risk
  // leaving sign-out unable to proceed.
  describe("never rejects", () => {
    it("when reading the local subscription fails", async () => {
      stubBrokenServiceWorker(new Error("blocked storage context"));

      await expect(removeThisDevice()).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("when the DELETE call itself fails (network error)", async () => {
      const sub = makeSubscription();
      stubServiceWorker(async () => sub);
      fetchMock.mockRejectedValue(new Error("network down"));

      await expect(removeThisDevice()).resolves.toBeUndefined();
      // A failed DELETE must still let the local unsubscribe happen, so
      // this browser stops holding a subscription server-side cleanup
      // couldn't reach.
      expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("when the browser has no serviceWorker at all", async () => {
      // Non-secure contexts and older browsers have no serviceWorker
      // property, so line 1 of the function throws a synchronous TypeError
      // inside the try rather than rejecting. afterEach already leaves
      // navigator.serviceWorker undefined, which is exactly that shape.
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: undefined,
      });

      await expect(removeThisDevice()).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("when unsubscribe() itself fails", async () => {
      const sub = makeSubscription({
        unsubscribe: vi.fn().mockRejectedValue(new Error("already gone")),
      });
      stubServiceWorker(async () => sub);

      await expect(removeThisDevice()).resolves.toBeUndefined();
      // The DELETE must already have gone out before unsubscribe was even
      // attempted.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

// The bug this cycle's final review caught, and the reason these tests exist:
// signing out calls removeThisDevice, which unsubscribes this browser — but
// the PERMISSION grant survives. On the next sign-in the teacher therefore
// holds a grant and no subscription. This function used to POST an existing
// subscription and return otherwise, so nothing re-created one, while
// nextSetupAction returned "done" on the premise that this function repaired
// it. Nothing did: no card, no device row, and a dashboard still promising
// notifications with the phone locked.
describe("registerExistingSubscription", () => {
  it("re-subscribes and registers when permission is granted but the subscription is gone", async () => {
    const fresh = makeSubscription();
    const subscribe = vi.fn().mockResolvedValue(fresh);
    const reg = stubForRegistration({
      permission: "granted",
      existing: null,
      subscribe,
    });

    await registerExistingSubscription();

    // The actual repair: a NEW subscription is created, not merely looked up.
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0][0]).toMatchObject({ userVisibleOnly: true });
    expect(reg.pushManager.getSubscription).toHaveBeenCalledTimes(1);
    // ...and it reaches the server, or the row still would not exist.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/devices");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  it("posts the existing subscription without re-subscribing when one is already held", async () => {
    const existing = makeSubscription();
    const subscribe = vi.fn();
    stubForRegistration({ permission: "granted", existing, subscribe });

    await registerExistingSubscription();

    // Spending a subscribe() call when one is already held would churn the
    // endpoint and orphan the row the server already has.
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all when permission has not been granted", async () => {
    const subscribe = vi.fn();
    stubForRegistration({ permission: "default", existing: null, subscribe });

    await registerExistingSubscription();

    // subscribe() from "default" would PROMPT — on a page load nobody asked
    // for, spending a grant that is close to permanent once denied (§6.4).
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when the re-subscribe itself fails", async () => {
    const subscribe = vi.fn().mockRejectedValue(new Error("push service down"));
    stubForRegistration({ permission: "granted", existing: null, subscribe });

    // Runs on mount: throwing here would take the dashboard down. The teacher
    // is not stranded silently — hasSubscription stays false, which
    // nextSetupAction turns into a visible "Turn on notifications" card.
    await expect(registerExistingSubscription()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// The permission is the scarce resource in this whole feature. Spec §6.4:
// never spend it on something that cannot succeed. A missing
// NEXT_PUBLIC_VAPID_PUBLIC_KEY made subscribe throw InvalidAccessError —
// but only AFTER requestPermission had already been answered, so the grant
// was consumed by a call that never had a chance, behind a generic
// "try again" that trying could not fix.
describe("enableNotifications — the key is checked before the permission is spent", () => {
  function stubNotification(permission: NotificationPermission = "granted") {
    const requestPermission = vi.fn().mockResolvedValue(permission);
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: { permission, requestPermission },
    });
    return requestPermission;
  }

  it("refuses without asking for permission when the key is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    stubForRegistration({ permission: "default", existing: null });
    const requestPermission = stubNotification();

    const result = await enableNotifications();

    expect("error" in result && result.error).toMatch(/aren't set up/i);
    // The assertion that matters: the grant was never touched.
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("refuses without asking when the key is the wrong length", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "QUJDREVG");
    stubForRegistration({ permission: "default", existing: null });
    const requestPermission = stubNotification();

    const result = await enableNotifications();

    expect("error" in result).toBe(true);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("refuses without asking when the key is not base64 at all", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "not a key!!!");
    stubForRegistration({ permission: "default", existing: null });
    const requestPermission = stubNotification();

    await enableNotifications();

    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("blames the site, not the teacher, since they cannot fix it", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    stubForRegistration({ permission: "default", existing: null });
    stubNotification();

    const result = await enableNotifications();

    expect("error" in result && result.error).toMatch(/nothing to fix on your side/i);
    // Must NOT be the "blocked for this site" message, which tells a teacher
    // to go change a browser setting that is not the problem.
    expect("error" in result && result.error).not.toMatch(/blocked/i);
  });

  it("asks for permission and subscribes with 65 bytes when the key is good", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", validKey());
    const subscribe = vi.fn().mockResolvedValue(makeSubscription());
    stubForRegistration({ permission: "default", existing: null, subscribe });
    // AFTER stubForRegistration: that helper stubGlobals Notification with
    // only { permission }, so stubbing first would lose requestPermission.
    const requestPermission = stubNotification("granted");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const result = await enableNotifications();

    expect(requestPermission).toHaveBeenCalled();
    expect("ok" in result && result.ok).toBe(true);
    const passed = subscribe.mock.calls[0][0].applicationServerKey;
    expect(passed).toBeInstanceOf(Uint8Array);
    expect(passed.length).toBe(65);
    expect(passed[0]).toBe(0x04);
  });

  it("does not re-subscribe on mount when the key is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    const subscribe = vi.fn();
    stubForRegistration({ permission: "granted", existing: null, subscribe });
    stubNotification("granted");

    await registerExistingSubscription();

    expect(subscribe).not.toHaveBeenCalled();
  });
});

