// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
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


// The existing mql() answers every query the same way, which cannot express
// "narrow AND motion is fine" — the phone case. This one answers per query.
const mqlFor = (answers: Record<string, boolean>) =>
  vi.fn().mockImplementation((q: string) => ({
    matches: Object.entries(answers).some(([k, v]) => q.includes(k) && v),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));

// jsdom has no IntersectionObserver. Capture the callback so a test can drive
// it, the way a real phone scroll would.
function stubIntersectionObserver() {
  const observed: Element[] = [];
  let cb: IntersectionObserverCallback | undefined;
  class IO {
    constructor(c: IntersectionObserverCallback) {
      cb = c;
    }
    observe(el: Element) {
      observed.push(el);
    }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("IntersectionObserver", IO);
  return {
    observed,
    enter: (el: Element) =>
      cb?.(
        [{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver
      ),
  };
}

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
    // The phone's compact progress row repeats the CURRENT step's title, so
    // that one title is legitimately in the DOM twice. It carries aria-hidden,
    // so assistive tech still reads the list once — asserted below.
    expect(screen.getAllByText(/pick the subject/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/ask a teacher who is online/i)).toBeInTheDocument();
    expect(screen.getByText(/they accept, the lesson starts/i)).toBeInTheDocument();
  });

  it("does not read the step name twice to a screen reader", () => {
    const { container } = render(<FlowDemo />);
    const compact = container.querySelector("[aria-hidden]");
    expect(compact, "the compact progress row must be aria-hidden").toBeTruthy();
  });

  // Owner's call, 2026-09-06, revised: pin and cross-fade on the phone too,
  // the same as the desktop. The spec's "miserable on a small screen" was
  // overcautious — what makes mobile sticky miserable is 100vh, not pinning.
  //
  // The scroll-linked IntersectionObserver build that briefly lived here is
  // superseded: there is one behaviour on every width now, gated only on the
  // motion preference.
  it("pins and drives the hero on a phone, not only on a laptop", () => {
    const src = readFileSync("src/components/marketing/flow-demo.tsx", "utf8");
    // motion-safe, with no width prefix in front of it.
    expect(src).toMatch(/(?<!lg:)(?<!xl:)motion-safe:sticky/);
    expect(src).not.toMatch(/lg:motion-safe:sticky/);
  });

  // THE mobile sticky bug. 100vh on a phone is the viewport with the address
  // bar hidden; the bar hides and shows as you scroll, so a pinned pane
  // measured in vh changes height mid-scroll and visibly jumps. dvh tracks the
  // viewport as it actually is.
  it("measures the pinned pane in dvh, so the address bar cannot make it jump", () => {
    const src = readFileSync("src/components/marketing/flow-demo.tsx", "utf8");
    expect(src).toMatch(/dvh/);
    expect(src, "100vh in a pinned pane is the mobile address-bar bug").not.toMatch(
      /min-h-\[calc\(100vh/
    );
  });

  // The accessibility contract is unchanged and is now the ONLY gate.
  it("keeps the plain stack when the viewer asked to reduce motion", () => {
    vi.stubGlobal("matchMedia", mqlFor({ "reduced-motion": true }));
    const { container } = render(<FlowDemo />);
    expect(container.querySelector("[data-flow]")?.getAttribute("data-ready")).toBe(
      "false"
    );
  });

  // The bug this replaced: the stylesheet was changed to pin at every width
  // while the script still bailed out below 1024px, so a phone would pin a
  // frame and then refuse to advance it. There is now exactly ONE gate, and a
  // width query in this file would mean a second one has come back.
  it("gates the hero on the motion preference alone, never on width", () => {
    const src = readFileSync("src/components/marketing/flow-demo.tsx", "utf8");
    expect(src).toMatch(/prefers-reduced-motion/);
    expect(src, "a width media query means a second gate is back").not.toMatch(
      /matchMedia\([^)]*(max-width|min-width)/
    );
    expect(src, "no hardcoded breakpoint constant should survive").not.toMatch(
      /max-width:\s*\d+px/
    );
  });
});
