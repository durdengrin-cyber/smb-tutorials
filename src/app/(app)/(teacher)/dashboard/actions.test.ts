import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONSENT_VERSION } from "@/lib/consent";

const upsert = vi.fn();
const maybeSingle = vi.fn();
// declareAvailable/renewLease now resolve identity through requireConsentedUser(),
// which reads this via getIdentity()'s profiles select. Defaults to the
// current version so every pre-existing test keeps exercising the same
// signed-in-and-allowed teacher it always did; the consent gate itself gets
// its own tests below.
let consentVersion: string | null = CONSENT_VERSION;
// declareAvailable asks my_vetting_state before it will publish a lease.
// Defaults to cleared so every pre-existing test keeps exercising the teacher
// it always did.
let vettingState = "cleared";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "t1" } } }) },
    rpc: async (fn: string) =>
      fn === "my_vetting_state"
        ? { data: vettingState, error: null }
        : { data: null, error: null },
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
    // The refusal is what matters and is asserted by the upsert guard below.
    // The MESSAGE changed on 2026-09-10: it used to say "Sign in to go
    // available." to a teacher who was already signed in, which the client
    // could do nothing with. It now carries needsConsent so the dashboard can
    // send them to /consent.
    const result = await declareAvailable();
    expect(result).toMatchObject({ needsConsent: true });
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

// CONSENT_VERSION 2026-09-10-recording is the first bump to land while
// teachers are holding an open dashboard, and it exposed what the collapse of
// "signed out" and "owes consent" into one null actually costs a client.
//
// The dashboard polls renewLease, and availability-toggle only ever acted on a
// result containing declaredUntil — so { error } was swallowed, the lease
// display went on saying "Available until ...", the DB row stayed declared,
// and students carried on picking a teacher whose every Accept then failed.
// The message the teacher would have seen if anything had shown it was "Sign
// in first.", to someone signed in, and Accept said "Request not found." about
// a request that plainly existed.
describe("a policy change does not tell a signed-in teacher to sign in", () => {
  beforeEach(() => {
    consentVersion = "2026-09-05-guardian"; // stale, not null: signed in, owes consent
  });

  it("renewLease reports a consent refusal the client can act on", async () => {
    const { renewLease } = await import("./actions");
    const result = await renewLease();
    expect(result).toMatchObject({ needsConsent: true });
    expect(JSON.stringify(result)).not.toMatch(/sign in/i);
  });

  it("declareAvailable reports a consent refusal, not a sign-in prompt", async () => {
    const { declareAvailable } = await import("./actions");
    const result = await declareAvailable();
    expect(result).toMatchObject({ needsConsent: true });
    expect(JSON.stringify(result)).not.toMatch(/sign in/i);
  });

  it("acceptSession does not claim a real request does not exist", async () => {
    const { acceptSession } = await import("./actions");
    const result = await acceptSession("s1");
    expect(result).toMatchObject({ needsConsent: true });
    expect(JSON.stringify(result)).not.toMatch(/not found/i);
  });

  it("still refuses a genuinely signed-out caller with a sign-in message", async () => {
    consentVersion = null;
    const { declareAvailable } = await import("./actions");
    // consent_version null is the never-consented Google path — also a consent
    // refusal, and also not a reason to say "sign in".
    expect(await declareAvailable()).toMatchObject({ needsConsent: true });
  });
});

// The server half of the fix is only half of it: the defect was that the
// CLIENT ignored the refusal. availability-toggle's renew tick tested only for
// declaredUntil, so { error } fell through silently and the dashboard went on
// claiming "Available until ...". Pinned by source because rendering this
// component means a realtime channel, a visibility API and a timer, and the
// assertion is about which branches exist, not about pixels.
describe("the client acts on a consent refusal instead of swallowing it", () => {
  const src = (f: string) =>
    readFileSync(join("src", "app", "(app)", "(teacher)", "dashboard", f), "utf8").replace(
      /\s+/g,
      " "
    );

  it("the renew tick handles needsConsent and no longer drops a plain error", () => {
    const toggle = src("availability-toggle.tsx");
    expect(toggle, "the tick ignores a consent refusal").toMatch(
      /const result = await renewLease\(\);[\s\S]{0,600}?needsConsent/
    );
    expect(toggle, "the tick still swallows a plain error").toMatch(
      /const result = await renewLease\(\);[\s\S]{0,900}?setError\(result\.error\)/
    );
  });

  it("every dashboard action that can be refused sends the teacher to /consent", () => {
    const toggle = src("availability-toggle.tsx");
    const request = src("incoming-request.tsx");
    // One destination, reached from each of the five refusable calls.
    expect(toggle).toMatch(/function toConsent\(\) \{ router\.push\("\/consent"\); \}/);
    for (const [file, name] of [
      [toggle, "renewLease"],
      [toggle, "declareAvailable"],
      [toggle, "undeclareAvailable"],
      [request, "acceptSession"],
      [request, "declineSession"],
    ] as const) {
      expect(
        file,
        `${name}'s result is not checked for needsConsent`
      ).toMatch(new RegExp(`await ${name}\\([^)]*\\);[\\s\\S]{0,900}?needsConsent`));
    }
  });
});


// Found by registering a real tutor on production and looking at his dashboard:
// while "Your account is under review" was displayed directly above it, the
// toggle still offered "Available now", he could click it, and the card then
// read "Available until 7:28 PM — we'll notify you even with your phone
// locked."
//
// Not a safety hole — available_teachers gates on 'cleared', so no student
// could see or pick him, which was confirmed from a student account. It is a
// control that lies: nothing can reach an unvetted teacher, so the promised
// notification can never arrive, and a teacher sitting there waiting would
// reasonably conclude the product is broken.
//
// The rule already exists in one place, canBePicked() in lib/vetting.ts. This
// makes the write path ask it, the same way the suspended path already does.
describe("an unvetted teacher cannot publish an availability lease", () => {
  it("declareAvailable refuses while the account is under review", async () => {
    vettingState = "unvetted";
    const { declareAvailable } = await import("./actions");
    const result = await declareAvailable();
    expect(result).toMatchObject({ error: expect.stringMatching(/review/i) });
    expect(upsert, "a lease was written for a teacher no student can see").not.toHaveBeenCalled();
  });

  it("renewLease refuses too, so an existing lease cannot be extended", async () => {
    vettingState = "unvetted";
    maybeSingle.mockResolvedValue({
      data: { declared: true, declared_until: new Date(Date.now() + 3600_000).toISOString() },
      error: null,
    });
    const { renewLease } = await import("./actions");
    expect(await renewLease()).toMatchObject({ error: expect.stringMatching(/review/i) });
  });

  it("still lets a cleared teacher go available", async () => {
    const { declareAvailable } = await import("./actions");
    expect(await declareAvailable()).toEqual({ declaredUntil: "2026-08-30T14:00:00Z" });
    expect(upsert).toHaveBeenCalled();
  });
});
