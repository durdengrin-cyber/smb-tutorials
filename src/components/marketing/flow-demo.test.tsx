// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FlowDemo } from "./flow-demo";

const mql = (matches: boolean) =>
  vi.fn().mockImplementation(() => ({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));

beforeEach(() => {
  vi.stubGlobal("matchMedia", mql(false));
});

describe("FlowDemo", () => {
  // Everyone on a phone, everyone with reduced motion, and everyone before JS
  // runs sees the fallback. All four scenes must be in the DOM and readable —
  // never an empty frame waiting for a scroll that will not come.
  it("renders every scene so the fallback is never blank", () => {
    render(<FlowDemo />);
    // Scenes 0 and 1 are the same screen, one with a row highlighted, so this
    // heading legitimately appears twice.
    expect(screen.getAllByText(/online right now/i).length).toBe(2);
    expect(screen.getByText(/waiting for/i)).toBeInTheDocument();
    expect(screen.getAllByText(/R\. Azad/).length).toBeGreaterThan(0);
  });

  // The stacked fallback is the DEFAULT state, not something JS falls back to.
  // Anyone who has asked their OS to reduce motion keeps it, and the component
  // must never opt them into scroll-driven scenes.
  it("keeps the fallback when the viewer asked to reduce motion", () => {
    vi.stubGlobal("matchMedia", mql(true));
    const { container } = render(<FlowDemo />);
    expect(container.querySelector("[data-flow]")).toHaveAttribute(
      "data-ready",
      "false"
    );
  });

  // The mirror of the above: with no reason to hold back, the scroll behaviour
  // switches on. Without this, a component that never became ready would pass
  // the reduced-motion test and ship dead.
  it("opts in when there is no reason to hold back", () => {
    const { container } = render(<FlowDemo />);
    expect(container.querySelector("[data-flow]")).toHaveAttribute(
      "data-ready",
      "true"
    );
  });

  it("names the three steps it walks through", () => {
    render(<FlowDemo />);
    expect(screen.getByText(/pick the subject/i)).toBeInTheDocument();
    expect(screen.getByText(/ask a teacher who is online/i)).toBeInTheDocument();
    expect(screen.getByText(/they accept, the lesson starts/i)).toBeInTheDocument();
  });
});
