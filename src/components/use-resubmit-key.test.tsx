// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { useResubmitKey } from "./use-resubmit-key";

// A <select> does not recover from React 19's post-action form reset the way
// text inputs and checkboxes do: reset() restores each control to its default,
// and a select's default is whichever <option> carries the `selected`
// attribute — set when the select mounts, and never moved afterwards. Changing
// the key remounts it, which is what makes React apply the new default.
//
// Verified in a browser on 2026-09-09: before this, a rejected tutor
// application came back with fullName and the curriculum chips intact but
// teachingLevel and hoursPerWeek blank.
function Harness() {
  const [state, setState] = useState<object | null>(null);
  const key = useResubmitKey(state);
  return (
    <div>
      <span data-testid="key">{key}</span>
      <button onClick={() => setState({})}>new result</button>
      <button onClick={() => setState(state)}>same result</button>
    </div>
  );
}

describe("useResubmitKey", () => {
  const key = () => screen.getByTestId("key").textContent;

  it("starts at zero", () => {
    render(<Harness />);
    expect(key()).toBe("0");
  });

  it("changes every time the action returns a new result", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("new result"));
    expect(key()).toBe("1");
    fireEvent.click(screen.getByText("new result"));
    expect(key()).toBe("2");
  });

  // Two identical rejections in a row are the case that a value-derived key
  // would get wrong: the select still needs remounting the second time,
  // because the reset happened again.
  it("changes even when two results are equal in value", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("new result"));
    fireEvent.click(screen.getByText("new result"));
    expect(key()).toBe("2");
  });

  it("does not change when the same object identity is re-set", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("same result"));
    expect(key()).toBe("0");
  });
});
