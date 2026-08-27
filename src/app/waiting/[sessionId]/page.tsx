import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { amountPaiseFor, effectiveStatus, type SessionStatus } from "@/lib/session";
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
      "id, student_id, teacher_id, curriculum, grade, stream, subject, status, accept_deadline, payment_deadline, started_at, duration_minutes, hourly_rate, refund_ref"
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
  // The student is told WHICH thing went wrong. This used to be a fixed
  // `didNotRespond=<teacher>`, sent for every terminal status — so an expired
  // payment window, a decline and a refund all accused the teacher of
  // ignoring the student, which for the expiry case is both false and the
  // student's own doing. The outcome travels; the wording lives on /teachers.
  const exitTo = (outcome: string) =>
    `/teachers?${new URLSearchParams({ ...criteria, outcome, teacher: teacherName })}`;

  const status = effectiveStatus(
    { ...session, status: session.status as SessionStatus },
    new Date()
  );
  if (status === "active") redirect(`/call/${sessionId}`);
  if (status !== "pending" && status !== "accepted" && status !== "paid") {
    // A refund outranks the status for what the STUDENT needs told. Money
    // arriving late on a session they cancelled is refunded automatically and
    // leaves the row `cancelled` — for which we deliberately show no banner,
    // because they cancelled on purpose. That reasoning stops holding the
    // moment money moved: their bank shows a debit and a credit and the
    // product would say nothing at all.
    redirect(exitTo(session.refund_ref ? "refunded" : status));
  }

  return (
    <WaitingClient
      sessionId={session.id}
      teacherName={teacherName}
      status={status}
      // Guaranteed non-null while status is pending: the pending_has_deadline
      // constraint in migration 0002 enforces exactly that.
      deadline={session.accept_deadline!}
      paymentDeadline={session.payment_deadline}
      amountPaise={amountPaiseFor(session.hourly_rate, session.duration_minutes)}
      backToList={backToList}
    />
  );
}
