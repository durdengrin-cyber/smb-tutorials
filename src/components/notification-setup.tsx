"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  readSetupFacts,
  enableNotifications,
  registerExistingSubscription,
} from "@/lib/push/client";
import { nextSetupAction, type SetupAction } from "@/lib/push/state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

// One component, three appearances (spec §7.2-7.4): the full-screen step a
// brand-new teacher lands on after signup, the dashboard card that
// retro-onboards everyone who signed up before this existed, and the same
// card again if a working setup later breaks (a revoked permission, a
// rotated subscription). There is no separate "onboarding wizard" — the
// state machine in @/lib/push/state is the only source of what to show, so
// all three appearances can never drift out of sync with each other.
export function NotificationSetup({ variant }: { variant: "full" | "card" }) {
  const [action, setAction] = useState<SetupAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const facts = await readSetupFacts();
      if (!mounted) return;
      const next = nextSetupAction(facts);
      setAction(next);
      // Granted-but-possibly-stale: the subscription itself may have rotated
      // while the app was closed. Repaired silently — this is not something
      // to put a button in front of (spec §8).
      if (next === "done") {
        void registerExistingSubscription();
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleEnable() {
    setBusy(true);
    setError(null);
    const result = await enableNotifications();
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setAction("done");
  }

  // Nothing known yet, or nothing left to do — in either case there is
  // nothing to render. Distinguishing "loading" from "done" here would just
  // add a flash of empty state between them; both are silent.
  if (action === null || action === "done") return null;

  const body = (
    <>
      {action === "install_ios" && (
        <>
          <h2 className="font-bold text-foreground">
            One more step so students can reach you
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            iPhone needs the app on your Home Screen before it can notify
            you. Tap Share, then Add to Home Screen. Open it from there and
            sign in once more — then we&apos;ll finish setting up.
          </p>
        </>
      )}
      {action === "enable" && (
        <>
          <h2 className="font-bold text-foreground">Turn on notifications</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            We&apos;ll notify you when a student asks for a session, even
            with your phone locked.
          </p>
          {error && <FormError className="mt-2">{error}</FormError>}
          <Button type="button" className="mt-4" onClick={handleEnable} disabled={busy}>
            {busy ? "…" : "Turn on notifications"}
          </Button>
        </>
      )}
      {action === "blocked" && (
        <>
          <h2 className="font-bold text-foreground">Can&apos;t reach you</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Notifications are blocked for this site, so students aren&apos;t
            being shown to you when your dashboard is closed. You can turn
            them back on in your browser settings for this site.
          </p>
        </>
      )}
    </>
  );

  if (variant === "full") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <Card className="p-6">{body}</Card>
          <p className="mt-4 text-center text-sm">
            <Link href="/dashboard" className="text-muted-foreground underline">
              Skip for now
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return <Card className="p-6">{body}</Card>;
}
