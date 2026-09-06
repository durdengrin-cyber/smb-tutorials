"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// (gate) is the consent wall. This boundary wraps consent/page.tsx and
// consent-form.tsx — a throw from either one (e.g. the server action in
// consent/actions.ts) is caught here, keeping the sign-out button the layout
// deliberately keeps beside this screen.
//
// It does NOT cover GateLayout's own requireUser() call (layout.tsx line 19,
// via getIdentity's explicit throw on a failed profile read in
// src/lib/auth.ts): a segment's error.tsx never wraps the layout.tsx beside
// it, only that layout's children — see global-error.tsx's comment. A throw
// from requireUser() here still falls all the way through to
// global-error.tsx, which renders its own <html> and drops the sign-out
// button. That gap is real; this file just isn't where it gets closed.
//
// The copy is NOT (app)/error.tsx's. That one reassures the reader their
// "session and any payment are unaffected", which is the right thing to say
// on a screen reached after paying and a false thing to say here: nobody on
// this screen has a session or has paid. What a guardian needs to know is
// that nothing was agreed to.
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-muted-foreground">
        We couldn&apos;t load the agreement. Nothing has been agreed to, and no
        account details have changed.
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
