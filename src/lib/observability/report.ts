import * as Sentry from "@sentry/nextjs";
import { sentryEnabled } from "./sentry-options";

// Report an error that would otherwise vanish.
//
// The specific problem: several places in this app catch deliberately and
// carry on — after() blocks, cleanup paths, anything on the push road — because
// failing loudly there would cost a user something worse than the failure
// itself. That is the right call, and it is also how a system ends up with no
// idea what is wrong with it. This reports without changing that behaviour.
//
// console.error is kept unconditionally, not as a fallback: Vercel logs are
// the only record when no DSN is configured, and they remain the fastest place
// to look during local development even when one is.
export function reportError(
  e: unknown,
  context: Record<string, string | number | boolean | null | undefined> = {}
): void {
  console.error(`[${context.where ?? "error"}]`, e, context);
  if (!sentryEnabled) return;
  // Never let the reporter be the thing that breaks the caller — these sites
  // are all paths that chose to swallow rather than throw.
  try {
    Sentry.captureException(e, {
      // Tags only, and only ids. No names, no emails, no message content:
      // this product's users include children (see sentry-options.ts).
      tags: { where: String(context.where ?? "unknown") },
      extra: context,
    });
  } catch {
    // Nothing to do — the reporter failing is not worth a second failure.
  }
}
