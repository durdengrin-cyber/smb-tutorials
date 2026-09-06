import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { amountPaiseFor, effectiveStatus, type SessionStatus } from "@/lib/session";
import { settleSuspension } from "@/lib/suspension/settle";
import { WaitingClient } from "./waiting-client";

export default async function WaitingPage({
  params,
}: PageProps<"/waiting/[sessionId]">) {
  const { sessionId } = await params;
  const identity = await requireUser();
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select(
      "id, student_id, teacher_id, curriculum, grade, stream, subject, status, accept_deadline, payment_deadline, started_at, duration_minutes, hourly_rate, refund_ref, cancellation_reason"
    )
    .eq("id", sessionId)
    .single();
  // Ownership check, not an auth gate: this confirms THIS student owns THIS
  // session row. The layout above already guarantees a signed-in student.
  if (!session || session.student_id !== identity.userId) redirect("/teachers");

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
  const amountPaise = amountPaiseFor(session.hourly_rate, session.duration_minutes);
  // The student is told WHICH thing went wrong. This used to be a fixed
  // `didNotRespond=<teacher>`, sent for every terminal status — so an expired
  // payment window, a decline and a refund all accused the teacher of
  // ignoring the student, which for the expiry case is both false and the
  // student's own doing. The outcome travels; the wording lives on /teachers.
  // The refund amount travels too — the session row that knows it is this
  // one, and /teachers has no other way to reach it.
  const exitTo = (outcome: string) =>
    `/teachers?${new URLSearchParams({
      ...criteria,
      outcome,
      teacher: teacherName,
      ...(outcome === "refunded" ? { amount: String(amountPaise) } : {}),
    })}`;

  const status = effectiveStatus(
    { ...session, status: session.status as SessionStatus },
    new Date()
  );

  // The other guaranteed path. A student sitting on this page whose teacher
  // was just suspended gets their refund here, without depending on the
  // reporter's request having finished.
  //
  // Called unconditionally for in-flight statuses: settleSuspension gatekeeps
  // itself on an open suspension. This page must NOT perform that check —
  // teacher_suspensions has no SELECT policy, so the student's own client
  // reads nothing, and handing a page component the service role to work
  // around that is exactly the wrong fix.
  if (session.status === "pending" || session.status === "accepted" || session.status === "paid") {
    const settled = await settleSuspension(session.teacher_id);
    // Re-read: the pass may have changed the row underneath this render.
    if (settled) redirect(`/waiting/${sessionId}`);
  }

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
      amountPaise={amountPaise}
      backToList={backToList}
    />
  );
}
