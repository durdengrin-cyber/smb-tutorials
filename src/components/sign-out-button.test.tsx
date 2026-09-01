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
});
