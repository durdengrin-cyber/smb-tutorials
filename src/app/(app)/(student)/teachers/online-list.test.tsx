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

import { outcomeMessage, pinFirst } from "./online-list";

describe("outcomeMessage", () => {
  it("explains a teacher-unavailable cancellation without mentioning a report", () => {
    render(<div data-testid="m">{outcomeMessage("teacher_unavailable", "Ms Rao", 50000)}</div>);
    const text = screen.getByTestId("m").textContent ?? "";
    expect(text).toMatch(/no longer available/i);
    // The student must not learn that a report exists — that is a disclosure
    // about a third party's complaint.
    expect(text).not.toMatch(/report|suspend|review/i);
  });

  // The reachable case in production: settleSuspension's pending/accepted
  // cancel branch (src/lib/suspension/settle.ts) stamps cancellation_reason
  // without ever touching refund_ref, because no money moved. See
  // waiting/[sessionId]/page.tsx, which now only attaches an amount when the
  // session actually carries a refund_ref.
  it("says the student was not charged when no refund travelled", () => {
    render(<div data-testid="m">{outcomeMessage("teacher_unavailable", "Ms Rao", undefined)}</div>);
    expect(screen.getByTestId("m").textContent).toMatch(/not been charged/i);
  });
});

// ---------------------------------------------------------------------------
// "Book X again", arriving from a row in /sessions.
//
// Every listed row is tappable regardless of how that session ended. Why a
// lesson did not happen is not ours to interpret: a failed payment, a parent
// who changed their mind and a teacher who declined are indistinguishable from
// the history page, and in each case wanting that teacher again is the
// parent's call. (Rows that never touched money are filtered out of /sessions
// entirely, so "every row" is every row a parent can see.)
// ---------------------------------------------------------------------------
describe("book again", () => {
  it("puts the requested teacher first without reordering anyone else", () => {
    const list = ["a", "b", "c", "d"].map((id) => ({ id }));
    expect(pinFirst(list, "c").map((t) => t.id)).toEqual(["c", "a", "b", "d"]);
  });

  // deriveRoster's order is a safety property: it ranks live-presence teachers
  // above push-only ones and refuses to LABEL the two, because a visible
  // second tier would stop push-only teachers being picked at all (spec 6.2).
  // Pinning one teacher the parent named says nothing about anybody else.
  it("leaves the relative order of everyone else untouched", () => {
    const list = ["a", "b", "c", "d"].map((id) => ({ id }));
    expect(pinFirst(list, "b").slice(1).map((t) => t.id)).toEqual(["a", "c", "d"]);
  });

  it("returns the list untouched when nothing is requested", () => {
    const list = ["a", "b"].map((id) => ({ id }));
    expect(pinFirst(list, undefined)).toBe(list);
  });

  // The id arrives from a query string and is only ever compared against ids
  // already fetched for this page, so a junk or hostile value matches nothing
  // and the list renders exactly as it would without it.
  it.each(["../../etc/passwd", "", "not-a-real-id"])(
    "ignores %o, which is in no list",
    (bad) => {
      const list = ["a", "b"].map((id) => ({ id }));
      expect(pinFirst(list, bad).map((t) => t.id)).toEqual(["a", "b"]);
    }
  );

  it("is a no-op when the requested teacher is already first", () => {
    const list = ["a", "b"].map((id) => ({ id }));
    expect(pinFirst(list, "a").map((t) => t.id)).toEqual(["a", "b"]);
  });
});
