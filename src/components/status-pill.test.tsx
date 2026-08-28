// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill, STATUS_COPY, type TeacherStatus } from "./status-pill";

const ALL: TeacherStatus[] = ["offline", "available", "in_session", "unreachable"];

describe("StatusPill", () => {
  it("renders a label for every status", () => {
    for (const status of ALL) {
      const { unmount } = render(<StatusPill status={status} />);
      expect(screen.getByText(STATUS_COPY[status].label)).toBeInTheDocument();
      unmount();
    }
  });

  it("distinguishes 'in a session' from 'offline'", () => {
    // The teacher is hidden from students but still intends to be available;
    // calling it Offline would invite them to toggle back on mid-session.
    expect(STATUS_COPY.in_session.label).not.toBe(STATUS_COPY.offline.label);
  });

  it("tells an unreachable teacher what is wrong", () => {
    // Step 2 activates this state. The copy must say the device cannot be
    // reached, not that the teacher is offline — the lie is the defect.
    expect(STATUS_COPY.unreachable.description.toLowerCase()).toContain("reach");
  });

  it("gives every status a distinct tone", () => {
    const tones = ALL.map((s) => STATUS_COPY[s].tone);
    expect(new Set(tones).size).toBe(tones.length);
  });
});
