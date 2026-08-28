"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { PRESENCE_CHANNEL } from "@/lib/presence";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { StatusPill, STATUS_COPY, type TeacherStatus } from "@/components/status-pill";

export function AvailabilityToggle({
  teacherId, fullName, hourlyRate, inSession = false,
}: {
  teacherId: string;
  fullName: string;
  hourlyRate: number;
  // True from the moment this teacher accepts a request until that session
  // resolves. Distinct from being offline: the teacher still WANTS to be
  // available, they are just committed to someone right now, so presence is
  // dropped while the channel and their intent are kept.
  inSession?: boolean;
}) {
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
  // Read inside the subscribe() ack, which closed over `inSession` at
  // subscribe time. A session that starts while the handshake is still in
  // flight would otherwise track the teacher straight back into the list.
  const inSessionRef = useRef(inSession);
  // What we last told the channel: true = tracked, false = untracked, null =
  // nothing applied to the current channel yet. Without it the effect below
  // re-tracks on every render that touches it, churning presence for every
  // student watching the list.
  const visibleRef = useRef<boolean | null>(null);

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

  // M3 spec §9's root fix. Both specs require that a busy teacher is HIDDEN,
  // not greyed — "every visible card is genuinely startable" — and until now
  // the hiding was a side effect of accepting navigating into the call, i.e.
  // of reaching `active`. M3 put a 120-second payment window in front of
  // `active`, and this component stays mounted through all of it, so the
  // teacher kept advertising themselves to students who could only ever be
  // refused. Presence now follows the commitment, not the navigation.
  //
  // Untrack, don't unsubscribe: the channel and the teacher's remembered
  // intent both survive, so they reappear automatically when the window
  // resolves — paid, expired or cancelled — without touching the toggle.
  useEffect(() => {
    inSessionRef.current = inSession;
    const channel = channelRef.current;
    if (!channel || !online) return;
    const visible = !inSession;
    if (visibleRef.current === visible) return;
    visibleRef.current = visible;
    if (visible) {
      void channel.track({
        teacher_id: teacherId,
        full_name: fullName,
        hourly_rate: hourlyRate,
      });
    } else {
      void channel.untrack();
    }
  }, [inSession, online, teacherId, fullName, hourlyRate]);

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
        const visible = !inSessionRef.current;
        if (visible) {
          await channel.track({
            teacher_id: teacherId,
            full_name: fullName,
            hourly_rate: hourlyRate,
          });
        }
        visibleRef.current = visible;
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
        visibleRef.current = null;
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
    visibleRef.current = null;
    closingRef.current = false;
    setOnline(false);
    setBusy(false);
    rememberIntent(false);
  }

  // Three readings, not two. "In a session" is not "Offline": the teacher is
  // hidden from the list but still online and still intending to be
  // available, and saying "Offline" would invite them to toggle back on
  // mid-payment-window and undo it. "unreachable" has no mechanism behind it
  // yet in this cycle, so it is never produced here.
  const status: TeacherStatus = !online ? "offline" : inSession ? "in_session" : "available";

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <StatusPill status={status} />
          <p className="mt-1 text-sm text-muted-foreground">{STATUS_COPY[status].description}</p>
          {/* This warning stays true until reachability detection (a later
              cycle) lands — presence really does depend on this tab staying
              open, so it's an extra line here rather than folded into the
              shared copy, which will outlive it. */}
          {status === "available" && (
            <p className="mt-1 text-sm text-muted-foreground">
              Keep this tab open — closing it takes you offline.
            </p>
          )}
          {error && <FormError className="mt-1">{error}</FormError>}
        </div>
        <Button
          type="button"
          onClick={online ? goOffline : goOnline}
          disabled={busy}
          variant={online ? "outline" : "default"}
          size="lg"
        >
          {busy ? "…" : online ? "Go offline" : "Available now"}
        </Button>
      </div>
    </Card>
  );
}
