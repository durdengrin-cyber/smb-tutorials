// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const readSetupFacts = vi.fn();
const enableNotifications = vi.fn();
const registerExistingSubscription = vi.fn(async () => {});

vi.mock("@/lib/push/client", () => ({
  readSetupFacts: () => readSetupFacts(),
  enableNotifications: () => enableNotifications(),
  registerExistingSubscription: () => registerExistingSubscription(),
}));

import { NotificationSetup } from "./notification-setup";

beforeEach(() => {
  readSetupFacts.mockReset();
  enableNotifications.mockReset();
  registerExistingSubscription.mockClear();
});

describe("NotificationSetup", () => {
  it("gives an iPhone in Safari the Add to Home Screen instruction", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: true, standalone: false, permission: "default", hasSubscription: false,
    });
    render(<NotificationSetup variant="card" audience="teacher" />);
    await waitFor(() => expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument());
    // The re-sign-in cliff must be stated up front, not discovered.
    expect(screen.getByText(/sign in once more/i)).toBeInTheDocument();
  });

  it("offers a single enable button elsewhere", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: false, standalone: false, permission: "default", hasSubscription: false,
    });
    render(<NotificationSetup variant="card" audience="teacher" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /turn on notifications/i })).toBeInTheDocument()
    );
  });

  it("renders nothing once setup is complete", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: false, standalone: false, permission: "granted", hasSubscription: true,
    });
    const { container } = render(<NotificationSetup variant="card" audience="teacher" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("explains the dead end when permission is denied", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: false, standalone: false, permission: "denied", hasSubscription: false,
    });
    render(<NotificationSetup variant="card" audience="teacher" />);
    await waitFor(() => expect(screen.getByText(/browser settings/i)).toBeInTheDocument());
    // No button: browsers will not let us ask twice, so offering one would lie.
    expect(screen.queryByRole("button", { name: /turn on/i })).not.toBeInTheDocument();
  });
});


// A push subscription belongs to a BROWSER, not to an account, but a device row
// belongs to an account. So on a browser two people share — or one person with
// two accounts, which is every operator with a burner — whoever signed in last
// must end up owning the endpoint, or they get no alerts while the UI shows
// nothing wrong.
//
// The mechanism is this one line: on mount, even in the "done" state where the
// card renders nothing at all, the existing subscription is POSTed again, and
// register_device reassigns it to the caller when the keys match. Nothing
// asserted it. Deleting it would silently strand the second account and leave
// the whole suite green — and on 2026-09-10 it was misread twice as "done means
// nothing happens", once badly enough to nearly ship a migration for a bug that
// did not exist.
describe("the endpoint follows whoever is signed in", () => {
  it("re-registers the existing subscription even when it renders nothing", async () => {
    readSetupFacts.mockResolvedValue({
      isIOS: false, standalone: false, permission: "granted", hasSubscription: true,
    });
    const { container } = render(<NotificationSetup variant="card" audience="teacher" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    await waitFor(() =>
      expect(
        registerExistingSubscription,
        "the card is silent AND never claims the endpoint — the account that just signed in gets no alerts"
      ).toHaveBeenCalled()
    );
  });

  it("does not re-register when there is nothing to re-register", async () => {
    // permission "default": subscribing here would spend the one grant on a
    // page load nobody asked for (spec §6.4).
    readSetupFacts.mockResolvedValue({
      isIOS: false, standalone: false, permission: "default", hasSubscription: false,
    });
    render(<NotificationSetup variant="card" audience="teacher" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /turn on notifications/i })).toBeInTheDocument()
    );
    expect(registerExistingSubscription).not.toHaveBeenCalled();
  });
});

// This component was written for teachers, then reused verbatim on /admin.
// Every sentence in it was false there: dispatch.ts never sends an admin a
// session request — notifyAdminsOfApplication sends them "New teacher
// application" — so the card asked an admin to enable notifications for an
// event they do not receive, and the blocked state told them students were
// not reaching them. Found on 2026-09-14 by opening /admin and reading it.
//
// The compiler is the main guard now: `audience` is required, so a new caller
// cannot silently inherit someone else's copy. These pin the wording itself.
describe("it promises each audience only what it will actually be sent", () => {
  const facts = {
    isIOS: false,
    standalone: false,
    permission: "default",
    hasSubscription: false,
  };

  it("tells a teacher about session requests", async () => {
    readSetupFacts.mockResolvedValue(facts);
    render(<NotificationSetup variant="card" audience="teacher" />);
    await waitFor(() =>
      expect(screen.getByText(/asks for a session/i)).toBeInTheDocument()
    );
  });

  it("tells an admin about applications, never about session requests", async () => {
    readSetupFacts.mockResolvedValue(facts);
    render(<NotificationSetup variant="card" audience="admin" />);
    await waitFor(() =>
      expect(screen.getByText(/a teacher applies/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/asks for a session/i)).toBeNull();
  });

  it("does not tell a blocked admin that students cannot reach them", async () => {
    readSetupFacts.mockResolvedValue({ ...facts, permission: "denied" });
    render(<NotificationSetup variant="card" audience="admin" />);
    await waitFor(() =>
      expect(screen.getByText(/applications won.t reach you/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/students aren.t being shown/i)).toBeNull();
  });
});
