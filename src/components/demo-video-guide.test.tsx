// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DemoVideoGuide } from "./demo-video-guide";

// The guide replaced a block of instruction text that was always fully
// visible. A carousel only shows one step at a time, so the things worth
// pinning are that every step is still REACHABLE, and that the three ways in
// (buttons, dots, swipe) agree with each other.
describe("DemoVideoGuide", () => {
  const stepText = () => screen.getByText(/Step \d of 4:/).textContent;

  it("starts on the first step with Back unavailable", () => {
    render(<DemoVideoGuide />);
    expect(stepText()).toMatch(/Step 1 of 4/);
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("walks forward through every step and stops at the last", () => {
    render(<DemoVideoGuide />);
    const next = screen.getByRole("button", { name: "Next" });
    for (const n of [2, 3, 4]) {
      fireEvent.click(next);
      expect(stepText()).toMatch(new RegExp(`Step ${n} of 4`));
    }
    expect(next).toBeDisabled();
  });

  it("walks back again", () => {
    render(<DemoVideoGuide />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(stepText()).toMatch(/Step 1 of 4/);
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("jumps straight to a step from its dot", () => {
    render(<DemoVideoGuide />);
    fireEvent.click(
      screen.getByRole("button", { name: /^Step 3: Set visibility to Unlisted/ })
    );
    expect(stepText()).toMatch(/Step 3 of 4/);
  });

  // The instruction the whole form depends on: a teacher who never reaches
  // step 4 does not learn that Share -> Copy is what produces the link.
  it("reaches the paste instruction, which is the point of the form", () => {
    render(<DemoVideoGuide />);
    const next = screen.getByRole("button", { name: "Next" });
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    // The title also appears in the live-region announcement, so assert on
    // the body copy, which is unique to the panel.
    expect(screen.getByText(/Press Share, then Copy/)).toBeInTheDocument();
    expect(screen.getByText(/youtu\.be/)).toBeInTheDocument();
  });

  it("advances on a left swipe and returns on a right swipe", () => {
    render(<DemoVideoGuide />);
    const region = screen.getByRole("region");
    const swipe = (from: number, to: number) => {
      fireEvent.touchStart(region, { touches: [{ clientX: from }] });
      fireEvent.touchEnd(region, { changedTouches: [{ clientX: to }] });
    };
    swipe(200, 100);
    expect(stepText()).toMatch(/Step 2 of 4/);
    swipe(100, 200);
    expect(stepText()).toMatch(/Step 1 of 4/);
  });

  // A vertical scroll that drifts sideways must not flip the card underneath
  // the reader's thumb.
  it("ignores a drag too short to be a swipe", () => {
    render(<DemoVideoGuide />);
    const region = screen.getByRole("region");
    fireEvent.touchStart(region, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(region, { changedTouches: [{ clientX: 175 }] });
    expect(stepText()).toMatch(/Step 1 of 4/);
  });

  it("moves with the arrow keys", () => {
    render(<DemoVideoGuide />);
    const region = screen.getByRole("region");
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(stepText()).toMatch(/Step 2 of 4/);
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(stepText()).toMatch(/Step 1 of 4/);
  });

  it("hides the steps that are off screen from assistive tech", () => {
    const { container } = render(<DemoVideoGuide />);
    const panels = container.querySelectorAll("[aria-hidden]");
    // Three of the four are hidden; the visible one carries aria-hidden="false".
    expect([...panels].filter((p) => p.getAttribute("aria-hidden") === "true")).toHaveLength(3);
  });
});
