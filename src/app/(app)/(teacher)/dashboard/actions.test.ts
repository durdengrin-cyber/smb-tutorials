import { describe, it, expect, vi, beforeEach } from "vitest";

const upsert = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "t1" } } }) },
    from: () => ({
      upsert: (...a: unknown[]) => { upsert(...a); return { select: () => ({ single: async () => ({ data: { declared_until: "2026-08-30T14:00:00Z" }, error: null }) }) }; },
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}));

beforeEach(() => { upsert.mockClear(); maybeSingle.mockReset(); });

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
});

describe("renewLease", () => {
  it("does nothing when more than half the lease remains", async () => {
    // A renewal on every mount is the write storm the lease exists to avoid.
    maybeSingle.mockResolvedValue({
      data: {
        declared: true,
        declared_until: new Date(Date.now() + 3 * 3600_000).toISOString(),
      },
      error: null,
    });
    const { renewLease } = await import("./actions");
    expect(await renewLease()).toEqual({ skipped: true });
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
    maybeSingle.mockResolvedValue({
      data: {
        declared: true,
        declared_until: new Date(Date.now() - 60_000).toISOString(),
      },
      error: null,
    });
    const { renewLease } = await import("./actions");
    expect(await renewLease()).toEqual({ skipped: true });
    expect(upsert).not.toHaveBeenCalled();
  });
});
