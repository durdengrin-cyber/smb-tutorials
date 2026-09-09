"use client";

import { useState } from "react";

/**
 * A value that changes every time a Server Action returns, for use as a
 * `key` on `<select>` elements inside the form.
 *
 * Text inputs and checkboxes recover from React 19's post-action form reset on
 * their own once `defaultValue`/`defaultChecked` carry the echoed submission.
 * A `<select>` does not. `reset()` restores each control to its *default*, and
 * for a select that default is whichever `<option>` holds the `selected`
 * attribute — which React sets when the select mounts and does not move on a
 * later render. So the select reverts to "Select a grade" while every field
 * around it keeps its value.
 *
 * Verified in a browser on 2026-09-09: after a rejected submit, fullName and
 * the curriculum chips came back, teachingLevel and hoursPerWeek came back
 * empty. Changing the key remounts the select, which is what makes React apply
 * the new default.
 *
 * Derived during render rather than in an Effect — React's own recommended
 * pattern for adjusting state when a prop or state value changes — so the
 * remount happens in the same commit that shows the error, with no flash of a
 * stale selection.
 */
export function useResubmitKey(state: unknown): number {
  const [seen, setSeen] = useState(state);
  const [key, setKey] = useState(0);
  if (state !== seen) {
    setSeen(state);
    setKey((k) => k + 1);
  }
  return key;
}
