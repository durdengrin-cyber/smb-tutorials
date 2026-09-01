// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// @testing-library/user-event is not installed — this cycle sanctioned only
// web-push and @playwright/test as new dependencies. fireEvent is already
// available via @testing-library/react and is what the rest of this repo's
// component tests use to simulate a click.
const removeThisDevice = vi.fn();
const signOut = vi.fn();

vi.mock("@/lib/push/client", () => ({
  removeThisDevice: () => removeThisDevice(),
}));

vi.mock("@/app/auth/actions", () => ({
  signOut: () => signOut(),
}));

import { SignOutButton } from "./sign-out-button";

beforeEach(() => {
  removeThisDevice.mockReset().mockResolvedValue(undefined);
  signOut.mockReset().mockResolvedValue(undefined);
});

describe("SignOutButton", () => {
  it("removes this device's subscription before signing out", async () => {
    // Otherwise the next person to use this phone keeps receiving a
    // teacher's session requests — and that teacher believes they are
    // reachable.
    const order: string[] = [];
    removeThisDevice.mockImplementation(async () => {
      order.push("remove");
    });
    signOut.mockImplementation(async () => {
      order.push("signOut");
    });

    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(removeThisDevice).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["remove", "signOut"]);
  });

  // The safety property that matters most: being unable to tidy a device row
  // must never trap someone who is trying to leave.
  it("still signs out when removing the device fails", async () => {
    removeThisDevice.mockRejectedValue(new Error("network down"));

    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("disables the button while cleanup and sign-out are in flight", async () => {
    let resolveRemove!: () => void;
    removeThisDevice.mockImplementation(
      () => new Promise<void>((resolve) => { resolveRemove = resolve; })
    );

    render(<SignOutButton />);
    const button = screen.getByRole("button", { name: /sign out/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());

    resolveRemove();
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  // signOut() rejects on the client on its own SUCCESS path too — a Server
  // Action's redirect() surfaces there as a rejection, not a resolution
  // (see the comment above the second try/catch in sign-out-button.tsx).
  // That means an ordinary failure (the server action's own network call
  // failing, say) has to be told apart from that expected rejection, or the
  // button is left disabled forever with no way to retry — a narrower
  // instance of exactly the "trap someone trying to leave" failure this
  // task exists to close. unstable_rethrow (the real, unmocked
  // next/navigation implementation) is what tells the two apart here: a
  // plain Error has no redirect digest, so it falls through instead of
  // being re-thrown.
  it("re-enables the button when signOut fails for an ordinary reason", async () => {
    signOut.mockRejectedValue(new Error("network down"));

    render(<SignOutButton />);
    const button = screen.getByRole("button", { name: /sign out/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).not.toBeDisabled());
  });

  // The catch above rests entirely on unstable_rethrow telling Next's own
  // navigation signals apart from real failures. Nothing else pins that:
  // every other test here either resolves signOut or rejects it with a plain
  // Error, so deleting the unstable_rethrow(e) line leaves them all green
  // while silently breaking the discrimination. It is an unstable_ API on a
  // stack this project locks by policy, and to a future reader the line looks
  // like a no-op, so pin the assumption it encodes rather than only commenting
  // on it.
  //
  // Direct component-level proof is not available: the re-throw escapes
  // handleClick as an unhandled rejection (React does not await an onClick
  // result), which Vitest reports as an unhandled error and fails the file on.
  // So assert the primitive's behaviour against the two inputs the component
  // actually hands it.
  //
  // NOTE: next/navigation has no exports map, so this resolves the SERVER
  // variant of unstable_rethrow, while the browser bundle ships
  // unstable-rethrow.browser. The server variant's checks are a strict
  // superset of the browser one's, and the two agree on both cases asserted
  // here — this is a canary for the shared assumption, not a test of the
  // shipped chunk.
  it("unstable_rethrow re-throws a server-action redirect and passes ordinary errors through", async () => {
    const { unstable_rethrow } = await import("next/navigation");

    // Exactly what server-action-reducer.js builds on the redirect branch:
    // NEXT_REDIRECT;<type>;<url>;<status>;
    const redirectSignal = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;push;/;307;",
    });
    expect(() => unstable_rethrow(redirectSignal)).toThrow(redirectSignal);

    // A real server-action failure reaches the client with a numeric hash
    // digest, not a NEXT_ one, and must fall through so the button resets.
    const sanitized = Object.assign(new Error("An error occurred"), {
      digest: "3839471929",
    });
    expect(() => unstable_rethrow(sanitized)).not.toThrow();
    expect(() => unstable_rethrow(new Error("network down"))).not.toThrow();
  });
});
