import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createMeetingToken, roomNameForSession } from "@/lib/daily";
import {
  effectiveStatus,
  roomTtlSeconds,
  type SessionStatus,
} from "@/lib/session";
import { CallFrame } from "./call-frame";

export default async function CallPage({
  params,
}: PageProps<"/call/[sessionId]">) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: session } = await supabase
    .from("sessions")
    .select(
      "id, student_id, teacher_id, subject, status, accept_deadline, started_at, duration_minutes, daily_room_url, student_name"
    )
    .eq("id", sessionId)
    .single();
  if (!session) redirect("/");

  const isTeacher = session.teacher_id === user.id;
  const isStudent = session.student_id === user.id;
  if (!isTeacher && !isStudent) redirect("/");

  const returnTo = isTeacher ? "/dashboard" : "/teachers";

  const status = effectiveStatus(
    { ...session, status: session.status as SessionStatus },
    new Date()
  );
  if (status !== "active" || !session.daily_room_url) redirect(returnTo);

  const { data: me } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  // Only the student can read the other party's profile — the policy from
  // migration 0001 hides students from teachers. The teacher reads the name
  // snapshotted onto the session row instead (migration 0004).
  let otherName: string;
  if (isTeacher) {
    otherName = session.student_name || "Your student";
  } else {
    const { data: teacher } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", session.teacher_id)
      .single();
    otherName = teacher?.full_name ?? "Your teacher";
  }

  // Per-user token: the student cannot join as the teacher (spec §15).
  // createMeetingToken throws if Daily is unreachable or the key is wrong —
  // caught here so a provider outage reads as a sentence rather than Next's
  // error page. redirect() stays outside: it works by throwing.
  let token: string;
  try {
    token = await createMeetingToken(
      roomNameForSession(sessionId),
      me?.full_name || "Participant",
      isTeacher,
      process.env.DAILY_API_KEY ?? "",
      fetch,
      // Pinned to the same wall-clock end as the room, so reloading mid-call
      // cannot mint a credential that outlives the session.
      roomTtlSeconds(session.started_at!, session.duration_minutes, new Date())
    );
  } catch {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 max-w-md w-full text-center">
          <div className="text-5xl mb-4">🎥</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Couldn&apos;t open the call
          </h2>
          <p className="text-gray-600 mb-6">
            The video service didn&apos;t respond. Your session is still
            running — reload to try joining again.
          </p>
          <Link
            href={returnTo}
            className="inline-block bg-white border-2 border-gray-300 hover:border-gray-400 text-gray-700 font-semibold px-6 py-3 rounded-lg"
          >
            Back
          </Link>
        </div>
      </main>
    );
  }

  return (
    <CallFrame
      sessionId={session.id}
      roomUrl={session.daily_room_url}
      token={token}
      otherName={otherName}
      subject={session.subject}
      // Non-null while status is active: acceptSession writes started_at in
      // the same update that sets the status.
      startedAt={session.started_at!}
      durationMinutes={session.duration_minutes}
      returnTo={returnTo}
    />
  );
}
