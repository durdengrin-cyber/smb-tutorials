"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createRealtimeClient } from "@/lib/supabase/client";
import { effectiveStatus, pickOpenRequest, secondsRemaining, type SessionStatus } from "@/lib/session";
import { acceptSession, declineSession } from "./actions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface PendingRequest {
  id: string;
  subject: string;
  hourly_rate: number;
  accept_deadline: string;
  student_name: string;
  // "pending": awaiting this teacher's Accept/Decline. "accepted": the
  // teacher has answered and the card is counting down the student's payment
  // window (M3 spec §5.3) — the room itself is minted later by the webhook,
  // never from this component. "paid" is its own state rather than a second
  // reading of "accepted", because the payment window stops governing the
  // moment the money is in: the row can only move to `active` or `refunded`
  // from there, both by the webhook. Collapsing it into "accepted" left the
  // countdown free to clear a paid card at the deadline, stranding the
  // teacher out of a session their student had already paid for.
  status: "pending" | "accepted" | "paid";
  payment_deadline: string | null;
}

// The columns a pending/accepted/paid request needs, from either the
// realtime payload or the catch-up query below. student_name is snapshotted
// onto the row at insert (migration 0004) because the profiles policy hides
// students from teachers.
interface SessionRow {
  id: string;
  subject: string;
  hourly_rate: number;
  accept_deadline: string;
  student_name: string | null;
  status: string;
  payment_deadline: string | null;
}

