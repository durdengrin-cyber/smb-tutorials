// Where this deployment actually lives.
//
// NOT a fix for a live fault: NEXT_PUBLIC_SITE_URL IS set, in all three Vercel
// environments, and checkout returns correctly today — verified with
// `vercel env ls` and by the owner running sessions end-to-end. Nothing was
// broken.
//
// This replaces `process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"`,
// which built the return URL for checkout. That default would fail silently
// if the variable were ever deleted, or a fourth environment were added
// without it: nothing would throw, nothing would log, and every paying
// student would be sent to http://localhost:3000/waiting/<id> with their
// money already taken. This is hardening against that possibility, not an
// incident report.
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
