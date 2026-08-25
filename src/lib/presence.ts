// Presence answers "who is here right now"; the database answers "who teaches
// this". Keeping them separate is why one channel serves every subject
// combination instead of one channel per taxonomy tuple.

export const PRESENCE_CHANNEL = "teachers-online";

export interface OnlineTeacher {
  teacher_id: string;
  full_name: string;
  hourly_rate: number;
}

const isOnlineTeacher = (v: unknown): v is OnlineTeacher =>
  !!v && typeof (v as OnlineTeacher).teacher_id === "string";

// Supabase keys presence state by presence key, with an array per key (one
// entry per open tab).
export function rosterFromPresenceState(
  state: Record<string, OnlineTeacher[]>
): OnlineTeacher[] {
  const seen = new Set<string>();
  const roster: OnlineTeacher[] = [];
  for (const entries of Object.values(state ?? {})) {
    for (const entry of entries ?? []) {
      if (!isOnlineTeacher(entry) || seen.has(entry.teacher_id)) continue;
      seen.add(entry.teacher_id);
      roster.push(entry);
    }
  }
  return roster;
}

export function intersectOnline<T extends { id: string }>(
  eligible: T[],
  roster: OnlineTeacher[]
): T[] {
  const online = new Set(roster.map((r) => r.teacher_id));
  return eligible.filter((e) => online.has(e.id));
}
