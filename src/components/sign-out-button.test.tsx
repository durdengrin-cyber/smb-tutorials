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
});
