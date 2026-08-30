// Pure availability-lease rules. Nothing here touches the network — the same
// functions run in Server Actions and in the browser, which is what lets a
// serverless stack expire a declaration without a cron (spec §4.1).
//
// Why a lease and not a heartbeat: a 15-second heartbeat is ~667 writes/sec
// at 10,000 teachers. A 4-hour lease renewed at its halfway point is ~1.4.
// Same honesty, ~240x cheaper.

export const LEASE_SECONDS = 4 * 60 * 60;

// The floor exists because the halfway rule alone fires on every mount for
// the whole second half of a lease, and a teacher may have several tabs open.
export const RENEW_FLOOR_SECONDS = 15 * 60;

export function leaseUntilFrom(now: Date): Date {
  return new Date(now.getTime() + LEASE_SECONDS * 1000);
}

export function isLeaseLive(declaredUntil: string | null, now: Date): boolean {
  if (!declaredUntil) return false;
  return new Date(declaredUntil).getTime() > now.getTime();
}

export function shouldRenew(
  declaredUntil: string | null,
  now: Date,
  lastRenewedAt: Date | null
): boolean {
  // A lapsed lease is not renewed: going available again is a fresh decision
  // by the teacher, and renewing it silently would resurrect a declaration
  // they never made.
  if (!isLeaseLive(declaredUntil, now)) return false;

  const remainingMs = new Date(declaredUntil as string).getTime() - now.getTime();
  if (remainingMs > (LEASE_SECONDS / 2) * 1000) return false;

  if (
    lastRenewedAt &&
    now.getTime() - lastRenewedAt.getTime() < RENEW_FLOOR_SECONDS * 1000
  ) {
    return false;
  }
  return true;
}

// Shown to the teacher at the moment they declare, so lapsing is what they
// agreed to rather than a surprise sprung on them (spec §4.1).
export function formatLeaseEnd(declaredUntil: string): string {
  return new Date(declaredUntil).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
