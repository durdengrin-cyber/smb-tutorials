// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const reportSession = vi.fn();
// Only the action is mocked. REPORT_REASONS comes from reasons.ts, which is a
// plain module and needs no mock.
vi.mock("./actions", () => ({ reportSession: (i: unknown) => reportSession(i) }));

import { ReportButton } from "./report-button";

beforeEach(() => reportSession.mockReset().mockResolvedValue({ ok: true }));

describe("ReportButton", () => {
  it("does not show the form until asked", () => {
    render(<ReportButton sessionId="s1" />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("sends the chosen reason and detail", async () => {
    render(<ReportButton sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /report a problem/i }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "conduct" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "worried" } });
    fireEvent.click(screen.getByRole("button", { name: /^send report$/i }));

    await waitFor(() =>
      expect(reportSession).toHaveBeenCalledWith({
        sessionId: "s1", reason: "conduct", detail: "worried",
      })
    );
  });

  // The reporter must be told it landed. Silence after reporting a concern
  // about a child is the failure this whole path exists to avoid.
  it("confirms when the report is sent", async () => {
    render(<ReportButton sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /report a problem/i }));
    fireEvent.click(screen.getByRole("button", { name: /^send report$/i }));
    await waitFor(() => expect(screen.getByText(/thank you/i)).toBeInTheDocument());
  });

  it("shows the error and leaves the form usable when sending fails", async () => {
    reportSession.mockResolvedValue({ error: "Couldn't send that report — please try again." });
    render(<ReportButton sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /report a problem/i }));
    fireEvent.click(screen.getByRole("button", { name: /^send report$/i }));

    await waitFor(() => expect(screen.getByText(/couldn't send that report/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^send report$/i })).not.toBeDisabled();
  });
});
