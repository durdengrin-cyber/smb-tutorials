import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
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
  const identity = await requireUser();
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select(
      "id, student_id, teacher_id, subject, status, accept_deadline, payment_deadline, started_at, duration_minutes, daily_room_url, student_name"
    )
    .eq("id", sessionId)
    .single();
  if (!session) redirect("/");

  // Ownership check, not an auth gate: this confirms the signed-in user is
  // one of THIS session's two participants. The layout above already
  // guarantees a signed-in user; this proves they belong on this row.
  const isTeacher = session.teacher_id === identity.userId;
  const isStudent = session.student_id === identity.userId;
  if (!isTeacher && !isStudent) redirect("/");

  // A student who has just finished a lesson used to be pushed to /teachers —
  // the online-now list — so the product's answer to "you finished" was "here
  // are more teachers to buy". Send them to their record instead.
  const returnTo = isTeacher ? "/dashboard" : "/sessions";

  const status = effectiveStatus(
    { ...session, status: session.status as SessionStatus },
    new Date()
  );
  if (status !== "active" || !session.daily_room_url) redirect(returnTo);

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
      identity.fullName || "Participant",
      isTeacher,
      process.env.DAILY_API_KEY ?? "",
      fetch,
      // Pinned to the same wall-clock end as the room, so reloading mid-call
      // cannot mint a credential that outlives the session.
      roomTtlSeconds(session.started_at!, session.duration_minutes, new Date())
    );
  } catch (e) {
    console.error(`[call] token mint failed for ${sessionId}:`, e);
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-5 sm:p-8">
        <div className="bg-card rounded-2xl shadow-sm border border-hair p-6 max-w-md w-full text-center sm:p-12">
          <h2 className="text-xl font-bold text-foreground mb-1">
            Couldn&apos;t open the call
          </h2>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary mb-4">
            {session.subject}
          </p>
          <p className="text-muted-foreground mb-6">
            The video service didn&apos;t respond. Your session is still
            running — reload to try joining again.
          </p>
          <Link
            href={returnTo}
            className="inline-block bg-card border-2 border-border hover:border-primary text-muted-foreground font-semibold px-6 py-3 rounded-lg"
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
