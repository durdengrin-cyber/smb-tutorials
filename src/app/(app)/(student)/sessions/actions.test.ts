import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  insertError: null as null | { message: string },
  inserted: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      insert: async (row: unknown) => {
        state.inserted.push(row);
        return { error: state.insertError };
      },
    }),
  }),
}));

const reportErrorMock = vi.fn();
vi.mock("@/lib/observability/report", () => ({
  reportError: (...a: unknown[]) => reportErrorMock(...a),
}));

import { reportSession } from "./actions";
import { REPORT_REASONS } from "./reasons";

beforeEach(() => {
  state.user = { id: "student-1" };
  state.insertError = null;
  state.inserted = [];
  reportErrorMock.mockReset();
});

describe("reportSession", () => {
  it("refuses when nobody is signed in", async () => {
    state.user = null;
    expect(await reportSession({ sessionId: "s1", reason: "conduct", detail: "" }))
      .toEqual({ error: "Sign in first." });
    expect(state.inserted).toHaveLength(0);
  });

  // The reason list is a check constraint in 0016. Sending an unknown value
  // would fail at the database with an opaque error; refuse it here instead.
  it("refuses a reason outside the fixed list", async () => {
    const r = await reportSession({ sessionId: "s1", reason: "whatever", detail: "" });
    expect("error" in r).toBe(true);
    expect(state.inserted).toHaveLength(0);
  });

  it("writes the report with the caller as reporter", async () => {
    const r = await reportSession({ sessionId: "s1", reason: "conduct", detail: " worried " });
    expect(r).toEqual({ ok: true });
    expect(state.inserted[0]).toEqual({
      session_id: "s1",
      reporter_id: "student-1",
      reason: "conduct",
      detail: "worried",
    });
  });

  it("stores null rather than an empty string when no detail is given", async () => {
    await reportSession({ sessionId: "s1", reason: "technical", detail: "   " });
    expect(state.inserted[0]).toMatchObject({ detail: null });
  });

  // A safety report that fails silently is the worst outcome this feature has:
  // the reporter believes they have been heard and nobody has been told.
  it("reports the failure and tells the user when the insert fails", async () => {
    state.insertError = { message: "db down" };
    const r = await reportSession({ sessionId: "s1", reason: "conduct", detail: "" });
    expect("error" in r).toBe(true);
    expect(reportErrorMock).toHaveBeenCalled();
  });

  // Alerting is the whole point: a report that only lands in a table nobody
  // watches is not a safety mechanism (spec §5).
  it("raises an alert on a successful report too", async () => {
    await reportSession({ sessionId: "s1", reason: "conduct", detail: "" });
    expect(reportErrorMock).toHaveBeenCalled();
  });

  it("exposes the six reasons the constraint allows", () => {
    expect([...REPORT_REASONS]).toEqual([
      "no_show", "left_early", "technical", "teaching_quality", "conduct", "other",
    ]);
  });
});
