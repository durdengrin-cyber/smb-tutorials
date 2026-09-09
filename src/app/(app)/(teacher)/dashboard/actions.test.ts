import { describe, it, expect, vi, beforeEach } from "vitest";
import { CONSENT_VERSION } from "@/lib/consent";

const upsert = vi.fn();
const maybeSingle = vi.fn();
// declareAvailable/renewLease now resolve identity through requireConsentedUser(),
// which reads this via getIdentity()'s profiles select. Defaults to the
// current version so every pre-existing test keeps exercising the same
// signed-in-and-allowed teacher it always did; the consent gate itself gets
// its own tests below.
let consentVersion: string | null = CONSENT_VERSION;
let vettingState: string = "cleared";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "t1" } } }) },
    rpc: async (name: string) => {
      if (name === "my_vetting_state") {
        return { data: vettingState, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: "t1", role: "teacher", full_name: "Teacher", consent_version: consentVersion },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        upsert: (...a: unknown[]) => { upsert(...a); return { select: () => ({ single: async () => ({ data: { declared_until: "2026-08-30T14:00:00Z" }, error: null }) }) }; },
        select: () => ({ eq: () => ({ maybeSingle }) }),
      };
    },
  }),
}));

beforeEach(() => {
  upsert.mockClear();
  maybeSingle.mockReset();
  consentVersion = CONSENT_VERSION;
  vettingState = "cleared";
});

describe("declareAvailable", () => {
  it("writes a lease four hours out and returns it", async () => {
    const { declareAvailable } = await import("./actions");
    const result = await declareAvailable();
    expect(result).toEqual({ declaredUntil: "2026-08-30T14:00:00Z" });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ teacher_id: "t1", declared: true }),
      expect.objectContaining({ onConflict: "teacher_id" })
    );
  });

  // The hole this closes: a Server Action is dispatched by ID and runs before
  // any page renders, so requireUser()'s redirect to /consent never applies
  // to this call — a signed-in-but-unconsented teacher could otherwise
  // declare themselves available (and be pushed real session requests) with
  // no requireUser() gate anywhere in the way.
  it("refuses a signed-in teacher who has not consented", async () => {
    consentVersion = null;
    const { declareAvailable } = await import("./actions");
    expect(await declareAvailable()).toEqual({ error: "Sign in to go available." });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("renewLease", () => {
  let THREE_HOURS_OUT = "";
  let LAPSED = "";

  it("does nothing when more than half the lease remains", async () => {
    // A renewal on every mount is the write storm the lease exists to avoid.
    THREE_HOURS_OUT = new Date(Date.now() + 3 * 3600_000).toISOString();
    maybeSingle.mockResolvedValue({
      data: { declared: true, declared_until: THREE_HOURS_OUT },
      error: null,
    });
    const { renewLease } = await import("./actions");
    // No WRITE, but still the authoritative lease — the tick reconciles as
    // well as renews, so a client is corrected on every tick rather than only
    // when a write happens to occur.
    expect(await renewLease()).toEqual({ declaredUntil: THREE_HOURS_OUT });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("renews when under half remains", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        declared: true,
        declared_until: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
      error: null,
    });
    const { renewLease } = await import("./actions");
    expect(await renewLease()).toEqual({ declaredUntil: "2026-08-30T14:00:00Z" });
    expect(upsert).toHaveBeenCalled();
  });

  it("does not resurrect a lapsed declaration", async () => {
    // Going available again is a fresh decision by the teacher.
    LAPSED = new Date(Date.now() - 60_000).toISOString();
    maybeSingle.mockResolvedValue({
      data: { declared: true, declared_until: LAPSED },
      error: null,
    });
    const { renewLease } = await import("./actions");
    // Still no write — but the honest answer is the past timestamp, which the
    // client renders as Offline. Returning "nothing to do" here would let a
    // client that believes it is live keep believing it.
    expect(await renewLease()).toEqual({ declaredUntil: LAPSED });
    expect(upsert).not.toHaveBeenCalled();
  });

  // The defect observed live on 2026-09-04: a teacher's dashboard kept
  // rendering "Available until ..." while the row said declared = false, so
  // the teacher believed they were visible and no student could see them.
  // This tick is the only thing that can correct an already-open dashboard,
  // and it used to report this case as "nothing to do".
  it("reports the lease as GONE when the teacher is not declared", async () => {
    maybeSingle.mockResolvedValue({
      data: { declared: false, declared_until: null },
      error: null,
    });
    const { renewLease } = await import("./actions");
    expect(await renewLease()).toEqual({ declaredUntil: null });
    // Emphatically no write: this must not resurrect the declaration.
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports the lease as gone when there is no availability row at all", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { renewLease } = await import("./actions");
    expect(await renewLease()).toEqual({ declaredUntil: null });
    expect(upsert).not.toHaveBeenCalled();
  });
});
