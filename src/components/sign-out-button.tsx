"use client";

import { useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { removeThisDevice } from "@/lib/push/client";
import { Button } from "@/components/ui/button";

// Spec §8: a shared family phone must not keep waking a teacher who signed
// out — the next person to use that phone would otherwise keep receiving a
// teacher's session requests, and that teacher would believe they are still
// reachable.
//
// Replaces the plain `<form action={signOut}>` that used to live in
// app-shell.tsx. That is a deliberate trade against progressive
// enhancement: the old form signed a teacher out even with JS disabled; this
// onClick handler does not. The trade is required, not incidental — reading
// a live PushSubscription and calling DELETE /api/devices is client-side
// work a no-JS form post cannot perform at all.
export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);

    // removeThisDevice already wraps every step of its own cleanup so it
    // cannot throw; this catch is a second, independent guarantee that a
    // cleanup failure can never stop the sign-out below from running.
    try {
      await removeThisDevice();
    } catch (e) {
      console.error("[sign-out] device cleanup failed", e);
    }

    try {
      await signOut();
      // Unreachable in real use: signOut() unconditionally calls redirect(),
      // and a Server Action's redirect() rejects the CALLING promise with a
      // NEXT_REDIRECT signal rather than resolving it — Next's own
      // server-action-reducer.js calls `reject(redirectError)` on the
      // redirect branch before returning. So the expected, successful
      // outcome is handled in the catch below, not here.
    } catch (e) {
      // The redirect above is exactly this kind of rejection, and must not
      // be swallowed: unstable_rethrow re-throws Next's own navigation
      // signals (redirect/notFound/etc — see
      // node_modules/next/dist/docs/.../unstable_rethrow.md) so the
      // framework can still complete the navigation, and returns normally
      // for anything else. Only a genuine failure — e.g. the network call
      // that invokes the server action itself failing — reaches the lines
      // below, and only then is it safe (and necessary) to hand the button
      // back to the teacher instead of leaving it disabled with no retry.
      unstable_rethrow(e);
      console.error("[sign-out] could not sign out", e);
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={busy}
    >
      {busy ? "…" : "Sign out"}
    </Button>
  );
}
