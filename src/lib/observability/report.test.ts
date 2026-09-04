import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

// sentryEnabled is computed at module load from the env, so each test loads a
// fresh module with the env it wants.
async function load(dsn?: string) {
  vi.resetModules();
  if (dsn) process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
  else delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  delete process.env.SENTRY_DSN;
  return import("./report");
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  captureException.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
});

describe("reportError", () => {
  // The whole point of the DSN guard: this project must not depend on a paid
  // third party being configured. No DSN means Sentry is never called, and the
  // app behaves exactly as it did before Sentry existed.
  it("does not call Sentry when no DSN is configured", async () => {
    const { reportError } = await load();
    reportError(new Error("boom"), { where: "test" });
    expect(captureException).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("reports to Sentry when a DSN is configured", async () => {
    const { reportError } = await load("https://abc@o1.ingest.sentry.io/1");
    const err = new Error("boom");
    reportError(err, { where: "requestSession.push", sessionId: "s1" });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][0]).toBe(err);
    expect(captureException.mock.calls[0][1]).toMatchObject({
      tags: { where: "requestSession.push" },
    });
  });

  // console.error is kept even WITH a DSN: Vercel logs stay the fastest place
  // to look locally, and are the only record if a report fails to send.
  it("always logs to console, DSN or not", async () => {
    const { reportError } = await load("https://abc@o1.ingest.sentry.io/1");
    reportError(new Error("boom"), { where: "test" });
    expect(errorSpy).toHaveBeenCalled();
  });

  // These call sites all CHOSE to swallow rather than throw. The reporter must
  // not be the thing that finally breaks them.
  it("never throws, even when Sentry itself throws", async () => {
    captureException.mockImplementation(() => { throw new Error("sentry down"); });
    const { reportError } = await load("https://abc@o1.ingest.sentry.io/1");
    expect(() => reportError(new Error("boom"), { where: "test" })).not.toThrow();
  });
});
