// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";
import type { Identity } from "@/lib/auth";

const identity = (role: Identity["role"]): Identity => ({
  userId: "u1",
  role,
  fullName: "Test Person",
  consentVersion: null,
});

describe("AppShell", () => {
  // Reported twice by the owner — 2026-09-04 and again 2026-09-06. The logo
  // pointed at /home, which is a RESOLVER, not a page: it redirects by role.
  // So a student on /sessions clicking the logo went /home -> /sessions, and a
  // teacher on /dashboard went /home -> /dashboard. A no-op for both roles,
  // and there was no route back to the landing page from anywhere in the
  // signed-in shell.
  //
  // The landing page is safe to send a signed-in visitor to: MarketingHeader
  // takes a `signedIn` prop and renders "Go to your dashboard" instead of
  // "Sign in", so the round trip works in both directions.
  it.each(["student", "teacher"] as const)(
    "gives a signed-in %s a way back to the landing page",
    (role) => {
      render(<AppShell identity={identity(role)}>content</AppShell>);
      const home = screen
        .getAllByRole("link")
        .filter((a) => a.getAttribute("href") === "/");
      expect(home.length).toBeGreaterThan(0);
    }
  );

  // The logo specifically, because that is the control every user reaches for
  // and the one the signed-out header already wires to "/".
  it("wires the logo itself to the landing page, not to the role resolver", () => {
    render(<AppShell identity={identity("student")}>content</AppShell>);
    const logo = screen.getByText("SMB").closest("a");
    expect(logo?.getAttribute("href")).toBe("/");
  });
});
