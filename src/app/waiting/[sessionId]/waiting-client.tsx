"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createRealtimeClient } from "@/lib/supabase/client";
import { secondsRemaining } from "@/lib/session";
import { cancelSession, timeOutSession } from "@/app/session/actions";

export function WaitingClient({
  sessionId,
  teacherName,
  deadline,
  returnTo,
  backToList,
}: {
  sessionId: string;
  teacherName: string;
  deadline: string;
  // Both carry the student's original search so they land back on the same
  // filtered list. Sending them to a bare /teachers made them re-pick the
  // subject before they could try anyone else — pure friction after a failed
  // attempt, and "Start now" on an unfiltered list can only error.
  returnTo: string;
  backToList: string;
}) {
  const router = useRouter();
  const [left, setLeft] = useState(() => secondsRemaining(deadline, new Date()));
  const [cancelling, setCancelling] = useState(false);
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
            const status = (payload.new as { status: string }).status;
            if (status === "active") {
              leavingRef.current = true;
              router.push(`/call/${sessionId}`);
            } else if (status !== "pending") {
              leavingRef.current = true;
              router.push(returnTo);
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

  useEffect(() => {
    const id = setInterval(() => {
      if (leavingRef.current) return;
      const remaining = secondsRemaining(deadline, new Date());
      setLeft(remaining);
      if (remaining === 0 && !refreshingRef.current) {
        refreshingRef.current = true;
        // Record the outcome, then ask the server rather than assuming nobody
        // answered. If the realtime socket dropped, the teacher may have
        // accepted while this countdown ran — the page above re-reads the row
        // and sends us to the call, to /teachers, or nowhere, using the same
        // read-time rule the rest of the system trusts. The write is guarded
        // on the deadline server-side, so firing it early changes nothing.
        void timeOutSession(sessionId).then(() => router.refresh());
        window.setTimeout(() => {
          refreshingRef.current = false;
        }, 2000);
      }
    }, 250);
    return () => clearInterval(id);
  }, [deadline, router, sessionId]);

  async function cancel() {
    setCancelling(true);
    leavingRef.current = true;
    await cancelSession(sessionId);
    router.push(backToList);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-50 to-blue-50 flex items-center justify-center p-8">
      <div className="bg-white rounded-2xl shadow-xl p-12 max-w-md w-full text-center border border-gray-100">
        <div className="relative w-28 h-28 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full border-4 border-teal-100" />
          <div className="absolute inset-0 rounded-full border-4 border-teal-500 border-t-transparent animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-gray-900">
            {left}
          </div>
        </div>
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
      </div>
    </div>
  );
}
