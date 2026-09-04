// Server and edge error reporting. Next calls register() once per server
// instance (see node_modules/next/dist/docs/.../instrumentation.md), and
// onRequestError for every server-side error it catches.
import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, sentryEnabled } from "@/lib/observability/sentry-options";

export function register() {
  if (!sentryEnabled) return;
  Sentry.init(baseSentryOptions);
}

// Exported unconditionally — Next reads this binding at build time, so it
// cannot be conditional. The guard is inside.
export const onRequestError: typeof Sentry.captureRequestError = (...args) => {
  if (!sentryEnabled) return;
  return Sentry.captureRequestError(...args);
};
