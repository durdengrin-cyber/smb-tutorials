"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createSessionRoom } from "@/lib/daily";
import { canTransition, effectiveStatus, type SessionStatus } from "@/lib/session";

async function loadOwnSession(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, session: null };
  const { data: session } = await supabase
    .from("sessions")
    .select("id, teacher_id, student_id, status, accept_deadline, started_at, duration_minutes")
    .eq("id", sessionId)
    .single();
  return { supabase, user, session };
}

export async function acceptSession(sessionId: string): Promise<{ error: string } | void> {
  const { supabase, user, session } = await loadOwnSession(sessionId);
  if (!user || !session) return { error: "Request not found." };
  if (session.teacher_id !== user.id) return { error: "Not your request." };

  // The deadline is authoritative here regardless of what the UI showed.
  const actual = effectiveStatus(
    { ...session, status: session.status as SessionStatus },
    new Date()
  );
  if (actual !== "pending") return { error: "That request has already expired." };
  if (!canTransition("pending", "active")) return { error: "Invalid transition." };

  // Refuse a second concurrent call for this teacher.
  const { count } = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("teacher_id", user.id)
    .eq("status", "active");
  if ((count ?? 0) > 0) return { error: "You are already in a session." };

  let roomUrl: string;
  try {
    const room = await createSessionRoom(sessionId, process.env.DAILY_API_KEY ?? "");
    roomUrl = room.url;
  } catch {
    return { error: "Couldn't start the call — try again." };
  }

  const { data: updated, error } = await supabase
    .from("sessions")
    .update({ status: "active", started_at: new Date().toISOString(), daily_room_url: roomUrl })
    .eq("id", sessionId)
    .eq("status", "pending") // lost race → 0 rows, student already cancelled
    .select("id");
  if (error) return { error: "Couldn't start the call — try again." };
  // 0 rows means the row left `pending` between the read above and this write
  // (the student cancelled, or another tab accepted). Landing in a call for a
  // session that is not active would be worse than saying so.
  if (!updated || updated.length === 0) {
    return { error: "That request is no longer waiting." };
  }

  redirect(`/call/${sessionId}`);
}

export async function declineSession(sessionId: string): Promise<{ error: string } | void> {
  const { supabase, user, session } = await loadOwnSession(sessionId);
  if (!user || !session) return { error: "Request not found." };
  if (session.teacher_id !== user.id) return { error: "Not your request." };

  await supabase
    .from("sessions")
    .update({ status: "declined" })
    .eq("id", sessionId)
    .eq("status", "pending");
}
