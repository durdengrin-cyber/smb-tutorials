"use server";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/report";
import { REPORT_REASONS } from "./reasons";

export async function reportSession(input: {
  sessionId: string;
  reason: string;
  detail: string;
}): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  if (!(REPORT_REASONS as readonly string[]).includes(input.reason)) {
    return { error: "Pick a reason for the report." };
  }

  const detail = input.detail.trim();

  // RLS (0016) re-checks that this caller was actually in this session, so a
  // forged sessionId is refused by the database rather than by this code.
  const { error } = await supabase.from("session_reports").insert({
    session_id: input.sessionId,
    reporter_id: user.id,
    reason: input.reason,
    detail: detail.length > 0 ? detail : null,
  });

  if (error) {
    // A safety report failing silently is the worst outcome here: the reporter
    // believes they have been heard and nobody has been told.
    reportError(error, {
      where: "reportSession.insert",
      sessionId: input.sessionId,
      reason: input.reason,
    });
    return { error: "Couldn't send that report — please try again." };
  }

  // Alerting, not error handling. A report that only lands in a table nobody
  // watches is not a safety mechanism (spec §5). Sentry is a deliberate
  // compromise until Resend exists — spec §8 item 1.
  reportError(new Error(`session report filed: ${input.reason}`), {
    where: "session-report",
    sessionId: input.sessionId,
    reason: input.reason,
    reporterId: user.id,
  });

  return { ok: true };
}
