// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const readSetupFacts = vi.fn();
const enableNotifications = vi.fn();

vi.mock("@/lib/push/client", () => ({
  readSetupFacts: () => readSetupFacts(),
  enableNotifications: () => enableNotifications(),
  registerExistingSubscription: async () => {},
}));

import { NotificationSetup } from "./notification-setup";

beforeEach(() => { readSetupFacts.mockReset(); enableNotifications.mockReset(); });

describe("NotificationSetup", () => {
  it("gives an iPhone in Safari the Add to Home Screen instruction", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: true, standalone: false, permission: "default", hasSubscription: false,
    });
    render(<NotificationSetup variant="card" />);
    await waitFor(() => expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument());
    // The re-sign-in cliff must be stated up front, not discovered.
    expect(screen.getByText(/sign in once more/i)).toBeInTheDocument();
  });

  it("offers a single enable button elsewhere", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: false, standalone: false, permission: "default", hasSubscription: false,
    });
    render(<NotificationSetup variant="card" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /turn on notifications/i })).toBeInTheDocument()
    );
  });

  it("renders nothing once setup is complete", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: false, standalone: false, permission: "granted", hasSubscription: true,
    });
    const { container } = render(<NotificationSetup variant="card" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("explains the dead end when permission is denied", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: false, standalone: false, permission: "denied", hasSubscription: false,
    });
    render(<NotificationSetup variant="card" />);
    await waitFor(() => expect(screen.getByText(/browser settings/i)).toBeInTheDocument());
    // No button: browsers will not let us ask twice, so offering one would lie.
    expect(screen.queryByRole("button", { name: /turn on/i })).not.toBeInTheDocument();
  });
});
