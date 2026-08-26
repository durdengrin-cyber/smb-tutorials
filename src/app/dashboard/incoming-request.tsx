"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { secondsRemaining } from "@/lib/session";
import { acceptSession, declineSession } from "./actions";

interface PendingRequest {
  id: string;
  subject: string;
  hourly_rate: number;
  accept_deadline: string;
  student_name: string;
}

// The columns a pending request needs, from either the realtime payload or the
// catch-up query below.
interface SessionRow {
  id: string;
  subject: string;
  hourly_rate: number;
  accept_deadline: string;
  student_id: string;
}

export function IncomingRequest({ teacherId }: { teacherId: string }) {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    // An INSERT ack or a name lookup can land after this effect is torn down
    // (React StrictMode's mount -> cleanup -> remount reproduces it).
    let mounted = true;

    async function withStudentName(row: SessionRow): Promise<PendingRequest> {
      const { data: student } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", row.student_id)
        .single();
      return {
        id: row.id,
        subject: row.subject,
        hourly_rate: row.hourly_rate,
        accept_deadline: row.accept_deadline,
        student_name: student?.full_name || "A student",
      };
    }

    // A request that landed before this component subscribed would otherwise
    // never be seen — the teacher would sit idle while the student's 30s ran
    // out. Reachable on a return from a call, a reload, or a socket rejoin.
    (async () => {
      const { data: row } = await supabase
        .from("sessions")
        .select("id, subject, hourly_rate, accept_deadline, student_id")
        .eq("teacher_id", teacherId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!mounted || !row) return;
      if (secondsRemaining(row.accept_deadline, new Date()) === 0) return;
      const pending = await withStudentName(row);
      if (!mounted) return;
      // A live INSERT that arrived while this query was in flight is newer.
      setRequest((prev) => prev ?? pending);
    })();

    const channel = supabase
      .channel(`teacher-sessions-${teacherId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sessions",
          filter: `teacher_id=eq.${teacherId}`,
        },
        async (payload) => {
          const row = payload.new as SessionRow & { status: string };
          if (row.status !== "pending") return;
          const pending = await withStudentName(row);
          if (!mounted) return;
          setError(null);
          setRequest(pending);
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
          const row = payload.new as { id: string; status: string };
          if (!mounted || row.status === "pending") return;
          // The student cancelled, or this teacher answered in another tab.
          // Leaving the prompt up would offer an Accept that can only fail.
          setRequest((prev) => (prev && prev.id === row.id ? null : prev));
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      channel.unsubscribe();
    };
  }, [teacherId]);

  // Local countdown; the server re-checks the deadline on accept anyway.
  useEffect(() => {
    if (!request) return;
    const tick = () => {
      const remaining = secondsRemaining(request.accept_deadline, new Date());
      setLeft(remaining);
      if (remaining === 0) setRequest(null);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [request]);

  if (!request) return null;

  async function accept(id: string) {
    setBusy(true);
    setError(null);
    // On success this redirects and never returns a value.
    const result = await acceptSession(id);
    if (result?.error) {
      setError(result.error);
      setBusy(false);
    }
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
    <section className="bg-white rounded-2xl shadow-xl border-2 border-teal-500 p-6">
      <p className="text-lg font-bold text-gray-900 mb-1">
        New student request — {request.student_name} wants {request.subject} now, ₹
        {request.hourly_rate}/hr
      </p>
      <p className="text-sm text-gray-600 mb-4">{left}s to respond</p>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
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
    </section>
  );
}
