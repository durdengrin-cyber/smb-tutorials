import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  // reportSession now goes through requireConsentedUser(), which reads this
  // via getIdentity()'s profiles select. Defaulted to the current version so
  // every pre-existing test keeps exercising the same signed-in-and-allowed
  // caller it always did; the consent gate itself is covered separately.
  consentVersion: "" as string | null,
  insertError: null as null | { message: string; code?: string; details?: string },
  inserted: [] as unknown[],
  // What the post-insert `sessions` lookup finds for the reported session —
  // null means "no teacher on this row" (or the row wasn't found), which the
  // conduct-report cleanup treats as nothing to settle.
  reportedTeacherId: null as string | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: state.user
                  ? {
                      id: state.user.id,
                      role: "student",
                      full_name: "Test Student",
                      consent_version: state.consentVersion,
                    }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "sessions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: state.reportedTeacherId
                  ? { teacher_id: state.reportedTeacherId }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        insert: async (row: unknown) => {
          state.inserted.push(row);
          return { error: state.insertError };
        },
      };
    },
  }),
}));

const reportErrorMock = vi.fn();
vi.mock("@/lib/observability/report", () => ({
  reportError: (...a: unknown[]) => reportErrorMock(...a),
}));

const settleSuspensionMock = vi.fn();
vi.mock("@/lib/suspension/settle", () => ({
  settleSuspension: (...a: unknown[]) => settleSuspensionMock(...a),
}));

import { reportSession } from "./actions";
import { REPORT_REASONS } from "./reasons";
import { CONSENT_VERSION } from "@/lib/consent";

beforeEach(() => {
  state.user = { id: "student-1" };
  state.consentVersion = CONSENT_VERSION;
  state.insertError = null;
  state.inserted = [];
  state.reportedTeacherId = null;
  reportErrorMock.mockReset();
  settleSuspensionMock.mockReset();
  settleSuspensionMock.mockResolvedValue(false);
});

describe("reportSession", () => {
  it("refuses when nobody is signed in", async () => {
    state.user = null;
    expect(await reportSession({ sessionId: "s1", reason: "conduct", detail: "" }))
      .toEqual({ error: "Sign in first." });
    expect(state.inserted).toHaveLength(0);
  });

  // The hole this closes: a Server Action is dispatched by ID and runs before
  // any page renders, so requireUser()'s redirect to /consent never applies
  // to this call — a signed-in-but-unconsented account could otherwise file
  // a report with no requireUser() gate anywhere in the way.
  it("refuses a signed-in account that has not consented", async () => {
    state.consentVersion = null;
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
  //
  // This also pins spec §5's privacy promise: the reporter's free text must
  // never leave the table, including into the observability layer on the
  // failure path. `detail` carries distinctive text below and the assertion
  // checks the raw insert error (which Postgres would put it inside, via
  // `error.details`'s "Failing row contains (…)") never reaches reportError —
  // this product's users include children, and a safety report must never be
  // mirrored into an error dashboard.
  it("reports the failure and tells the user when the insert fails", async () => {
    state.insertError = {
      message: "db down",
      code: "23514",
      details: 'Failing row contains (…, THIS-CHILD-SAFETY-TEXT-MUST-NOT-LEAK, …).',
    };
    const r = await reportSession({
      sessionId: "s1",
      reason: "conduct",
      detail: "THIS-CHILD-SAFETY-TEXT-MUST-NOT-LEAK",
    });
    expect("error" in r).toBe(true);
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ where: "reportSession.insert", sessionId: "s1", reason: "conduct" })
    );
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ detail: expect.anything() })
    );
    // Check the actual call args directly, not a JSON.stringify of them —
    // Error.message is a non-enumerable own property, so JSON.stringify(err)
    // silently produces "{}" and would let a leak through the Error itself
    // go unnoticed here.
    const [calledError, calledContext] = reportErrorMock.mock.calls[0];
    expect((calledError as Error).message).not.toContain("THIS-CHILD-SAFETY-TEXT-MUST-NOT-LEAK");
    expect((calledError as Error).message).not.toContain("db down");
    expect(JSON.stringify(calledContext)).not.toContain("THIS-CHILD-SAFETY-TEXT-MUST-NOT-LEAK");
    expect(JSON.stringify(calledContext)).not.toContain("db down");
  });

  // Alerting is the whole point: a report that only lands in a table nobody
  // watches is not a safety mechanism (spec §5). Same privacy pin as above,
  // on the success path: the reporter's free text must never reach Sentry.
  it("raises an alert on a successful report too, without the reporter's text", async () => {
    await reportSession({
      sessionId: "s1",
      reason: "conduct",
      detail: "ANOTHER-CHILD-SAFETY-TEXT-MUST-NOT-LEAK",
    });
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ where: "session-report", sessionId: "s1", reason: "conduct" })
    );
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ detail: expect.anything() })
    );
    const [calledError, calledContext] = reportErrorMock.mock.calls[0];
    expect((calledError as Error).message).not.toContain("ANOTHER-CHILD-SAFETY-TEXT-MUST-NOT-LEAK");
    expect(JSON.stringify(calledContext)).not.toContain("ANOTHER-CHILD-SAFETY-TEXT-MUST-NOT-LEAK");
  });

  it("exposes the six reasons the constraint allows", () => {
    expect([...REPORT_REASONS]).toEqual([
      "no_show", "left_early", "technical", "teaching_quality", "conduct", "other",
    ]);
  });

  // The fast path (Task 4): best-effort cleanup so a suspended teacher's
  // other in-flight sessions don't wait on the guaranteed passes if the
  // reporter's own browser dies right after filing.
  it("settles the reported teacher's suspension after a conduct report", async () => {
    state.reportedTeacherId = "teacher-9";
    const r = await reportSession({ sessionId: "s1", reason: "conduct", detail: "" });
    expect(r).toEqual({ ok: true });
    expect(settleSuspensionMock).toHaveBeenCalledWith("teacher-9");
  });

  it("does not settle anything for a non-conduct report", async () => {
    state.reportedTeacherId = "teacher-9";
    await reportSession({ sessionId: "s1", reason: "technical", detail: "" });
    expect(settleSuspensionMock).not.toHaveBeenCalled();
  });

  it("does not settle when the reported session carries no teacher", async () => {
    state.reportedTeacherId = null;
    await reportSession({ sessionId: "s1", reason: "conduct", detail: "" });
    expect(settleSuspensionMock).not.toHaveBeenCalled();
  });

  // A reporter's browser only needs the report itself to succeed — the
  // cleanup is guaranteed elsewhere (the dashboard, the waiting page), so a
  // failure here must not turn a filed report into an error response.
  it("still returns ok when settleSuspension throws", async () => {
    state.reportedTeacherId = "teacher-9";
    settleSuspensionMock.mockRejectedValue(new Error("service role unavailable"));
    const r = await reportSession({ sessionId: "s1", reason: "conduct", detail: "" });
    expect(r).toEqual({ ok: true });
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ where: "reportSession.settle", sessionId: "s1" })
    );
  });
});
