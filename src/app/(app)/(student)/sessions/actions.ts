"use server";

import { createClient } from "@/lib/supabase/server";
import { requireConsentedUser } from "@/lib/auth";
import { reportError } from "@/lib/observability/report";
import { REPORT_REASONS } from "./reasons";
import { settleSuspension } from "@/lib/suspension/settle";

export async function reportSession(input: {
  sessionId: string;
  reason: string;
  detail: string;
}): Promise<{ ok: true } | { error: string }> {
  // requireConsentedUser(), not a bare getUser(): a Server Action is
  // resolved by ID and run before any page renders, so requireUser()'s
  // redirect on /consent never gets a chance to fire for this call.
  //
  // This CAN genuinely block a report: a CONSENT_VERSION bump makes an
  // existing account with real session history unconsented again, and that
  // account is refused here until it re-consents. Nothing is lost in
  // practice, though -- /sessions (and every other page this account can
  // reach) already routes it through requireUser() first, which redirects to
  // /consent before it ever gets back here. The sequence is "re-consent, then
  // report," not "blocked from reporting."
  const identity = await requireConsentedUser();
  if (!identity) return { error: "Sign in first." };
  const supabase = await createClient();

  if (!(REPORT_REASONS as readonly string[]).includes(input.reason)) {
    return { error: "Pick a reason for the report." };
  }

  const detail = input.detail.trim();

  // RLS (0016) re-checks that this caller was actually in this session, so a
  // forged sessionId is refused by the database rather than by this code.
  const { error } = await supabase.from("session_reports").insert({
    session_id: input.sessionId,
    reporter_id: identity.userId,
    reason: input.reason,
    detail: detail.length > 0 ? detail : null,
  });

  if (error) {
    // A safety report failing silently is the worst outcome here: the reporter
    // believes they have been heard and nobody has been told.
    //
    // Never pass the raw Postgres `error` object to reportError. It is a
    // plain object, not an Error — @supabase/postgrest-js returns it on the
    // non-throwing path — so @sentry/core's event builder serialises the
    // WHOLE thing into event.extra, which sentry-options.ts's beforeSend
    // never scrubs (it only touches event.user and event.request.*). A CHECK
    // or NOT NULL violation (23514, 23502) puts "Failing row contains (…)" in
    // `error.details`, and that row includes `detail` — the reporter's own
    // words about a child. Pass a fresh Error and only the error code.
    reportError(new Error("session report insert failed"), {
      where: "reportSession.insert",
      sessionId: input.sessionId,
      reason: input.reason,
      code: error.code,
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
    reporterId: identity.userId,
  });

  // The trigger has already opened the suspension if this was a conduct
  // report — that part is atomic with the insert and cannot be lost. This is
  // the cleanup: cancelling and refunding what the suspended teacher had in
  // flight. It is best-effort HERE and guaranteed elsewhere, because the same
  // idempotent pass runs on the affected student's waiting page and on the
  // teacher's dashboard. A reporter's browser dying must not leave another
  // student holding a paid session.
  if (input.reason === "conduct") {
    const { data: reported } = await supabase
      .from("sessions")
      .select("teacher_id")
      .eq("id", input.sessionId)
      .maybeSingle();
    if (reported?.teacher_id) {
      try {
        await settleSuspension(reported.teacher_id);
      } catch {
        // Optional catch binding: this repo's eslint reports an unused `e`.
        reportError(new Error("settleSuspension failed after a conduct report"), {
          where: "reportSession.settle",
          sessionId: input.sessionId,
        });
      }
    }
  }

  return { ok: true };
}
