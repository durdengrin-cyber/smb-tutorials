"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { PRESENCE_CHANNEL } from "@/lib/presence";
import { formatLeaseEnd, isLeaseLive } from "@/lib/availability";
import { closeStaleNotifications } from "@/lib/push/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { StatusPill, STATUS_COPY, type TeacherStatus } from "@/components/status-pill";
import { declareAvailable, undeclareAvailable, renewLease } from "./actions";

// How often a live client asks the server to extend the lease. The server
// (renewLease -> shouldRenew) decides whether that write actually happens —
// this cadence just has to be short enough to reliably catch the halfway
// point before the lease lapses, not to match it.
const RENEW_INTERVAL_MS = 10 * 60 * 1000;

export function AvailabilityToggle({
  teacherId, fullName, hourlyRate, inSession = false,
  declaredUntil, hasDevice, channelFailed = false, suspended = false,
}: {
  teacherId: string;
  fullName: string;
  hourlyRate: number;
  // True from the moment this teacher accepts a request until that session
  // resolves. Distinct from being offline: the teacher still WANTS to be
  // available, they are just committed to someone right now, so presence is
  // dropped while the channel and the declaration are kept.
  inSession?: boolean;
  // The durable half of "available" (spec §4.1), read server-side in
  // page.tsx and threaded down through DashboardLive. This — not
  // localStorage — is what a page load actually knows on first paint.
  declaredUntil: string | null;
  // Does ANY of this teacher's devices hold a push subscription — server
  // read of teacher_devices, not this browser's own readSetupFacts(). A
  // teacher reachable on their phone while sitting at this desktop is
  // genuinely reachable; asking only this browser would tell them
  // otherwise (spec §6.1 step 7).
  hasDevice: boolean;
  // Optional and defaulting to false, OR-ed with the channel health this
  // component tracks for itself. The toggle still owns the real presence
  // handshake below; this just lets a test force the unreachable branch
  // deterministically instead of simulating a websocket failure.
  channelFailed?: boolean;
  // Server-read from my_suspension() in page.tsx (Task 4 Step 2). Outranks
  // every other state below and disables the control — the server has
  // already stopped showing this teacher to students, so the pill must not
  // claim otherwise, and the toggle must not let them undo an exclusion
  // that isn't theirs to lift.
  suspended?: boolean;
}) {
  // Local override of the server-read prop. Needed because page.tsx is a
  // Server Component — nothing re-fetches it after declareAvailable() or
  // undeclareAvailable() run, so the moment the teacher acts, this is the
  // only copy of the truth left in the tree. Initialised from the prop so a
  // fresh mount shows exactly what the server already knew, with no flash.
  const [leaseUntil, setLeaseUntil] = useState(declaredUntil);
  // Whether THIS browser's presence channel is currently subscribed and
  // tracked. Distinct from `leaseUntil` being live: a declaration can be
  // live with no open tab at all (push-only reachability), and a tab can be
  // open with the handshake still failing.
  const [channelHealthy, setChannelHealthy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Guards the async subscribe() status callback below: an ack can arrive
  // after the component has unmounted, or after channelRef has moved on to a
  // newer channel (React StrictMode's dev-time mount -> cleanup -> remount
  // reproduces this reliably). Without these checks a stale ack could still
  // call track() on a channel nothing will ever untrack — a ghost teacher.
  const mountedRef = useRef(true);
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

  // A teacher who arrived by tapping a notification is looking at the
  // dashboard now, and incoming-request.tsx's catch-up query has already put
  // the request card in front of them. There is no dismissal push available
  // to us, so this is the only place a stale notification can be cleared
  // (spec §5.2).
  useEffect(() => {
    void closeStaleNotifications();
  }, []);

  // On mount and every RENEW_INTERVAL_MS while the tab is visible, ask the
  // server to extend the lease. shouldRenew (server-side) decides whether
  // that turns into a write — this effect only ever asks.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (document.visibilityState !== "visible") return;
      const result = await renewLease();
      if (cancelled) return;
      // Reconcile in BOTH directions. A null here means the server says this
      // teacher is not declared — because they went offline on another device,
      // or the row was cleared — and adopting it is what stops this dashboard
      // insisting "Available until ..." at a teacher no student can see.
      if ("declaredUntil" in result) setLeaseUntil(result.declaredUntil);
    }
    void tick();
    const id = setInterval(tick, RENEW_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Presence follows the DECLARATION now, not a click. Opens the channel the
  // instant the lease is live (covering both an explicit "Available now" and
  // a page load that finds an already-live lease from an earlier tab), and
  // tears it down the instant it isn't (an explicit "Go offline", or a lease
  // that lapsed without renewal).
  useEffect(() => {
    if (!isLeaseLive(leaseUntil, new Date())) {
      const channel = channelRef.current;
      if (channel) {
        void channel.untrack().then(() => channel.unsubscribe());
        channelRef.current = null;
        visibleRef.current = null;
        setChannelHealthy(false);
      }
      return;
    }
    if (channelRef.current) return;

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
        setChannelHealthy(true);
        setError(null);
        return;
      }

      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        // A CLOSED ack is also the normal result of the teardown above, but
        // that doesn't need handling here: teardown nulls channelRef.current
        // synchronously, before either the untrack() or unsubscribe() promise
        // it kicks off can settle, so by the time any resulting ack fires the
        // guard at the top of this callback (channelRef.current !== channel)
        // has already returned before reaching this branch at all.
        channelRef.current = null;
        visibleRef.current = null;
        setChannelHealthy(false);
        channel.unsubscribe();
      }
    });
    // teacherId/fullName/hourlyRate identify this teacher for the lifetime
    // of the component; only `leaseUntil` decides whether a channel should
    // exist right now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseUntil]);

  // M3 spec §9's root fix, unchanged by this task: a busy teacher is HIDDEN,
  // not greyed. Untrack, don't unsubscribe — the channel and the
  // declaration both survive, so the teacher reappears automatically when
  // the payment window resolves.
  useEffect(() => {
    inSessionRef.current = inSession;
    const channel = channelRef.current;
    if (!channel || !channelHealthy) return;
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
  }, [inSession, channelHealthy, teacherId, fullName, hourlyRate]);

  async function goOnline() {
    setBusy(true);
    setError(null);
    const result = await declareAvailable();
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    // The channel effect above opens the connection the moment this makes
    // the lease live — nothing else to do here.
    setLeaseUntil(result.declaredUntil);
  }

  async function goOffline() {
    setBusy(true);
    setError(null);
    const result = await undeclareAvailable();
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setLeaseUntil(null);
  }

  const leaseLive = isLeaseLive(leaseUntil, new Date());
  // The prop and the channel's own tracked health both have to say "ok" —
  // either one failing is enough to make this browser unreachable via a
  // live connection.
  const channelOk = channelHealthy && !channelFailed;

  // Five readings (spec §6.1). "In a session" and "Can't reach you" are both
  // distinct from "Offline": the teacher still intends to be available in
  // both, and calling either "Offline" would invite them to toggle back on
  // and undo a state that isn't theirs to fix that way.
  //
  // Suspension outranks every other state: the server has already stopped
  // showing them to students, so the pill must not claim otherwise.
  const status: TeacherStatus = suspended
    ? "suspended"
    : !leaseLive
      ? "offline"
      : inSession
        ? "in_session"
        : channelOk || hasDevice
          ? "available"
          : "unreachable";

  // A lapsed lease still reads "Offline" in the pill — that vocabulary is
  // unchanged — but the description underneath says what actually happened,
  // rather than leaving the teacher to infer it from a toggle that silently
  // moved (spec §4.1).
  let description: string = STATUS_COPY[status].description;
  if (status === "offline" && leaseUntil) {
    description = `Your availability ended at ${formatLeaseEnd(leaseUntil)}.`;
  } else if (status === "available" && leaseUntil) {
    description = `Available until ${formatLeaseEnd(leaseUntil)} — we'll notify you even with your phone locked.`;
  }
  // "unreachable" needs nothing extra here: the setup card that can fix it
  // is already on this page (Task 11), one component above this one.

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <StatusPill status={status} />
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          {error && <FormError className="mt-1">{error}</FormError>}
        </div>
        <Button
          type="button"
          onClick={leaseLive ? goOffline : goOnline}
          // Suspended, this stays disabled either way: a teacher already
          // declared live must not be able to renew that declaration, and one
          // who is not must not be able to toggle themselves back into a list
          // they are excluded from.
          disabled={busy || suspended}
          variant={leaseLive ? "outline" : "default"}
          size="lg"
        >
          {busy ? "…" : leaseLive ? "Go offline" : "Available now"}
        </Button>
      </div>
    </Card>
  );
}
