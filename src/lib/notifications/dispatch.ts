import "server-only";
import { createDispatchClient } from "@/lib/supabase/admin";
import { getNotificationPort, requestPayload } from "./index";

// Road 2 of the fan-out (spec §5.1). Road 1 is the existing realtime card,
// and the two know nothing about each other on purpose: one failing still
// leaves one landing.
export async function notifyTeacherOfRequest(
  teacherId: string,
  studentName: string,
  subject: string
): Promise<{ sent: number; pruned: number }> {
  const supabase = createDispatchClient();

  const { data: devices, error } = await supabase
    .from("teacher_devices")
    .select("id, endpoint, p256dh, auth")
    .eq("teacher_id", teacherId);

  if (error || !devices?.length) {
    if (error) console.error("[notify] device read failed", error);
    return { sent: 0, pruned: 0 };
  }

  const port = getNotificationPort();
  const payload = requestPayload(studentName, subject);

  // In parallel, and every device settled independently: one dead phone must
  // not stop a live one from ringing.
  const results = await Promise.allSettled(
    devices.map((d) =>
      port.send({ endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth }, payload)
    )
  );

  const gone: string[] = [];
  const failed: string[] = [];
  let sent = 0;

  results.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      failed.push(devices[i].id);
      return;
    }
    if (r.value.ok) { sent++; return; }
    if (r.value.gone) gone.push(devices[i].id);
    else failed.push(devices[i].id);
  });

  // 404/410 is the only death signal a subscription has, so it is the only
  // thing that deletes a row.
  if (gone.length) {
    const { error: delError } = await supabase
      .from("teacher_devices").delete().in("id", gone);
    if (delError) console.error("[notify] prune failed", delError);
  }

  // Transient failures are recorded, never deleted — a teacher must not lose
  // reachability because a push service had a bad minute.
  if (failed.length) {
    const { error: updError } = await supabase
      .from("teacher_devices")
      .update({ last_failed_at: new Date().toISOString() })
      .in("id", failed);
    if (updError) console.error("[notify] failure stamp failed", updError);
  }

  return { sent, pruned: gone.length };
}
