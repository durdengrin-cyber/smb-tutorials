"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PRESENCE_CHANNEL,
  rosterFromPresenceState,
  type OnlineTeacher,
} from "@/lib/presence";
import { deriveRoster, type AvailableRow } from "@/lib/roster";
import { TeacherCard, type TeacherCardData } from "./teacher-card";
import { requestSession } from "./actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { FormError } from "@/components/form-error";
import { Money } from "@/components/money";

// What actually happened, in the student's words. One fixed message used to
// serve every terminal status, so a student whose own payment window lapsed
// was told their teacher had ignored them. Anything unrecognised shows no
// banner at all rather than a wrong one — and `cancelled` is deliberately
// silent, because the student did it on purpose and does not need telling.
export function outcomeMessage(
  outcome: string | undefined,
  teacher: string | undefined,
  refundAmountPaise: number | undefined
): React.ReactNode {
  const who = teacher || "That teacher";
  switch (outcome) {
    case "timed_out":
      return `${who} didn't respond — these teachers are free now`;
    case "declined":
      return `${who} couldn't take this session — these teachers are free now`;
    case "payment_expired":
      return "The payment window closed before your payment came through. You have not been charged — pick a teacher to try again.";
    case "refunded":
      // Reached both when room minting failed after payment, and when a
      // payment landed late on a session that had already ended. The student
      // does not care which: they care that the money is on its way back.
      // The amount travels from the session row via the /teachers query
      // string (see waiting/[sessionId]/page.tsx) — never hardcode a figure
      // here, or a student refunded a different amount is told the wrong one.
      return refundAmountPaise ? (
        <>
          Your <Money paise={refundAmountPaise} /> has been refunded — that
          session didn&apos;t go ahead. It can take a few days to show on your
          statement.
        </>
      ) : (
        "Your payment has been refunded — that session didn't go ahead. It can take a few days to show on your statement."
      );
    case "completed":
      return "That session has ended.";
    case "teacher_unavailable":
      // Never "the teacher was reported": the student learning that a report
      // exists is a disclosure about a third party's complaint. What they
      // need is that the session is off and where their money went.
      return refundAmountPaise ? (
        <>
          {who} is no longer available, so that session can&apos;t go ahead.
          Your <Money paise={refundAmountPaise} /> has been refunded — it can
          take a few days to show on your statement. These teachers are free
          now.
        </>
      ) : (
        `${who} is no longer available, so that session can't go ahead. You have not been charged — these teachers are free now.`
      );
    default:
      return null;
  }
}

