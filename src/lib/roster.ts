import type { OnlineTeacher } from "./presence";

export interface AvailableRow {
  teacher_id: string;
  has_device: boolean;
}

// The final AND of spec §3.3's expression, and the ONLY place it can happen:
// the RPC knows the declaration, the lease and the in-session state but
// cannot see presence, because presence lives in the Realtime service rather
// than in Postgres. The client is where both halves exist at once.
//
// has_device arrives PUBLISHED, not applied — the RPC deliberately still
// returns a teacher with no device, because such a teacher may have the
// dashboard open right now and be perfectly reachable.
export function deriveRoster<T extends { id: string }>(
  eligible: T[],
  available: AvailableRow[],
  presence: OnlineTeacher[]
): T[] {
  const reachable = new Map(available.map((r) => [r.teacher_id, r.has_device]));
  const live = new Set(presence.map((p) => p.teacher_id));

  const kept = eligible.filter((e) => {
    if (!reachable.has(e.id)) return false;      // not declared / lapsed / busy
    return live.has(e.id) || reachable.get(e.id) === true;
  });

  // Rank, don't label (spec §6.2). A visible second tier would stop push-only
  // teachers being picked at all; ordering gets the student to the fastest
  // teacher without marking anyone second-rate. Stable within each tier.
  const liveTier = kept.filter((e) => live.has(e.id));
  const pushTier = kept.filter((e) => !live.has(e.id));
  return [...liveTier, ...pushTier];
}
