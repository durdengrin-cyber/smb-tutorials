// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// online-list.tsx imports requestSession from ./actions at module scope,
// which chains into @/lib/observability/report -> @sentry/nextjs — real
// Sentry does not load cleanly under vitest's module transform (its webpack
// orchestrion probes import.meta.url and finds a non-file URL). These tests
// only exercise the pure outcomeMessage function, never requestSession, so
// stub the module rather than pull that chain in for nothing.
vi.mock("./actions", () => ({ requestSession: vi.fn() }));

import { outcomeMessage } from "./online-list";

describe("outcomeMessage", () => {
  it("explains a teacher-unavailable cancellation without mentioning a report", () => {
    render(<div data-testid="m">{outcomeMessage("teacher_unavailable", "Ms Rao", 50000)}</div>);
    const text = screen.getByTestId("m").textContent ?? "";
    expect(text).toMatch(/no longer available/i);
    // The student must not learn that a report exists — that is a disclosure
    // about a third party's complaint.
    expect(text).not.toMatch(/report|suspend|review/i);
  });

  it("says the student was not charged when no refund travelled", () => {
    render(<div data-testid="m">{outcomeMessage("teacher_unavailable", "Ms Rao", undefined)}</div>);
    expect(screen.getByTestId("m").textContent).toMatch(/not been charged/i);
  });
});
