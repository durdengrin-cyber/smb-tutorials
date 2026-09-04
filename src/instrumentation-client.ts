// Browser error reporting. This file runs before the app becomes interactive
// (node_modules/next/dist/docs/.../instrumentation-client.md) — no exports
// required, the side effect IS the setup.
import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, sentryEnabled } from "@/lib/observability/sentry-options";

if (sentryEnabled) {
  Sentry.init({
    ...baseSentryOptions,
    // Session Replay is deliberately NOT enabled. It records what a user sees,
    // and the users here include children in a tutoring session.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

// Next uses this to report client-side navigation errors when it is exported.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
