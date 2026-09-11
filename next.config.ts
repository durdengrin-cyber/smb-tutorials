import type { NextConfig } from "next";
// From @sentry/nextjs/config, not @sentry/nextjs: the latter is deprecated
// and stops working in v11.
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // DEV ONLY, and it has no effect on any build or deployment: Next 16 refuses
  // to serve its own /_next/static dev chunks across origins, and it counts
  // 127.0.0.1 as a different origin from localhost. Browsing the dev server by
  // IP therefore loads the HTML, loads nothing else, and the app never
  // hydrates — every button is inert, with NOTHING in the browser console,
  // because the refusal is logged server-side to
  // .next/dev/logs/next-development.log.
  //
  // That cost an hour on 2026-09-11. It looked exactly like a hydration bug in
  // our own code, and it is not ours at all: the same commit hydrates fine on
  // production and fine on localhost. It only reproduces by IP, which is the
  // one way the Claude browser extension can reach this server — it allows
  // 127.0.0.1 and refuses localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

// Source map upload is what turns a minified production stack trace into a
// readable one. It needs a WRITE credential (SENTRY_AUTH_TOKEN, scope
// project:releases), which is a real secret — unlike the DSN, which is public
// by design and ships in the browser bundle.
//
// Guarded explicitly rather than relying on the plugin to notice: Sentry's own
// skip logic keys off the bundler, not off whether a token exists, so without
// this a tokenless build would attempt an upload it cannot perform. With the
// guard, no token means the plugin is inert and the build behaves exactly as
// it did before Sentry was added — the same contract as sentry-options.ts.
const canUploadSourcemaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  sourcemaps: {
    disable: !canUploadSourcemaps,
    // Upload them, then delete them from the deployed output. Leaving source
    // maps served publicly would hand anyone the original source of an app
    // that handles payments and children's data.
    deleteSourcemapsAfterUpload: true,
  },

  // No build-time telemetry to Sentry, and no extra build noise locally.
  telemetry: false,
  silent: !process.env.CI,

  // disableLogger is deprecated in favour of webpack.treeshake.removeDebugLogging,
  // which this project cannot use — it builds with Turbopack, where that option
  // is unsupported. Dropped rather than carried as a warning for a thing we
  // could not act on anyway; Sentry's debug logging is a bundle-size nicety,
  // not correctness.
});
