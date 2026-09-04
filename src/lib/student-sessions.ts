// Which sessions belong in a student's record (spec §4).
//
// Deliberately a fact about MONEY, not a list of status names. `sessions`
// statuses changed in 0002 and again in 0005; a status allowlist would have
// drifted silently both times. "Money touched this row" cannot drift.
export interface PaidSessionRow {
  amount_paid_paise: number | null;
  refund_ref: string | null;
}

export function moneyTouched(s: PaidSessionRow): boolean {
  return s.amount_paid_paise !== null || s.refund_ref !== null;
}
