// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const declareAvailable = vi.fn();
const undeclareAvailable = vi.fn();
const renewLease = vi.fn();
const readSetupFacts = vi.fn();
const closeStaleNotifications = vi.fn();

vi.mock("./actions", () => ({
  declareAvailable: () => declareAvailable(),
  undeclareAvailable: () => undeclareAvailable(),
  renewLease: () => renewLease(),
}));

vi.mock("@/lib/push/client", () => ({
  readSetupFacts: () => readSetupFacts(),
  closeStaleNotifications: () => closeStaleNotifications(),
}));

// A fake presence channel that acks SUBSCRIBED on the next microtask by
// default, so a declared/live-lease toggle reads "Available" without any
// test having to drive a real websocket handshake. channelFailed (a real
// prop on the component, per the corrected brief) is what the "Can't reach
// you" test uses instead of forcing this mock into a failure path.
let subscribeStatus: "SUBSCRIBED" | "CHANNEL_ERROR" = "SUBSCRIBED";
function makeChannel() {
  return {
    track: vi.fn(async () => {}),
    untrack: vi.fn(async () => {}),
    unsubscribe: vi.fn(),
    subscribe: (cb: (status: string) => void) => {
      queueMicrotask(() => cb(subscribeStatus));
    },
  };
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => makeChannel(),
  }),
}));

import { AvailabilityToggle } from "./availability-toggle";

const props = {
  teacherId: "teacher-1",
  fullName: "Asha Rao",
  hourlyRate: 500,
  inSession: false,
  declaredUntil: null as string | null,
  hasDevice: false,
};

const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

beforeEach(() => {
  declareAvailable.mockReset();
  undeclareAvailable.mockReset();
  renewLease.mockReset().mockResolvedValue({ skipped: true });
  readSetupFacts.mockReset();
  closeStaleNotifications.mockReset().mockResolvedValue(undefined);
  subscribeStatus = "SUBSCRIBED";
});

describe("AvailabilityToggle", () => {
  // The sentence this cycle exists to delete. Its presence is a regression.
  it("never tells the teacher to keep the tab open", async () => {
    render(<AvailabilityToggle {...props} declaredUntil={futureIso} />);
    await waitFor(() => expect(screen.getByText(/Available until/i)).toBeInTheDocument());
    expect(screen.queryByText(/keep this tab open/i)).not.toBeInTheDocument();
  });

  it("shows the lease end so lapsing is what the teacher agreed to", async () => {
    render(<AvailabilityToggle {...props} declaredUntil={futureIso} />);
    await waitFor(() =>
      expect(screen.getByText(/we'll notify you even with your phone locked/i)).toBeInTheDocument()
    );
  });

  // A lapsed lease must read as Offline and say so, rather than leaving the
  // teacher to infer it from a toggle that silently moved.
  it("reads Offline and explains when the lease has lapsed", async () => {
    render(<AvailabilityToggle {...props} declaredUntil={pastIso} />);
    await waitFor(() => expect(screen.getByText(/Your availability ended at/i)).toBeInTheDocument());
  });

  // Declared but unreachable: hidden from students, and TOLD. This is the
  // state cycle 1 built the vocabulary for and had no mechanism to produce.
  it("shows Can't reach you when declared with no device and no live channel", async () => {
    // Inert: the component reads reachability from the server-side
    // `hasDevice` prop, never from readSetupFacts() (see the production
    // file's comment on the `hasDevice` prop). Set here only because the
    // mock exists and a reader might otherwise assume `permission: "denied"`
    // is what drives the Can't reach you result below — it isn't; `channelFailed`
    // and `hasDevice: false` (the shared `props` default) are.
    readSetupFacts.mockResolvedValue({ isIOS: false, standalone: false, permission: "denied", hasSubscription: false });
    render(<AvailabilityToggle {...props} declaredUntil={futureIso} channelFailed />);
    // Exact string, not a substring regex: STATUS_COPY.unreachable's own
    // description text ("...we can't reach your device...") also matches
    // /Can't reach you/i (a case-insensitive substring test on "reach your"
    // contains "reach you"), so that looser matcher finds two elements —
    // the pill's label and the description paragraph explaining it. Same
    // convention status-pill.test.tsx already uses for a pill's label.
    await waitFor(() => expect(screen.getByText("Can't reach you")).toBeInTheDocument());
  });

  // The OR half of the state formula (channelOk || hasDevice) is the whole
  // point of the push-only tier: a teacher whose phone is registered but
  // whose dashboard is closed (channelFailed forces the channel half to
  // false here, standing in for "no live channel") must still read
  // Available, not Can't reach you. Without this test, dropping hasDevice
  // from the formula entirely, or swapping || for &&, passes every other
  // test unchanged.
  it("reads Available on hasDevice alone, with no live channel", async () => {
    render(<AvailabilityToggle {...props} declaredUntil={futureIso} hasDevice channelFailed />);
    await waitFor(() =>
      expect(screen.getByText(/we'll notify you even with your phone locked/i)).toBeInTheDocument()
    );
    expect(screen.queryByText("Can't reach you")).not.toBeInTheDocument();
  });
});
