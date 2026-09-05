"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createRealtimeClient } from "@/lib/supabase/client";
import { secondsRemaining, type SessionStatus } from "@/lib/session";
import { cancelSession, timeOutSession } from "@/app/session/actions";
import { createCheckout, verifyPaymentNow } from "@/app/session/payment-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/form-error";
import { Money } from "@/components/money";

// The gradient background, card and spinner ring every state shares. Kept as
// a local component rather than copy-pasted three times — this screen is
// deliberately disposable (a full redesign follows this milestone), so the
// only investment that pays off here is not duplicating markup.
function Shell({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-5 sm:p-8">
      <Card className="max-w-md w-full p-6 text-center shadow-xl sm:p-12">
        <div className="relative w-28 h-28 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full border-4 border-primary/30" />
          <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center text-3xl font-mono font-bold tabular-nums text-foreground">
            {count}
          </div>
        </div>
        {children}
      </Card>
    </div>
  );
}

export function WaitingClient({
  sessionId,
  teacherName,
  status,
  deadline,
  paymentDeadline,
  amountPaise,
  backToList,
}: {
  sessionId: string;
  teacherName: string;
  status: SessionStatus;
  deadline: string;
  paymentDeadline: string | null;
  amountPaise: number;
  // Carries the student's original search so they land back on the same
  // filtered list. Sending them to a bare /teachers made them re-pick the
  // subject before they could try anyone else — pure friction after a failed
  // attempt, and "Start now" on an unfiltered list can only error.
  backToList: string;
}) {
  const router = useRouter();
  // Which deadline is live depends on which state we're in: the 60s accept
  // window while pending, the 120s payment window once accepted. Using the
  // wrong one here would make the countdown lie about how long the student
  // actually has.
  const activeDeadline = status === "accepted" ? paymentDeadline : deadline;
  const [left, setLeft] = useState(() =>
    secondsRemaining(activeDeadline ?? deadline, new Date())
  );
  const [cancelling, setCancelling] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Navigation is not instant: without this, the 250ms interval keeps firing
  // between the decision to leave and the unmount, pushing the same route
  // several more times. Only genuine navigations set it.
  const leavingRef = useRef(false);
  // Expiry is NOT a navigation — router.refresh() re-renders this same
  // component instance, so refs survive it. Latching `leaving` here would kill
  // the interval and the subscription for good, stranding a student whose
  // clock ran a few hundred ms ahead of the server's. Throttle instead.
  const refreshingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    let channel: RealtimeChannel | null = null;

    void (async () => {
      // Awaited before subscribing — an `anon` socket acks SUBSCRIBED and then
      // hears nothing, which would leave the student waiting out the full 60s
      // even after their teacher accepted.
      const supabase = await createRealtimeClient();
      if (!mounted) return;

      channel = supabase
        .channel(`session-${sessionId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "sessions",
            filter: `id=eq.${sessionId}`,
          },
          (payload) => {
            if (!mounted || leavingRef.current) return;
            const changed = payload.new as { status: string; refund_ref: string | null };
            const newStatus = changed.status;
            if (newStatus === "active") {
              leavingRef.current = true;
              router.push(`/call/${sessionId}`);
            } else if (
              newStatus !== "pending" &&
              newStatus !== "accepted" &&
              newStatus !== "paid"
            ) {
              leavingRef.current = true;
              // Carry the status we actually observed, so /teachers can say
              // what happened instead of always blaming the teacher.
              // A refund is what the student most needs told, whatever the
              // status ended up as — see the note in page.tsx.
              const outcome = changed.refund_ref ? "refunded" : newStatus;
              router.push(
                `${backToList}&outcome=${encodeURIComponent(outcome)}` +
                  `&teacher=${encodeURIComponent(teacherName)}`
              );
            } else {
              // accepted or paid: stay on this screen, but pick up the new
              // status (and its deadline) via a fresh server read.
              router.refresh();
            }
          }
        )
        .subscribe((status) => {
          // A late accept that landed while the socket was still connecting
          // would otherwise only be noticed when the countdown expires.
          if (mounted && status === "SUBSCRIBED") router.refresh();
        });
    })();

    return () => {
      mounted = false;
      channel?.unsubscribe();
    };
  }, [sessionId, backToList, teacherName, router]);

  // On arrival back from checkout (or a lost webhook), nudge our own
  // verification path rather than waiting on the provider's webhook alone.
  useEffect(() => {
    if (status === "accepted") void verifyPaymentNow(sessionId);
  }, [status, sessionId]);

  useEffect(() => {
    const id = setInterval(() => {
      if (leavingRef.current || !activeDeadline) return;
      const remaining = secondsRemaining(activeDeadline, new Date());
      setLeft(remaining);
      if (remaining === 0 && !refreshingRef.current) {
        refreshingRef.current = true;
        // Record the outcome, then ask the server rather than assuming nobody
        // answered. If the realtime socket dropped, the teacher may have
        // accepted while this countdown ran — the page above re-reads the row
        // and sends us to the call, to /teachers, or nowhere, using the same
        // read-time rule the rest of the system trusts. The write is guarded
        // on the deadline server-side, so firing it early changes nothing.
        // Only the pending -> timed_out edge is ours to record this way; the
        // accepted -> payment_expired edge is a server-side sweep, since a
        // student who let checkout lapse should not be the one writing it.
        if (status === "pending") {
          void timeOutSession(sessionId).then(() => router.refresh());
        } else {
          router.refresh();
        }
        window.setTimeout(() => {
          refreshingRef.current = false;
        }, 2000);
      }
    }, 250);
    return () => clearInterval(id);
  }, [activeDeadline, status, router, sessionId]);

  async function cancel() {
    setCancelling(true);
    setError(null);
    try {
      const result = await cancelSession(sessionId);
      if (!result.cancelled) {
        // Nothing was written. In the payment window that almost always means
        // the webhook won the race and this session is already paid — so stay
        // put and let the realtime UPDATE move the screen on, rather than
        // walking away from a session the student has just paid for. Latching
        // leavingRef before knowing the answer would have disabled exactly
        // that handler.
        setError("Couldn't cancel — your payment may have already gone through.");
        setCancelling(false);
        return;
      }
      leavingRef.current = true;
      router.push(backToList);
    } catch (e) {
      // Same unhandled-rejection risk as pay() below: a rejection would
      // otherwise leave the button disabled with no explanation.
      console.error(`[waiting] cancel failed for ${sessionId}:`, e);
      setError("Couldn't cancel — try again.");
      setCancelling(false);
    }
  }

  async function pay() {
    setPaying(true);
    setError(null);
    try {
      const result = await createCheckout(sessionId);
      if ("error" in result) {
        setError(result.error);
        setPaying(false);
        return;
      }
      window.location.href = result.checkoutUrl;
    } catch (e) {
      // createCheckout returns {error} for the failures it anticipates, but a
      // thrown exception from its auth or session read rejects the promise
      // instead. With no error boundary above this screen, an unhandled
      // rejection would leave the student on a dead "Opening…" button with no
      // way back — on the one screen where they have already been told their
      // teacher is waiting.
      console.error(`[waiting] checkout failed for ${sessionId}:`, e);
      setError("Couldn't open the payment page — try again.");
      setPaying(false);
    }
  }

  if (status === "accepted") {
    return (
      <Shell count={left}>
        <h2 className="text-2xl font-bold text-foreground mb-2">
          {teacherName} accepted
        </h2>
        <p className="text-muted-foreground mb-4">
          Pay <Money paise={amountPaise} /> to start your session.
        </p>
        {/* Said BEFORE the money moves, not in a policy page nobody opens.
            Deliberately "may be" and not "will be": recording is not built
            yet, and a payment screen that states something untrue is worse
            than one that says nothing. When recording ships, this wording is
            already accurate and the /terms clause forbidding recording
            (terms/page.tsx) must change in the same commit. */}
        <p className="text-sm text-muted-foreground mb-8 max-w-sm mx-auto">
          For everyone&apos;s safety, sessions may be recorded. By paying, you
          confirm you&apos;re the student&apos;s parent or guardian, or 18 or
          older.
        </p>
        {error && <FormError className="mb-4">{error}</FormError>}
        {/* Cancel belongs here, not only before the teacher answers. M3 spec
            §3.1 lists `accepted -> cancelled | student`, but until now the
            product offered no way to make it: a student who changed their
            mind had to wait out the whole 120 seconds, and their teacher was
            held for all of it. Disabled while a checkout is being opened, so
            the two cannot be fired at once. */}
        <div className="flex gap-3 justify-center">
          <Button onClick={pay} disabled={paying || cancelling}>
            {paying ? "Opening…" : <>Pay <Money paise={amountPaise} /></>}
          </Button>
          <Button variant="outline" onClick={cancel} disabled={paying || cancelling}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
      </Shell>
    );
  }

  if (status === "paid") {
    return (
      <Shell count={left}>
        <h2 className="text-2xl font-bold text-foreground mb-2">Payment received</h2>
        <p className="text-muted-foreground">Opening your room…</p>
      </Shell>
    );
  }

  return (
    <Shell count={left}>
      <h2 className="text-2xl font-bold text-foreground mb-2">
        Asking {teacherName}…
      </h2>
      {/* The honest half of a 60s deadline (design spec §5.3, §6.2): a fast
          accept still resolves fast, but a slow one is not a stall — it's a
          locked phone waking up. Kept off the teacher cards on purpose; this
          screen is where the student needs to hear it. */}
      <p className="text-muted-foreground mb-8">
        This can take a moment if their phone is asleep.
      </p>
      <Button variant="outline" onClick={cancel} disabled={cancelling}>
        {cancelling ? "Cancelling…" : "Cancel"}
      </Button>
    </Shell>
  );
}
