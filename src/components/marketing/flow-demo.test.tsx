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
    expect(screen.getByText(/pick the subject/i)).toBeInTheDocument();
    expect(screen.getByText(/ask a teacher who is online/i)).toBeInTheDocument();
    expect(screen.getByText(/they accept, the lesson starts/i)).toBeInTheDocument();
  });

  // Reported by the owner 2026-09-06: on a desktop the hero rendered as static
  // cards stacked one below another instead of the scroll-driven frame.
  //
  // Root cause, and it is NOT really the breakpoint. The headline is sized off
  // the VIEWPORT (`clamp(2rem,4.6vw,3.6rem)`), which knows nothing about the
  // column it sits in. At 1024px that is ~47px inside a ~450px column, so it
  // wrapped to five lines beside a squeezed frame. e6c4474 treated the symptom
  // by pushing columns AND scroll-driving up to xl (1280px) — which handed
  // every browser window under 1280px the phone fallback, when spec §5.4 says
  // that fallback is for <=880px. A 400px band of desktop widths got a
  // treatment designed for phones.
  //
  // The fix sizes the headline per band, so scroll-driving can engage at lg
  // (1024px) as §5.6's "middle breakpoint" always intended. Asserted against
  // the source because a CSS media query cannot be exercised in jsdom.
  it("engages the scroll-driven hero on laptops, not only above 1280px", () => {
    const src = readFileSync("src/components/marketing/flow-demo.tsx", "utf8");
    expect(src).toMatch(/lg:motion-safe:sticky/);
    expect(src).not.toMatch(/xl:motion-safe:sticky/);
  });

  // The two must never disagree. When columns and scroll-driving engaged at
  // different widths, the frame was squeezed by a layout the script thought
  // was still stacked — the original defect, in a different guise.
  it("turns columns on at the same width it starts driving the scroll", () => {
    const src = readFileSync("src/components/marketing/flow-demo.tsx", "utf8");
    const driveAt = src.match(/(lg|xl):motion-safe:sticky/)?.[1];
    const columnsAt = src.match(/(lg|xl):grid-cols-\[/)?.[1];
    expect(columnsAt).toBe(driveAt);
  });

  // The one that actually bites, and the one the CSS-only check above cannot
  // see. The layout is decided in CSS (a Tailwind breakpoint) and the scene
  // stepping is decided in JS (a matchMedia string). They are two independent
  // declarations of the SAME number, so nothing stops them drifting apart —
  // and when they do, the frame is driven by a script that disagrees with the
  // layout it is driving. That is the defect this component has now shipped
  // twice, in two different guises.
  it("gates the script at the same width the stylesheet does", () => {
    const src = readFileSync("src/components/marketing/flow-demo.tsx", "utf8");
    const TAILWIND = { lg: 1024, xl: 1280 } as const;
    const cssAt = src.match(/(lg|xl):motion-safe:sticky/)?.[1] as keyof typeof TAILWIND;
    expect(cssAt, "no motion-safe sticky class found").toBeTruthy();

    const drive = Number(src.match(/const DRIVE_FROM_PX = (\d+)/)?.[1]);
    expect(drive, "the script's breakpoint constant").toBe(TAILWIND[cssAt]);

    // And no stray hardcoded width may survive beside the constant — that is
    // exactly how the two drifted apart the first time.
    const strays = [...src.matchAll(/max-width:\s*(\d+)px/g)].map((m) => m[1]);
    expect(strays, "hardcoded max-width beside the constant").toEqual([]);
  });

  // Chosen by the owner 2026-09-06 after reporting that the phone hero was
  // four static screenshots in a pile. Most traffic arrives from a WhatsApp
  // tap on a phone, so this is the surface that matters most and it had the
  // least considered treatment.
  //
  // The rule the spec sets for the desktop hero applies here too: scroll
  // POSITION drives the scenes, scroll SPEED is never touched. So no sticky,
  // no height track, no hijack — the panels stay stacked and the step track
  // and the URL follow whichever panel you have scrolled to.
  it("lights the matching step as each panel scrolls into view on a phone", () => {
    vi.stubGlobal("matchMedia", mqlFor({ "max-width": true, "reduced-motion": false }));
    const io = stubIntersectionObserver();
    render(<FlowDemo />);

    // One observer entry per panel — the panels are what a phone scrolls past.
    expect(io.observed.length).toBe(4);

    // Scrolling the third panel into view must move the chrome URL onto the
    // route that panel actually depicts.
    act(() => io.enter(io.observed[2]));
    expect(screen.getByText("smbtutorials.com/waiting")).toBeInTheDocument();
  });

  // The accessibility contract is unchanged: someone who asked for less motion
  // gets the plain stack, and nothing observes anything.
  it("observes nothing when the viewer asked to reduce motion", () => {
    vi.stubGlobal("matchMedia", mqlFor({ "max-width": true, "reduced-motion": true }));
    const io = stubIntersectionObserver();
    render(<FlowDemo />);
    expect(io.observed.length).toBe(0);
  });
});
