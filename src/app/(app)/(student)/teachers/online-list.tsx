"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PRESENCE_CHANNEL,
  rosterFromPresenceState,
  intersectOnline,
  type OnlineTeacher,
} from "@/lib/presence";
import { TeacherCard, type TeacherCardData } from "./teacher-card";
import { requestSession } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { FormError } from "@/components/form-error";
import { Money } from "@/components/money";

// What actually happened, in the student's words. One fixed message used to
// serve every terminal status, so a student whose own payment window lapsed
// was told their teacher had ignored them. Anything unrecognised shows no
// banner at all rather than a wrong one — and `cancelled` is deliberately
// silent, because the student did it on purpose and does not need telling.
function outcomeMessage(
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

  const online = intersectOnline(eligible, roster);
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

  if (connFailed) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <div className="text-5xl mb-4">📡</div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Couldn&apos;t check who&apos;s online
          </h3>
          <p className="text-gray-600">
            We lost the live connection, so this list may be out of date.
            Refresh to try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (online.length === 0) {
    return (
      <>
        {banner && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            {banner}
          </div>
        )}
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
      </>
    );
  }

  return (
    <>
      {banner && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          {banner}
        </div>
      )}
      {error && <FormError className="mb-4">{error}</FormError>}
      {!canStart && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-700">
          Pick a subject on{" "}
          <a href="/find" className="text-teal-600 font-semibold hover:underline">
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