export function IncomingRequest({
  teacherId, onLiveSessionChange,
}: {
  teacherId: string;
  // Reports whether this teacher is currently committed to a student, so
  // presence can drop them from the online list for the whole payment window
  // (M3 spec §9). Must be a stable function — a useState setter is.
  onLiveSessionChange?: (inSession: boolean) => void;
}) {
  const router = useRouter();
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Latches once the row this card was showing reaches `active`, so a
  // redelivered UPDATE (the same event twice, or a later one that arrives
  // while router.push is still resolving) can't call push a second time.
  // Mirrors leavingRef in the student's waiting-client.tsx.
  const navigatedRef = useRef(false);
  // Which row the card is showing, tracked by us rather than inferred from
  // React's committed state. The previous code set a `matched` flag INSIDE a
  // setRequest updater and read it on the next line; React only evaluates an
  // updater eagerly when the fiber has no pending update, so the `active`
  // event — arriving milliseconds after `paid` queued one — had its updater
  // deferred to render, `matched` stayed false, and the teacher was never
  // navigated into the room their student had just paid for. Before M3 there
  // was a single accepted -> active update and the bug could not appear.
  const showingRef = useRef<string | null>(null);

  useEffect(() => {
    // An ack or a query can land after this effect is torn down (React
    // StrictMode's mount -> cleanup -> remount reproduces it).
    let mounted = true;
    let channel: RealtimeChannel | null = null;

    const toRequest = (row: SessionRow): PendingRequest => ({
      id: row.id,
      subject: row.subject,
      hourly_rate: row.hourly_rate,
      accept_deadline: row.accept_deadline,
      student_name: row.student_name || "A student",
      status:
        row.status === "pending" ? "pending"
        : row.status === "paid" ? "paid"
        : "accepted",
      payment_deadline: row.payment_deadline,
    });

    void (async () => {
      // Awaited before subscribing: a socket that joins as `anon` acks
      // SUBSCRIBED and then silently receives nothing, which is how a
      // student's request stayed invisible until a manual refresh.
      const supabase = await createRealtimeClient();
      if (!mounted) return;

      // A request that landed before this component subscribed would
      // otherwise never be seen. Reachable on a return from a call, a
      // reload, or a socket rejoin — and since Task 9 that reload can land
      // mid-payment-window too: accepting used to redirect instantly, so no
      // reload could ever catch a row sitting in `accepted`/`paid`. Now that
      // window is up to 120s wide, so the catch-up query has to look for
      // those rows as well, not just `pending` — otherwise a teacher who
      // reloads while their student is paying finds nothing, and the
      // eventual `active` update has no local `request` to match against,
      // so the navigation below never fires.
      void (async () => {
        // Three rows, not one. `limit(1)` on created_at desc answered the
        // wrong question: if a second student sent a request while this
        // teacher was mid-payment-window, the newer pending row won and
        // masked the teacher's own in-flight session, so the eventual
        // `active` update had no card to match and the teacher never reached
        // their own call. pickOpenRequest ranks commitment above recency and
        // drops rows whose clock has already run out.
        const { data: rows } = await supabase
          .from("sessions")
          .select("id, subject, hourly_rate, accept_deadline, student_name, status, payment_deadline, started_at, duration_minutes")
          .eq("teacher_id", teacherId)
          .in("status", ["pending", "accepted", "paid", "active"])
          .order("created_at", { ascending: false })
          .limit(3);
        if (!mounted || !rows) return;

        // `active` is in that list because this is the ONLY route back into a
        // session after a reload, and M3 made reloads reachable here: accept
        // no longer redirects, so the teacher sits on this page while the row
        // goes accepted -> paid -> active. Without it, a teacher who reloaded
        // (or whose realtime navigation failed) found nothing, went back to
        // "Available", and had no way into a room their student had already
        // paid for — money taken, nothing delivered.
        //
        // Filtered through effectiveStatus, not the stored column: an `active`
        // row past its hour reads as completed, and pushing into it would have
        // the call page bounce straight back here and start again.
        const now = new Date();
        const live = rows.find(
          (r) => effectiveStatus({ ...r, status: r.status as SessionStatus }, now) === "active"
        );
        if (live) {
          navigatedRef.current = true;
          router.push(`/call/${live.id}`);
          return;
        }

        const row = pickOpenRequest(
          rows.map((r) => ({ ...r, status: r.status as SessionStatus })),
          now
        );
        if (!row) return;
        // A live INSERT/UPDATE that arrived while this query was in flight is newer.
        if (showingRef.current) return;
        showingRef.current = row.id;
        setRequest((prev) => prev ?? toRequest(row));
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
            const row = payload.new as SessionRow;
            if (!mounted || row.status !== "pending") return;
            setError(null);
            showingRef.current = row.id;
            setRequest(toRequest(row));
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
            if (!mounted || navigatedRef.current) return;
            const row = payload.new as {
              id: string;
              status: string;
              payment_deadline: string | null;
            };
            // Decided against our own ref, never against React's committed
            // state — see showingRef above for why that distinction cost a
            // paid session.
            if (showingRef.current !== row.id) return;

            // Navigate FIRST and unconditionally. This is the branch that
            // moves a teacher into a room their student has paid for, so it
            // must not sit behind a state update landing.
            if (row.status === "active") {
              navigatedRef.current = true;
              router.push(`/call/${row.id}`);
              return;
            }

            // Accepting does not end the prompt any more — it becomes the
            // "waiting for payment" state until the student pays or the
            // window closes.
            if (row.status === "accepted") {
              setRequest((prev) =>
                prev ? { ...prev, status: "accepted", payment_deadline: row.payment_deadline } : prev
              );
              return;
            }
            // `paid` stops the countdown: the money is in and only the webhook
            // moves the row from here.
            if (row.status === "paid") {
              setRequest((prev) => (prev ? { ...prev, status: "paid" } : prev));
              return;
            }
            // Anything else is terminal (declined, timed_out, cancelled,
            // payment_expired) — leaving the prompt up would offer an action
            // that can only fail.
            showingRef.current = null;
            setRequest(null);
          }
        )
        .subscribe();
    })();

    return () => {
      mounted = false;
      channel?.unsubscribe();
    };
  }, [teacherId, router]);

  // The card's "accepted" state covers both `accepted` and `paid` in the
  // database (toRequest collapses them), which is exactly the span a teacher
  // must be hidden for. Derived from `request` rather than signalled at each
  // call site so that no path — the realtime UPDATE, the catch-up query, or
  // the countdown hitting zero — can forget to report it.
  const inSession = request?.status === "accepted" || request?.status === "paid";
  useEffect(() => {
    onLiveSessionChange?.(inSession);
  }, [inSession, onLiveSessionChange]);

  // Local countdown. Which deadline is live depends on which state we're
  // in: the 30s accept window while pending, the 120s payment window once
  // accepted — using the wrong one would make the countdown lie about how
  // long is actually left. `request` as a whole is the dependency (rather
  // than picking out a single field) so a status flip, which always
  // produces a new object, restarts the timer against the new deadline.
  useEffect(() => {
    if (!request) return;
    // A paid row has no live deadline — nothing about it expires any more, so
    // it gets no countdown and, crucially, is never cleared by one.
    if (request.status === "paid") return;
    const deadline =
      request.status === "accepted" ? request.payment_deadline : request.accept_deadline;
    if (!deadline) return;
    const tick = () => {
      const remaining = secondsRemaining(deadline, new Date());
      setLeft(remaining);
      if (remaining === 0) {
        showingRef.current = null;
        setRequest(null);
      }
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
    <Card className="flex flex-row items-start justify-between gap-4 border-red-200 bg-red-50 px-6 py-4">
      <p className="text-red-700 text-sm">{error}</p>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setError(null)}
        className="shrink-0 text-red-700 hover:bg-red-100"
      >
        Dismiss
      </Button>
    </Card>
  );

  if (!request) return banner ? banner : null;

  async function accept(id: string) {
    setBusy(true);
    setError(null);
    try {
      // acceptSession no longer redirects — it just agrees the price and
      // starts the payment window (Task 7). The move into the "waiting for
      // payment" state happens when the realtime UPDATE above lands, not
      // here.
      const result = await acceptSession(id);
      if (result?.error) setError(result.error);
    } catch (e) {
      // acceptSession returns {error} for the failures it anticipates, but a
      // rejection — a network fault, an uncaught server exception — would
      // otherwise skip the reset below and leave both buttons disabled with
      // no error, which is the regression this task exists to close.
      console.error(`[incoming-request] accept failed for ${id}:`, e);
      setError("Couldn't accept the request — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function decline(id: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await declineSession(id);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setRequest(null);
    } catch (e) {
      // Same unhandled-rejection risk as accept() above.
      console.error(`[incoming-request] decline failed for ${id}:`, e);
      setError("Couldn't decline the request — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {banner}
      <Card className="border-2 border-teal-500 p-6 shadow-xl">
        {request.status === "paid" ? (
          <>
            <p className="text-lg font-bold text-gray-900 mb-1">
              {request.student_name} has paid
            </p>
            <p className="text-sm text-gray-600">Opening your room…</p>
          </>
        ) : request.status === "accepted" ? (
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
              <Button type="button" disabled={busy} onClick={() => accept(request.id)}>
                Accept
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => decline(request.id)}
              >
                Decline
              </Button>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
