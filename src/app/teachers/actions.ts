"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  acceptDeadlineFrom,
  hasOpenRequest,
  type SessionStatus,
  type SessionTimingRow,
} from "@/lib/session";
import { isCurriculum, isGrade, isSubjectOf } from "@/lib/taxonomy";

export async function requestSession(input: {
  teacherId: string;
  subject: string;
  curriculum: string;
  grade: string;
  stream: string;
}): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to start a session." };

  if (
    !isCurriculum(input.curriculum) ||
    !isGrade(input.grade) ||
    !isSubjectOf(input.stream, input.subject)
  ) {
    return { error: "Pick a subject before starting." };
  }
  if (input.teacherId === user.id) return { error: "You cannot tutor yourself." };

  // One request in flight at a time. Two live requests can both be accepted,
  // and the losing teacher then sits alone for an hour in a session that later
  // counts toward their earnings — a fabricated figure by another name.
  // Reachable without malice: Start, browser Back, Start on someone else.
  const { data: openRows } = await supabase
    .from("sessions")
    .select("id, status, accept_deadline, payment_deadline, started_at, duration_minutes")
    .eq("student_id", user.id)
    .in("status", ["pending", "accepted", "paid", "active"]);
  const open = (openRows ?? []).map((r) => ({
    ...r,
    status: r.status as SessionStatus,
  })) as SessionTimingRow[];
  if (hasOpenRequest(open, new Date())) {
    return { error: "You already have a session in progress." };
  }

  // Rate is snapshotted from the teacher's profile at request time.
  const { data: teacher } = await supabase
    .from("profiles")
    .select("id, hourly_rate, role")
    .eq("id", input.teacherId)
    .single();
  if (!teacher || teacher.role !== "teacher" || !teacher.hourly_rate) {
    return { error: "That teacher is unavailable." };
  }

  const { data: session, error } = await supabase
    .from("sessions")
    .insert({
      student_id: user.id,
      teacher_id: input.teacherId,
      curriculum: input.curriculum,
      grade: input.grade,
      stream: input.stream,
      subject: input.subject,
      type: "instant",
      status: "pending",
      accept_deadline: acceptDeadlineFrom(new Date()).toISOString(),
      hourly_rate: teacher.hourly_rate,
    })
    .select("id")
    .single();

  if (error || !session) return { error: "Couldn't start the request — try again." };
  redirect(`/waiting/${session.id}`);
}
