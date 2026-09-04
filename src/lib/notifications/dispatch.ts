import "server-only";
import { createDispatchClient } from "@/lib/supabase/admin";
import { getNotificationPort, requestPayload } from "./index";

// A teacher legitimately has a handful of devices — a phone, a tablet, a
// desktop. Twenty is far above any honest ceiling and far below a number that
// costs anything, so it caps abuse without ever binding on real use.
export const MAX_DEVICES_PER_TEACHER = 20;

// Road 2 of the fan-out (spec §5.1). Road 1 is the existing realtime card,
// and the two know nothing about each other on purpose: one failing still
// leaves one landing.
export type NotificationOutcome =
  | "sent" | "failed" | "gone" | "no_devices" | "read_error" | "threw";

export interface NotificationEvent {
  session_id: string | null;
  teacher_id: string;
  device_id: string | null;
  outcome: NotificationOutcome;
  status_code: number | null;
  detail: string | null;
}

export async function notifyTeacherOfRequest(
  teacherId: string,
  studentName: string,
  subject: string,
  sessionId: string | null = null
): Promise<{ sent: number; pruned: number }> {
  const supabase = createDispatchClient();
  const events: NotificationEvent[] = [];

  // Never let logging break delivery. This is the observability road, not the
  // delivery road, and a failure to WRITE a log must not cost a teacher the
  // notification the log exists to explain.
  const flush = async () => {
    if (!events.length) return;
    const { error: logError } = await supabase
      .from("notification_events")
      .insert(events);
    if (logError) console.error("[notify] event log write failed", logError);
  };

  const { data: devices, error } = await supabase
    .from("teacher_devices")
    .select("id, endpoint, p256dh, auth")
    .eq("teacher_id", teacherId)
    // Bounded on purpose. register_device caps nothing, so the row count for
    // one teacher is caller-controlled: a teacher account plus a student
    // account is enough to register N endpoints and make every session
    // request fan out to N outbound HTTPS calls inside after(), which Vercel
    // bills by invocation duration. Newest-first because a real teacher's
    // live device is the one they registered most recently.
    .order("created_at", { ascending: false })
    .limit(MAX_DEVICES_PER_TEACHER);

  // "We never tried" and "we tried and it failed" look identical from the
  // outside, and a teacher asking why their phone was silent needs them told
  // apart. dispatch.ts used to collapse both into one bare return.
  if (error || !devices?.length) {
    if (error) console.error("[notify] device read failed", error);
    events.push({
      session_id: sessionId,
      teacher_id: teacherId,
      device_id: null,
      outcome: error ? "read_error" : "no_devices",
      status_code: null,
      detail: error ? (error.message ?? "device read failed") : null,
    });
    await flush();
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
    const base = {
      session_id: sessionId,
      teacher_id: teacherId,
      device_id: devices[i].id,
    };
    if (r.status !== "fulfilled") {
      failed.push(devices[i].id);
      // A throw is not the same as a push service saying no, and the reason
      // is usually ours (a missing VAPID key throws exactly here).
      events.push({
        ...base, outcome: "threw", status_code: null,
        detail: String(r.reason?.message ?? r.reason ?? "").slice(0, 500),
      });
      return;
    }
    if (r.value.ok) {
      sent++;
      // SendResult's success variant is `{ ok: true }` — no status to record,
      // and inventing one would be a fact the port never reported.
      events.push({ ...base, outcome: "sent", status_code: null, detail: null });
      return;
    }
    if (r.value.gone) {
      gone.push(devices[i].id);
      events.push({ ...base, outcome: "gone", status_code: r.value.status ?? null, detail: r.value.error ?? null });
    } else {
      failed.push(devices[i].id);
      events.push({ ...base, outcome: "failed", status_code: r.value.status ?? null, detail: r.value.error ?? null });
    }
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
  //
  // The stamp is kept as its own PostgREST write, ahead of the RPC below and
  // deliberately not folded into it. 0012 has to be applied before this code
  // deploys; if that ordering is ever missed the RPC call fails, and losing
  // the counter is survivable where losing last_failed_at — the only record
  // that anything went wrong at all — is not.
  if (failed.length) {
    const { error: updError } = await supabase
      .from("teacher_devices")
      .update({ last_failed_at: new Date().toISOString() })
      .in("id", failed);
    if (updError) console.error("[notify] failure stamp failed", updError);
  }

  // Spec §8: a failure increments failure_count, a success clears it and
  // stamps last_ok_at. Both go through one RPC because `failure_count =
  // failure_count + 1` is a read-modify-write PostgREST cannot express, and
  // doing it as SELECT-then-UPDATE here would undercount whenever two
  // dispatches hit the same device at once.
  //
  // Without this, a subscription that fails persistently with anything other
  // than 404/410 is never pruned AND never distinguishable from a healthy
  // one, so available_teachers keeps publishing has_device = true for a phone
  // that cannot be woken.
  const okIds = results.flatMap((r, i) =>
    r.status === "fulfilled" && r.value.ok ? [devices[i].id] : []
  );
  if (okIds.length || failed.length) {
    const { error: resultsError } = await supabase.rpc("record_device_results", {
      p_ok: okIds,
      p_failed: failed,
    });
    if (resultsError)
      console.error("[notify] delivery result stamp failed", resultsError);
  }

  await flush();
  return { sent, pruned: gone.length };
}
