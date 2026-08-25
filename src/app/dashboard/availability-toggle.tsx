"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { PRESENCE_CHANNEL } from "@/lib/presence";

export function AvailabilityToggle({
  teacherId, fullName, hourlyRate,
}: { teacherId: string; fullName: string; hourlyRate: number }) {
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Guards the async subscribe() status callback below: an ack can arrive
  // after the component has unmounted, or after channelRef has moved on to a
  // newer channel (React StrictMode's dev-time mount -> cleanup -> remount
  // reproduces this reliably). Without these checks a stale ack could still
  // call track() on a channel nothing will ever untrack — a ghost teacher.
  const mountedRef = useRef(true);
  // Set for the duration of an intentional goOffline() teardown, so the
  // CLOSED status that unsubscribe() naturally produces isn't mistaken for a
  // failed handshake and surfaced as an error.
  const closingRef = useRef(false);

  // Leaving the page must drop presence, or the list shows a ghost.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      channelRef.current?.unsubscribe();
      channelRef.current = null;
    };
  }, []);

  // Accepting a request navigates to the call, which unmounts this component
  // and drops presence — correct, since a busy teacher must not appear
  // startable. But without this, the teacher returns from the session silently
  // offline while believing they are still available (design spec §3.1: the
  // teacher re-tracks when the session ends). Remember the intent and restore it.
  useEffect(() => {
    let wanted = false;
    try {
      wanted = localStorage.getItem(`smb-available-${teacherId}`) === "1";
    } catch {
      // Private mode or blocked storage — start offline rather than crash.
    }
    if (wanted) void goOnline();
    // goOnline is stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId]);

  function rememberIntent(available: boolean) {
    try {
      localStorage.setItem(`smb-available-${teacherId}`, available ? "1" : "0");
    } catch {
      // Non-fatal: the toggle still works for this page view.
    }
  }

  async function goOnline() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const channel = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: teacherId } },
    });
    channelRef.current = channel;
    channel.subscribe(async (status) => {
      // Stale ack: the component is gone, or a newer channel has already
      // replaced this one. Do nothing — no track, no setState.
      if (!mountedRef.current || channelRef.current !== channel) return;

      if (status === "SUBSCRIBED") {
        await channel.track({
          teacher_id: teacherId,
          full_name: fullName,
          hourly_rate: hourlyRate,
        });
        // Re-check after the await: unmount or a newer channel could have
        // arrived while track() was in flight.
        if (!mountedRef.current || channelRef.current !== channel) return;
        setOnline(true);
        setBusy(false);
        setError(null);
        rememberIntent(true);
        return;
      }

      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        // A CLOSED ack is also the normal result of goOffline() tearing this
        // channel down on purpose — not a failure, so don't report it.
        if (closingRef.current) return;
        channelRef.current = null;
        setOnline(false);
        setBusy(false);
        setError("Couldn't go available — try again.");
        channel.unsubscribe();
      }
    });
  }

  async function goOffline() {
    setBusy(true);
    setError(null);
    closingRef.current = true;
    await channelRef.current?.untrack();
    await channelRef.current?.unsubscribe();
    channelRef.current = null;
    closingRef.current = false;
    setOnline(false);
    setBusy(false);
    rememberIntent(false);
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${online ? "bg-green-500" : "bg-gray-300"}`}
            />
            <span className="font-bold text-gray-900">
              {online ? "Available now" : "Offline"}
            </span>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            {online
              ? "Students can see you and start a session. Keep this tab open — closing it takes you offline."
              : "You are not visible to students."}
          </p>
          {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
        </div>
        <button
          type="button"
          onClick={online ? goOffline : goOnline}
          disabled={busy}
          className={`font-semibold px-6 py-3 rounded-lg transition-all shadow-md disabled:opacity-50 ${
            online
              ? "bg-white border-2 border-gray-300 text-gray-700 hover:border-gray-400"
              : "bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white"
          }`}
        >
          {busy ? "…" : online ? "Go offline" : "Available now"}
        </button>
      </div>
    </section>
  );
}
