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
      "id, student_id, teacher_id, subject, status, accept_deadline, started_at, duration_minutes"
    )
    .eq("id", sessionId)
    .single();
  if (!session || session.student_id !== user.id) redirect("/teachers");

  const { data: teacher } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", session.teacher_id)
    .single();

  const status = effectiveStatus(
    { ...session, status: session.status as SessionStatus },
    new Date()
  );
  if (status === "active") redirect(`/call/${sessionId}`);
  if (status !== "pending") {
    redirect(
      `/teachers?didNotRespond=${encodeURIComponent(teacher?.full_name ?? "The teacher")}`
    );
  }

  return (
    <WaitingClient
      sessionId={session.id}
      teacherName={teacher?.full_name ?? "your teacher"}
      // Guaranteed non-null while status is pending: the pending_has_deadline
      // constraint in migration 0002 enforces exactly that.
      deadline={session.accept_deadline!}
    />
  );
}
