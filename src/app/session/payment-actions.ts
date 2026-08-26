"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getPaymentPort, paymentProviderName } from "@/lib/payments";
import { amountPaiseFor, effectiveStatus, type SessionStatus } from "@/lib/session";

// Migration 0005 makes every payment column service-role-only on both the
// insert and update paths, because a user token that can write `payment_ref`
// or `payment_checkout_url` can point a student at an off-platform payment
// page, and a user token that can write `amount_paid_paise` can forge a
// teacher's earnings. Checkout creation therefore holds the service role for
// its one write — it has already authenticated the caller and checked
// ownership above, so the elevation is scoped to a row it just authorised.
const admin = () =>
  createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

export async function createCheckout(
  sessionId: string
): Promise<{ error: string } | { checkoutUrl: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to pay for this session." };

  const { data: session } = await supabase
    .from("sessions")
    .select(
      "id, student_id, status, accept_deadline, payment_deadline, started_at, duration_minutes, hourly_rate, payment_ref, payment_checkout_url"
    )
    .eq("id", sessionId)
    .single();
  if (!session) return { error: "Session not found." };
  if (session.student_id !== user.id) return { error: "Not your session." };

  // The deadline is authoritative here regardless of what the UI showed.
  const actual = effectiveStatus(
    { ...session, status: session.status as SessionStatus },
    new Date()
  );
  if (actual !== "accepted") {
    return { error: "This session is no longer waiting for payment." };
  }

  // A student who backed out of checkout and tapped Pay again resumes the
  // charge already open for this session rather than starting a second one
  // (design spec §7). The trigger refuses to rewrite either column once set,
  // so this is belt and braces over a rule the database already enforces.
  if (session.payment_checkout_url) {
    return { checkoutUrl: session.payment_checkout_url };
  }

  const amountPaise = amountPaiseFor(session.hourly_rate, session.duration_minutes);
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const back = `${base}/waiting/${sessionId}`;

  try {
    const port = getPaymentPort();
    const { checkoutUrl, paymentRef } = await port.createCheckout({
      sessionId,
      amountPaise,
      successUrl: back,
      cancelUrl: back,
    });

    // Recorded before the student leaves, so a webhook that arrives while they
    // are still on the provider's page has something to match against. The
    // `.is("payment_ref", null)` guard plus the migration's write-once rule
    // mean a double-click cannot open a second charge against this session.
    // Written with the service role: see the note on `admin` above.
    const { data: stamped, error: stampError } = await admin()
      .from("sessions")
      .update({
        payment_ref: paymentRef,
        payment_provider: paymentProviderName(),
        payment_checkout_url: checkoutUrl,
      })
      .eq("id", sessionId)
      .eq("status", "accepted") // between effectiveStatus check and this write, a session could expire; accepting this window
      .is("payment_ref", null)
      .select("id");

    if (stampError) {
      // A real database failure, not a lost race. Distinguished on purpose: the
      // two are indistinguishable in the control flow below, and conflating them
      // hides a misconfigured service-role key behind a message that reads like
      // ordinary contention.
      console.error(
        `[createCheckout] stamp write errored for ${sessionId} (ref ${paymentRef}):`,
        stampError
      );
      return { error: "Couldn't open the payment page — try again." };
    }

    // This write is a hard precondition, not bookkeeping: migration 0005's
    // `paid_has_ref` refuses the webhook's `accepted -> paid` transition on a
    // row with no payment_ref. If we sent the student to checkout without it,
    // they would pay and the webhook could not record the session — money
    // taken, nothing delivered. Refuse to hand out the URL instead.
    if (!stamped || stamped.length === 0) {
      console.error(
        `[createCheckout] could not stamp payment_ref on ${sessionId} (ref ${paymentRef}) — refusing to send the student to checkout`
      );
      return { error: "Couldn't open the payment page — try again." };
    }

    return { checkoutUrl };
  } catch (e) {
    console.error(`[createCheckout] failed for ${sessionId}:`, e);
    return { error: "Couldn't open the payment page — try again." };
  }
}

// The browser's return from checkout proves nothing about payment — but it is
// a useful nudge. This asks our own webhook path to re-check, so a provider
// whose webhook never arrived does not strand a paid session. Safe to call
// repeatedly: every path it can reach is idempotent.
export async function verifyPaymentNow(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: session } = await supabase
    .from("sessions")
    .select("id, student_id, status, payment_ref")
    .eq("id", sessionId)
    .single();
  if (!session || session.student_id !== user.id) return;
  if (session.status !== "accepted" || !session.payment_ref) return;

  // INCOMPLETE BY DESIGN until Task 12 Step 3b. With a stub adapter there is no
  // provider to query, so this records the attempt and makes an outage visible
  // in logs. The spec's §3.6 dual path is not real until Task 12 adds
  // `fetchPayment` to the port and this drives the same transition the webhook
  // drives. Do not mark §3.6 satisfied on the strength of this function.
  console.info(
    `[verifyPaymentNow] ${sessionId} still 'accepted' after checkout return, ref ${session.payment_ref}`
  );
}
