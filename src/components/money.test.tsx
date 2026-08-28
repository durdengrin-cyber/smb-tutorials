// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Money, formatPaise } from "./money";

describe("formatPaise", () => {
  it("renders whole rupees", () => {
    expect(formatPaise(50000)).toBe("₹500");
  });

  it("rounds to the nearest rupee", () => {
    expect(formatPaise(50049)).toBe("₹500");
    expect(formatPaise(50050)).toBe("₹501");
  });

  it("handles zero", () => {
    expect(formatPaise(0)).toBe("₹0");
  });
});

describe("Money", () => {
  it("renders the formatted amount", () => {
    render(<Money paise={50000} />);
    expect(screen.getByText("₹500")).toBeInTheDocument();
  });
});
