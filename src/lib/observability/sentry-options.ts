// One place that decides whether error reporting is on, and what it sends.
//
// Inert without a DSN, on purpose. Sentry is a paid third party the project
// may or may not keep, and nothing in the app should depend on it being
// configured: no DSN means init() is never called, every capture becomes a
// no-op, and the app behaves exactly as it did before. That also keeps local
// development and CI from posting noise to a production project.
import type { ErrorEvent } from "@sentry/nextjs";

export const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN ?? "";

export const sentryEnabled = SENTRY_DSN.length > 0;

export const baseSentryOptions = {
  dsn: SENTRY_DSN,
  // Vercel sets this; falls back so a local run is never labelled production.
  environment: process.env.VERCEL_ENV ?? "development",

  // Errors only, no performance tracing. Tracing is where Sentry bills get
  // surprising, and the problem being solved here is "we cannot answer why
  // something failed" — not latency. Turn it on deliberately, if ever.
  tracesSampleRate: 0,

  // This product handles data about MINORS. Default-off for anything that
  // could carry personal content: no request bodies, no headers, no cookies,
  // no IP addresses. An error report should say what broke, never who was in
  // the lesson or what they typed.
  sendDefaultPii: false,

  // Last line of defence, since the rules above are configuration and this is
  // code. Strips anything that could still carry a person in it.
  beforeSend(event: ErrorEvent): ErrorEvent {
    delete event.user;
    if (event.request) {
      delete event.request.cookies;
      delete event.request.headers;
      delete event.request.data;
    }
    return event;
  },
};
