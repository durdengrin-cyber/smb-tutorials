// Spec §10. The states are duplicated in 0020's CHECK constraint, deliberately:
// the database must refuse a bad value even if a future write path forgets to
// ask this module. If you add a state, add it in both places.

export const VETTING_STATES = ["unvetted", "cleared", "suspended", "removed"] as const;

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
 * What a teacher is told. A teacher who has declared availability and receives
 * nothing must learn why here, or they conclude the product is broken.
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
    case "suspended":
      return {
        title: "Your account is paused",
        body: "You are not visible to students while we look into a report. Someone will contact you about it.",
      };
    case "removed":
      return {
        title: "Your account has been closed",
        body: "You cannot take lessons on SMB Tutorials. Contact us if you believe this is a mistake.",
      };
  }
}
