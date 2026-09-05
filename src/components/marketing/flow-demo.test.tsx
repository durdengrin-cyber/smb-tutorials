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
  it("renders every panel so the fallback is never blank", () => {
    render(<FlowDemo />);
    expect(screen.getByText(/what is your child stuck on/i)).toBeInTheDocument();
    expect(screen.getByText(/online right now/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for/i)).toBeInTheDocument();
    expect(screen.getAllByText(/R\. Azad/).length).toBeGreaterThan(0);
  });

  // The online list must exist EXACTLY once. It was briefly built as two
  // panels — the list, and the list with a row highlighted — which cross-faded
  // into each other at the boundary. Fading a screen out and back into an
  // almost identical screen reads as a glitch, not as a row being chosen.
  // Choosing a row is a highlight on one row, not a new screen.
  it("does not duplicate the online list into two panels", () => {
    render(<FlowDemo />);
    expect(screen.getAllByText(/online right now/i)).toHaveLength(1);
    expect(screen.getAllByText(/S\. Kulkarni/)).toHaveLength(1);
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

  // Every step in the track must have a screen of its own. Step 1 briefly had
  // none — "Pick the subject" showed the teacher list, so steps 1 and 2 looked
  // identical and the card appeared not to advance.
  it("gives the first step a screen of its own", () => {
    render(<FlowDemo />);
    // The picker, not the teacher list.
    expect(screen.getByText(/what is your child stuck on/i)).toBeInTheDocument();
    expect(screen.getByText("Curriculum".toUpperCase())).toBeInTheDocument();
  });

  it("names the three steps it walks through", () => {
    render(<FlowDemo />);
    expect(screen.getByText(/pick the subject/i)).toBeInTheDocument();
    expect(screen.getByText(/ask a teacher who is online/i)).toBeInTheDocument();
    expect(screen.getByText(/they accept, the lesson starts/i)).toBeInTheDocument();
  });
});
