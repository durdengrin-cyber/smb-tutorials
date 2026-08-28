// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

describe("component test harness", () => {
  it("renders a component into a DOM and finds it by text", () => {
    render(<Greeting name="Asha" />);
    expect(screen.getByText("Hello Asha")).toBeInTheDocument();
  });
});
