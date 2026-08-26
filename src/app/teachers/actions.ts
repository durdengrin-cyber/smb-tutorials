"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { acceptDeadlineFrom } from "@/lib/session";
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
