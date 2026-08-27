"use client";

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

// What actually happened, in the student's words. One fixed message used to
// serve every terminal status, so a student whose own payment window lapsed
// was told their teacher had ignored them. Anything unrecognised shows no
// banner at all rather than a wrong one — and `cancelled` is deliberately
// silent, because the student did it on purpose and does not need telling.
function outcomeMessage(outcome?: string, teacher?: string): string | null {
  const who = teacher || "That teacher";
  switch (outcome) {
    case "timed_out":
      return `${who} didn't respond — these teachers are free now`;
    case "declined":
      return `${who} couldn't take this session — these teachers are free now`;
    case "payment_expired":
      return "The payment window closed before your payment came through. You have not been charged — pick a teacher to try again.";
    case "refunded":
      return `Your payment has been refunded — we couldn't open the room with ${who}. These teachers are free now.`;
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
}: {
  eligible: TeacherCardData[];
  subject: string;
  curriculum: string;
  grade: string;
  stream: string;
  outcome?: string;
  teacherName?: string;
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

  if (connFailed) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
        <div className="text-5xl mb-4">📡</div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">
          Couldn&apos;t check who&apos;s online
        </h3>
        <p className="text-gray-600">
          We lost the live connection, so this list may be out of date. Refresh
          to try again.
        </p>
      </div>
    );
  }

  if (online.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
        <div className="text-5xl mb-4">🌙</div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">
          No teachers online for {subject || "this subject"} right now
        </h3>
        <p className="text-gray-600 mb-6">
          Teachers come online through the day. You can ask a specific teacher
          to come online, or book a time — both arrive soon.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            disabled
            title="Teacher requests arrive in M4"
            className="bg-white border-2 border-teal-600 text-teal-600 font-semibold px-6 py-3 rounded-lg opacity-50 cursor-not-allowed"
          >
            Request a teacher
          </button>
          <button
            type="button"
            disabled
            title="Scheduling arrives after the instant tier"
            className="bg-white border-2 border-gray-300 text-gray-600 font-semibold px-6 py-3 rounded-lg opacity-50 cursor-not-allowed"
          >
            Schedule for later
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {outcomeMessage(outcome, teacherName) && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          {outcomeMessage(outcome, teacherName)}
        </div>
      )}
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
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
