"use client";

import { useState } from "react";
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
    try {
      // removeThisDevice already wraps every step of its own cleanup so it
      // cannot throw; this try/finally is a second, independent guarantee
      // that nothing between here and signOut() can trap someone trying to
      // leave.
      await removeThisDevice();
    } catch (e) {
      console.error("[sign-out] device cleanup failed", e);
    } finally {
      await signOut();
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
