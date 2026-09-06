// Where this deployment actually lives.
//
// This exists because `process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"`
// was building the return URL for Razorpay checkout. NEXT_PUBLIC_SITE_URL is
// not set by anything in this repository — it comes from the Vercel dashboard
// — so one unset variable in production sent every student who paid to
// http://localhost:3000/waiting/<id>: a dead page on their phone, with their
// money already taken and the webhook still crediting the session. Nothing
// threw, nothing logged, and the only symptom was a student saying the app
// broke after they paid.
//
// A default that is wrong in production is worse than no default, because it
// removes the error that would have told you.

/**
 * The origin this deployment should send people back to, with no trailing
 * slash. Returns null when it cannot be known and guessing would be unsafe —
 * the caller decides what to do about that, because "refuse to take money" and
 * "render a link" deserve different answers.
 */
export function siteBaseUrl(
  // Deliberately looser than NodeJS.ProcessEnv, which requires NODE_ENV and
  // would make every test supply a key it does not care about. This reads
  // three string keys and nothing else.
  env: Record<string, string | undefined> = process.env
): string | null {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);

  // Vercel sets VERCEL_URL per DEPLOYMENT, so a preview returns to itself
  // rather than to production. That is what you want when testing a payment:
  // the alternative sends a preview's checkout back to the live site, where
  // the session id does not exist.
  const vercel = env.VERCEL_URL?.trim();
  if (vercel) return `https://${stripTrailingSlash(vercel)}`;

  // Only outside production. In production, no answer beats a wrong one.
  if (env.NODE_ENV === "production") return null;
  return "http://localhost:3000";
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}