export function OnlineList({
  eligible,
  subject,
  curriculum,
  grade,
  stream,
  outcome,
  teacherName,
  refundAmountPaise,
}: {
  eligible: TeacherCardData[];
  subject: string;
  curriculum: string;
  grade: string;
  stream: string;
  outcome?: string;
  teacherName?: string;
  refundAmountPaise?: number;
}) {
  const [roster, setRoster] = useState<OnlineTeacher[]>([]);
  // The push-only tier: a snapshot from available_teachers, not a stream —
  // see the polling effect below for why it needs refreshing at all.
  const [available, setAvailable] = useState<AvailableRow[]>([]);
  // "Have we ever heard back?" is a DIFFERENT question from "is the list
  // empty", and conflating them is what let a failed read render as a
  // confident "no teachers online". deriveRoster requires membership in
  // `available` for EVERY teacher — the live-presence tier included — so
  // before the first successful load the derived list is necessarily empty,
  // whether or not anyone is actually available.
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [rosterFailed, setRosterFailed] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An empty roster because the handshake failed looks exactly like an empty
  // roster because nobody is teaching right now. Tracked separately so the
  // student is told which one it is.
  const [connFailed, setConnFailed] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(PRESENCE_CHANNEL);
    // Guards the async callbacks below: an ack or a sync can land after this
    // effect has been cleaned up (React StrictMode's mount -> cleanup ->
    // remount reproduces it), and setState on the torn-down channel would
    // show a roster this component no longer owns.
    let mounted = true;

    // The presence listener also switches presence on for this client; without
    // it (or config.presence.enabled) presenceState() stays permanently empty.
    channel.on("presence", { event: "sync" }, () => {
      if (!mounted) return;
      setRoster(rosterFromPresenceState(channel.presenceState<OnlineTeacher>()));
    });

    channel.subscribe((status) => {
      if (!mounted) return;
      if (status === "SUBSCRIBED") {
        setConnFailed(false);
        return;
      }
      // CLOSED is the normal result of the cleanup below, which has already
      // set mounted = false — so reaching here means a genuine failure.
      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        setConnFailed(true);
        setRoster([]);
      }
    });

    return () => {
      mounted = false;
      channel.unsubscribe();
    };
  }, []);

  // Presence streams the live tier; the push-only tier is a snapshot from the
  // RPC, so it needs refreshing or a teacher who declares while the student
  // watches never appears. Polling was chosen over Broadcast deliberately
  // (spec §4.4.2): it scales with STUDENTS, whereas postgres_changes scales
  // with teachers x students — ~67 req/s at 2,000 concurrent students, which
  // is nothing. When this is outgrown the replacement is Broadcast, behind
  // available_teachers, never postgres_changes.
  useEffect(() => {
    let mounted = true;
    const supabase = createClient();

    async function load() {
      const { data, error: rpcError } = await supabase.rpc("available_teachers", {
        p_curriculum: curriculum,
        p_grade: grade,
        p_stream: stream,
        p_subject: subject,
      });
      if (!mounted) return;
      if (rpcError) {
        // Keep the last good snapshot and retry on the next poll or focus —
        // but SAY so. Returning silently was the bug: on the first load the
        // last good snapshot is [], so the whole list (presence tier and all)
        // collapses into an EmptyState asserting nobody is online, which is a
        // claim we have no basis for. This is precisely the dishonesty the
        // cycle exists to remove, on the primary student surface.
        console.error("[online-list] available_teachers failed", rpcError);
        setRosterFailed(true);
        return;
      }
      setRosterFailed(false);
      setRosterLoaded(true);
      setAvailable((data as AvailableRow[] | null) ?? []);
    }

    void load();
    window.addEventListener("focus", load);
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load();
    }, 30_000);

    return () => {
      mounted = false;
      window.removeEventListener("focus", load);
      clearInterval(id);
    };
  }, [curriculum, grade, stream, subject]);

  const online = deriveRoster(eligible, available, roster);
  // requestSession validates the taxonomy, so starting from an unfiltered list
  // can only ever return "Pick a subject before starting." Say so up front
  // instead of letting the click fail.
  const canStart = Boolean(subject && curriculum && grade && stream);

  async function start(teacherId: string) {
    setPendingId(teacherId);
    setError(null);
    const result = await requestSession({
      teacherId,
      subject,
      curriculum,
      grade,
      stream,
    });
    if (result?.error) {
      setError(result.error);
      setPendingId(null);
    }
    // On success the action redirects to /waiting/{id}.
  }

  // Computed once and rendered above every branch below: a student who was
  // just refunded or timed out needs to see what happened to their money
  // whether or not anyone happens to be online right now — and an empty
  // roster is the likeliest state right after a timeout.
  const banner = outcomeMessage(outcome, teacherName, refundAmountPaise);

  // Was: a full replacement of the list with a "Couldn't check who's online"
  // card. That was correct when presence was the only signal a teacher was
  // reachable. It is now actively wrong — it would hide the push-only tier,
  // which does not depend on this channel at all, and those teachers are
  // genuinely startable. So this degrades to a banner over a list that keeps
  // rendering, with the copy narrowed to what is actually still true.
  // ONE notice for degraded reachability, never two. connFailed and
  // rosterFailed are different halves of the same list — presence streams the
  // live tier, the RPC snapshot carries the push-only tier — and rendering a
  // box per half stacked two visually identical amber banners saying
  // overlapping things. Slate rather than amber also separates "the system is
  // degraded" from the outcome banner's "here is what happened to YOUR
  // session", which is what a student actually needs to tell apart.
  const degraded: string | null = connFailed && rosterFailed
    ? "We're having trouble checking who's available, so this list may be incomplete."
    : connFailed
      ? "We lost the live connection, so teachers who are at their desk right now may be missing from this list."
      : rosterFailed
        ? "We couldn't refresh who's available just now, so this list may be out of date."
        : null;

  const connBanner = degraded && (
    <div className="mb-6 rounded-xl border border-border bg-muted px-4 py-3 text-foreground">
      {degraded}
    </div>
  );

  if (online.length === 0) {
    return (
      <>
        {connBanner}
        {banner && (
          <div className="mb-6 rounded-xl border border-primary/30 bg-primary/12 px-4 py-3 text-foreground">
            {banner}
          </div>
        )}
        {/* Only claim nobody is online once we have actually been told so.
            Until the first successful roster read, an empty derived list means
            "we don't know yet" — asserting otherwise sends a student away from
            teachers who are available and startable right now. */}
        {rosterLoaded ? (
          <EmptyState
            title={
              subject
                ? `No teachers online for ${subject} right now`
                : "No teachers available right now"
            }
            description="Teachers appear here only while they're online and ready to start immediately. Try again in a few minutes, or pick a different subject."
            action={
              <Button asChild variant="outline">
                <Link href="/find">Change subject</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="Couldn't check who's available"
            description="This is on us, not you — the list will refresh by itself in a few seconds. If it keeps failing, try reloading the page."
            action={
              <Button asChild variant="outline">
                <Link href="/find">Change subject</Link>
              </Button>
            }
          />
        )}
      </>
    );
  }

  return (
    <>
      {connBanner}
      {banner && (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/12 px-4 py-3 text-foreground">
          {banner}
        </div>
      )}
      {error && <FormError className="mb-4">{error}</FormError>}
      {!canStart && (
        <div className="mb-6 rounded-xl border border-border bg-muted px-4 py-3 text-foreground">
          Pick a subject on{" "}
          <a href="/find" className="text-primary font-semibold hover:underline">
            Find a teacher
          </a>{" "}
          to start a session — these teachers are online now.
        </div>
      )}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {online.map((teacher) => (
          <TeacherCard
            key={teacher.id}
            teacher={teacher}
            onStart={canStart ? () => start(teacher.id) : undefined}
            starting={pendingId === teacher.id}
          />
        ))}
      </div>
    </>
  );
}
