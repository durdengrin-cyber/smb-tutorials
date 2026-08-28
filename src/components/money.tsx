// One place renders money. The currency symbol was hardcoded in eight separate
// UI sites before this; that is housekeeping for the component layer, not an
// internationalisation decision (spec §8).
export function formatPaise(paise: number): string {
  return `₹${Math.round(paise / 100)}`;
}

export function Money({ paise }: { paise: number }) {
  return <span>{formatPaise(paise)}</span>;
}
