import { describe, it, expect } from "vitest";
import { siteBaseUrl } from "./site-url";

// What this guards, stated accurately: NEXT_PUBLIC_SITE_URL IS set, in all
// three Vercel environments, and checkout returns correctly today — verified
// with `vercel env ls` and by the owner testing sessions end-to-end across
// devices. Nothing was broken.
//
// It replaced `?? "http://localhost:3000"` in the checkout return path, where
// a deleted variable or a fourth environment added without it would send a
// paying student to a localhost page after their money had gone — silently,
// because a default cannot fail. This is hardening against that, not an
// incident report.
describe("siteBaseUrl", () => {
  it("prefers an explicit site URL", () => {
    expect(siteBaseUrl({ NEXT_PUBLIC_SITE_URL: "https://example.com" })).toBe(
      "https://example.com"
    );
  });

  it("strips a trailing slash, so callers can append a path safely", () => {
    // `${base}/waiting/x` with a trailing slash yields //waiting/x, which
    // some providers reject as an invalid return URL and others silently
    // redirect, losing the query string.
    expect(siteBaseUrl({ NEXT_PUBLIC_SITE_URL: "https://example.com/" })).toBe(
      "https://example.com"
    );
    expect(siteBaseUrl({ NEXT_PUBLIC_SITE_URL: "https://example.com///" })).toBe(
      "https://example.com"
    );
  });

  it("falls back to this deployment, not to production", () => {
    // VERCEL_URL is per-deployment on purpose: a preview's checkout must
    // return to the preview. Sending it to production lands the student on a
    // site where their session id does not exist.
    expect(
      siteBaseUrl({ VERCEL_URL: "smb-git-abc.vercel.app" })
    ).toBe("https://smb-git-abc.vercel.app");
  });

  it("REFUSES to guess in production", () => {
    // The whole point. A wrong default in production is worse than no
    // default, because it removes the error that would have told you.
    expect(siteBaseUrl({ NODE_ENV: "production" })).toBeNull();
  });

  it("still gives localhost in development", () => {
    expect(siteBaseUrl({ NODE_ENV: "development" })).toBe(
      "http://localhost:3000"
    );
  });

  it("treats an empty or whitespace value as unset", () => {
    // An env var set to "" is a real deployment mistake and reads as
    // configured to a bare `??`, which would have taken the localhost branch
    // in production.
    expect(
      siteBaseUrl({ NEXT_PUBLIC_SITE_URL: "   ", NODE_ENV: "production" })
    ).toBeNull();
  });
});
