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
import { removeThisDevice } from "./client";

const ENDPOINT = "https://push.example.com/subscription/abc123";

function makeSubscription(
  overrides: Partial<{ unsubscribe: () => Promise<boolean> }> = {}
): PushSubscription {
  return {
    endpoint: ENDPOINT,
    unsubscribe: vi.fn().mockResolvedValue(true),
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

let fetchMock: ReturnType<typeof vi.fn>;
// Every failure path below logs by design, so without this each of those
// tests dumps a real stack trace into the suite output and buries the signal.
// Held at file level rather than per-test so the four logging cases stay
// consistent, and exposed so the assertions can pin what was logged.
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
  vi.stubGlobal("fetch", fetchMock);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.unstubAllGlobals();
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
