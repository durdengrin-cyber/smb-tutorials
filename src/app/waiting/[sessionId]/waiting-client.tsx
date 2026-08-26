"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createRealtimeClient } from "@/lib/supabase/client";
import { secondsRemaining, type SessionStatus } from "@/lib/session";
import { cancelSession, timeOutSession } from "@/app/session/actions";
import { createCheckout, verifyPaymentNow } from "@/app/session/payment-actions";

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
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-50 to-blue-50 flex items-center justify-center p-8">
      <div className="bg-white rounded-2xl shadow-xl p-12 max-w-md w-full text-center border border-gray-100">
        <div className="relative w-28 h-28 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full border-4 border-teal-100" />
          <div className="absolute inset-0 rounded-full border-4 border-teal-500 border-t-transparent animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-gray-900">
            {count}
          </div>
        </div>
        {children}
      </div>
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
  returnTo,
  backToList,
}: {
  sessionId: string;
  teacherName: string;
  status: SessionStatus;
  deadline: string;
  paymentDeadline: string | null;
  amountPaise: number;
  // Both carry the student's original search so they land back on the same
  // filtered list. Sending them to a bare /teachers made them re-pick the
  // subject before they could try anyone else — pure friction after a failed
  // attempt, and "Start now" on an unfiltered list can only error.
  returnTo: string;
  backToList: string;
}) {
  const router = useRouter();
  // Which deadline is live depends on which state we're in: the 30s accept
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
      // hears nothing, which would leave the student waiting out the full 30s
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
            const newStatus = (payload.new as { status: string }).status;
            if (newStatus === "active") {
              leavingRef.current = true;
              router.push(`/call/${sessionId}`);
            } else if (
              newStatus !== "pending" &&
              newStatus !== "accepted" &&
              newStatus !== "paid"
            ) {
              leavingRef.current = true;
              router.push(returnTo);
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
  }, [sessionId, returnTo, router]);

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
    leavingRef.current = true;
    await cancelSession(sessionId);
    router.push(backToList);
  }

  async function pay() {
    setPaying(true);
    setError(null);
    const result = await createCheckout(sessionId);
    if ("error" in result) {
      setError(result.error);
      setPaying(false);
      return;
    }
    window.location.href = result.checkoutUrl;
  }

  if (status === "accepted") {
    return (
      <Shell count={left}>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {teacherName} accepted
        </h2>
        <p className="text-gray-600 mb-8">
          Pay ₹{Math.round(amountPaise / 100)} to start your session.
        </p>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        <button
          type="button"
          onClick={pay}
          disabled={paying}
          className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-semibold px-8 py-3 rounded-lg disabled:opacity-50"
        >
          {paying ? "Opening…" : `Pay ₹${Math.round(amountPaise / 100)}`}
        </button>
      </Shell>
    );
  }

  if (status === "paid") {
    return (
      <Shell count={left}>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment received</h2>
        <p className="text-gray-600">Opening your room…</p>
      </Shell>
    );
  }

  return (
    <Shell count={left}>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Asking {teacherName}…
      </h2>
      <p className="text-gray-600 mb-8">
        They have a few seconds to accept. Hold tight.
      </p>
      <button
        type="button"
        onClick={cancel}
        disabled={cancelling}
        className="bg-white border-2 border-gray-300 hover:border-gray-400 text-gray-700 font-semibold px-8 py-3 rounded-lg disabled:opacity-50"
      >
        {cancelling ? "Cancelling…" : "Cancel"}
      </button>
    </Shell>
  );
}
