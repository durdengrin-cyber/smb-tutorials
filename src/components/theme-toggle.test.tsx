// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// fireEvent, not user-event: @testing-library/user-event is not installed and
// the rest of this repo's component tests use fireEvent. Same reasoning as
// sign-out-button.test.tsx.
const state = vi.hoisted(() => ({
  theme: "dark" as string,
  setTheme: vi.fn(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: state.theme, setTheme: state.setTheme }),
}));

import { ThemeToggle } from "./theme-toggle";

beforeEach(() => {
  state.theme = "dark";
  state.setTheme = vi.fn();
});

describe("ThemeToggle", () => {
  // The control names the theme you will GET, not the one you are in. A button
  // labelled with the current theme reads as a status display, and people do
  // not press status displays.
  it("offers the theme you are not in", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /light/i })).toBeInTheDocument();
  });

  it("offers dark when the resolved theme is light", () => {
    state.theme = "light";
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
  });

  it("switches to the other theme when pressed", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(state.setTheme).toHaveBeenCalledWith("light");
  });

  // resolvedTheme, never theme: "system" is a real value of `theme`, and a
  // control offering to "switch to system" tells nobody what they will see.
  it("resolves a system preference to a concrete choice", () => {
    state.theme = "light";
    render(<ThemeToggle />);
    expect(
      screen.getByRole("button", { name: /switch to dark/i })
    ).toBeInTheDocument();
  });
});
