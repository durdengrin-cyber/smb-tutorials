// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { LiveRefresh } from "./live-refresh";

// The operator was pushed "a teacher applied", clicked the notification, landed
// on an already-open /admin, and the applicant was not there until they hit
// reload. Two independent causes, and both are pinned here because neither is
// visible from the other's file.
beforeEach(() => {
  refresh.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("LiveRefresh", () => {
  it("refetches the moment the tab is looked at", () => {
    render(<LiveRefresh />);
    expect(refresh).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refetches on a timer while the tab is visible", () => {
    setVisibility("visible");
    refresh.mockClear();
    render(<LiveRefresh intervalMs={1000} />);
    vi.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("does not poll a tab nobody is looking at", () => {
    setVisibility("hidden");
    refresh.mockClear();
    render(<LiveRefresh intervalMs={1000} />);
    vi.advanceTimersByTime(5000);
    expect(refresh, "a background tab was polling the roster with no reader").not.toHaveBeenCalled();
  });

  it("stops when unmounted", () => {
    setVisibility("visible");
    const { unmount } = render(<LiveRefresh intervalMs={1000} />);
    refresh.mockClear();
    unmount();
    vi.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// The other half. The service worker focused an open tab without navigating, so
// clicking a notification showed a page rendered before the event that produced
// the notification.
describe("the notification click lands on a fresh page", () => {
  const SW = readFileSync(join("public", "sw.js"), "utf8").replace(/\s+/g, " ");

  it("navigates the focused client, not just focuses it", () => {
    expect(SW, "sw.js focuses an existing tab and never reloads it").toMatch(
      /navigate\(target\)/
    );
  });

  it("still falls back to focus where navigate is unavailable", () => {
    expect(SW).toMatch(/"navigate" in client/);
    expect(SW).toMatch(/return client\.focus\(\);/);
  });
});
