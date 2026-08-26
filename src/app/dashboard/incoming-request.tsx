"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createRealtimeClient } from "@/lib/supabase/client";
import { secondsRemaining } from "@/lib/session";
import { acceptSession, declineSession } from "./actions";

interface PendingRequest {
  id: string;
  subject: string;
  hourly_rate: number;
  accept_deadline: string;
  student_name: string;
  // "pending": awaiting this teacher's Accept/Decline. "accepted": the
  // teacher has answered and the card now waits on the student's payment
  // (M3 spec §5.3) — the room itself is minted later by the webhook, never
  // from this component.
  status: "pending" | "accepted";
  payment_deadline: string | null;
}

// The columns a pending request needs, from either the realtime payload or the
// catch-up query below. student_name is snapshotted onto the row at insert
// (migration 0004) because the profiles policy hides students from teachers.
interface SessionRow {
  id: string;
  subject: string;
  hourly_rate: number;
  accept_deadline: string;
  student_name: string | null;
}

export function IncomingRequest({ teacherId }: { teacherId: string }) {
  const router = useRouter();
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // An ack or a query can land after this effect is torn down (React
    // StrictMode's mount -> cleanup -> remount reproduces it).
    let mounted = true;
    let channel: RealtimeChannel | null = null;

    const toPending = (row: SessionRow): PendingRequest => ({
      id: row.id,
      subject: row.subject,
      hourly_rate: row.hourly_rate,
      accept_deadline: row.accept_deadline,
      student_name: row.student_name || "A student",
      status: "pending",
      payment_deadline: null,
    });

    void (async () => {
      // Awaited before subscribing: a socket that joins as `anon` acks
      // SUBSCRIBED and then silently receives nothing, which is how a
      // student's request stayed invisible until a manual refresh.
      const supabase = await createRealtimeClient();
      if (!mounted) return;

      // A request that landed before this component subscribed would otherwise
      // never be seen — the teacher would sit idle while the student's 30s ran
      // out. Reachable on a return from a call, a reload, or a socket rejoin.
      void (async () => {
        const { data: row } = await supabase
          .from("sessions")
          .select("id, subject, hourly_rate, accept_deadline, student_name")
          .eq("teacher_id", teacherId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!mounted || !row) return;
        if (secondsRemaining(row.accept_deadline, new Date()) === 0) return;
        // A live INSERT that arrived while this query was in flight is newer.
        setRequest((prev) => prev ?? toPending(row));
      })();

      channel = supabase
        .channel(`teacher-sessions-${teacherId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "sessions",
            filter: `teacher_id=eq.${teacherId}`,
          },
          (payload) => {
            const row = payload.new as SessionRow & { status: string };
            if (!mounted || row.status !== "pending") return;
            setError(null);
            setRequest(toPending(row));
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "sessions",
            filter: `teacher_id=eq.${teacherId}`,
          },
          (payload) => {
            const row = payload.new as {
              id: string;
              status: string;
              payment_deadline: string | null;
            };
            if (!mounted) return;
            // matched tells us, after the functional update below has run
            // against the latest committed state, whether this event was
            // actually about the card on screen — needed because the update
            // to "active" is handled as a navigation, not a state change.
            let matched = false;
            setRequest((prev) => {
              if (!prev || prev.id !== row.id) return prev;
              matched = true;
              // Accepting does not end the prompt any more — it becomes the
              // "waiting for payment" state until the student pays or the
              // window closes. "paid" and "active" also leave the prompt
              // alone: "paid" is a brief in-between the webhook passes
              // through on its way to minting the room, and "active" is
              // handled below by navigating away instead of clearing state
              // out from under the card mid-transition.
              if (row.status === "accepted") {
                return { ...prev, status: "accepted", payment_deadline: row.payment_deadline };
              }
              if (row.status === "paid" || row.status === "active") return prev;
              // Any other status is genuinely terminal from here (declined,
              // timed_out, cancelled, payment_expired) — the student
              // cancelled, the window lapsed, or this teacher answered in
              // another tab. Leaving the prompt up would offer an action
              // that can only fail.
              return null;
            });
            if (matched && row.status === "active") {
              router.push(`/call/${row.id}`);
            }
          }
        )
        .subscribe();
    })();

    return () => {
      mounted = false;
      channel?.unsubscribe();
    };
  }, [teacherId, router]);

  // Local countdown. Which deadline is live depends on which state we're
  // in: the 30s accept window while pending, the 120s payment window once
  // accepted — using the wrong one would make the countdown lie about how
  // long is actually left. `request` as a whole is the dependency (rather
  // than picking out a single field) so a status flip, which always
  // produces a new object, restarts the timer against the new deadline.
  useEffect(() => {
    if (!request) return;
    const deadline =
      request.status === "accepted" ? request.payment_deadline : request.accept_deadline;
    if (!deadline) return;
    const tick = () => {
      const remaining = secondsRemaining(deadline, new Date());
      setLeft(remaining);
      if (remaining === 0) setRequest(null);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [request]);

  // Rendered above the prompt guard on purpose. The two failures worth
  // reporting — "already expired" and "no longer waiting" — are produced by
  // the very events that clear `request`, so an error rendered inside the
  // prompt would unmount in the same tick it was set.
  const banner = error && (
    <section className="bg-red-50 border border-red-200 rounded-2xl px-6 py-4 flex items-start justify-between gap-4">
      <p className="text-red-700 text-sm">{error}</p>
      <button
        type="button"
        onClick={() => setError(null)}
        className="text-red-700 text-sm font-semibold hover:underline shrink-0"
      >
        Dismiss
      </button>
    </section>
  );

  if (!request) return banner ? banner : null;

  async function accept(id: string) {
    setBusy(true);
    setError(null);
    // acceptSession no longer redirects — it just agrees the price and
    // starts the payment window (Task 7). The move into the "waiting for
    // payment" state happens when the realtime UPDATE above lands, not
    // here, so this handler's only job is to report an error and, on every
    // path out, stop disabling the buttons.
    const result = await acceptSession(id);
    if (result?.error) setError(result.error);
    setBusy(false);
  }

  async function decline(id: string) {
    setBusy(true);
    setError(null);
    const result = await declineSession(id);
    if (result?.error) {
      setError(result.error);
      setBusy(false);
      return;
    }
    setRequest(null);
    setBusy(false);
  }

  return (
    <>
      {banner}
      <section className="bg-white rounded-2xl shadow-xl border-2 border-teal-500 p-6">
        {request.status === "accepted" ? (
          <>
            <p className="text-lg font-bold text-gray-900 mb-1">
              Waiting for {request.student_name} to pay — {left}s
            </p>
            <p className="text-sm text-gray-600">
              Your room opens as soon as their payment clears.
            </p>
          </>
        ) : (
          <>
            <p className="text-lg font-bold text-gray-900 mb-1">
              New student request — {request.student_name} wants {request.subject}{" "}
              now, ₹{request.hourly_rate}/hr
            </p>
            <p className="text-sm text-gray-600 mb-4">{left}s to respond</p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => accept(request.id)}
                className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-semibold px-6 py-3 rounded-lg disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => decline(request.id)}
                className="bg-white border-2 border-gray-300 hover:border-gray-400 text-gray-700 font-semibold px-6 py-3 rounded-lg disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
