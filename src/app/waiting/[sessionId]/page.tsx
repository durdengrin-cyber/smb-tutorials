import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { effectiveStatus, type SessionStatus } from "@/lib/session";
import { WaitingClient } from "./waiting-client";

export default async function WaitingPage({
  params,
}: PageProps<"/waiting/[sessionId]">) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: session } = await supabase
    .from("sessions")
    .select(
      "id, student_id, teacher_id, curriculum, grade, stream, subject, status, accept_deadline, payment_deadline, started_at, duration_minutes"
    )
    .eq("id", sessionId)
    .single();
  if (!session || session.student_id !== user.id) redirect("/teachers");

  const { data: teacher } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", session.teacher_id)
    .single();

  const teacherName = teacher?.full_name ?? "your teacher";

  // Carry the student's original criteria back with them. Without this they
  // land on an unfiltered list and have to re-pick the subject before they can
  // try anyone else — and "Start now" there fails validation anyway.
  const criteria = {
    curriculum: session.curriculum,
    grade: session.grade,
    stream: session.stream,
    subject: session.subject,
  };
  const backToList = `/teachers?${new URLSearchParams(criteria)}`;
  const returnTo = `/teachers?${new URLSearchParams({
    ...criteria,
    didNotRespond: teacherName,
  })}`;

  const status = effectiveStatus(
    { ...session, status: session.status as SessionStatus },
    new Date()
  );
  if (status === "active") redirect(`/call/${sessionId}`);
  if (status !== "pending") redirect(returnTo);

  return (
    <WaitingClient
      sessionId={session.id}
      teacherName={teacherName}
      // Guaranteed non-null while status is pending: the pending_has_deadline
      // constraint in migration 0002 enforces exactly that.
      deadline={session.accept_deadline!}
      returnTo={returnTo}
      backToList={backToList}
    />
  );
}
