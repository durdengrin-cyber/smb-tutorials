// Spec §10. The states are duplicated in 0021's CHECK constraint, deliberately:
// the database must refuse a bad value even if a future write path forgets to
// ask this module. If you add a state, add it in both places.

// Two states, not four. Suspension is owned by teacher_suspensions (0020) —
// its own table, its own auto-suspend trigger on conduct reports, its own
// filter in available_teachers, and my_suspension() for the teacher's banner.
// A second "suspended" value here would be a competing source of truth that a
// conduct report would update in one place and not the other.
//
// This state answers exactly one question: has a person checked this teacher?
// Recording "checked and refused" is deferred; the operator leaves them
// unvetted with a note, and adding a value later is a new value, not a new
// mechanism (spec §10).
export const VETTING_STATES = ["unvetted", "cleared"] as const;

export type VettingState = (typeof VETTING_STATES)[number];

export function isVettingState(x: string): x is VettingState {
  return (VETTING_STATES as readonly string[]).includes(x);
}

/**
 * The safety property, in one place. available_teachers enforces the same rule
 * in SQL — this is for surfaces that hold a profile in hand and must not wait
 * for a round trip.
 */
export function canBePicked(state: VettingState): boolean {
  return state === "cleared";
}

/**
 * What a teacher is told while they wait to be checked. A suspended teacher is
 * told separately, by the dashboard's my_suspension() path — this must not
 * duplicate that message or the two will drift.
 */
export function vettingMessage(
  state: VettingState
): { title: string; body: string } | null {
  switch (state) {
    case "cleared":
      return null;
    case "unvetted":
      return {
        title: "Your account is under review",
        body: "We check every teacher's ID against their account before they can take a lesson. You can finish your profile now — students will see you once the check is done.",
      };
  }
}
