"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getPaymentPort, paymentProviderName } from "@/lib/payments";
import { settleVerifiedEvent } from "@/lib/payments/settle";
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

// Design spec §3.6's SECOND path to confirmation. The browser's return from
// checkout proves nothing about payment — the student may have abandoned it,
// and a hostile one can hit the URL directly — so this asks the PROVIDER what
// happened, and settles the session through exactly the same code the webhook
// settles it through. Its whole reason to exist is the webhook that never
// arrives: without it, a provider outage strands a session the student has
// already paid for, and nothing in the product recovers it.
//
// Safe to call on every page load: it asks the provider only when the row is
// still `accepted` with a charge open, and settleVerifiedEvent is idempotent
// on every path.
export async function verifyPaymentNow(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // The error is destructured, not dropped (carried from Task 6's review). A
  // genuine query failure and "no such row" used to be the same silent no-op.
  // That was tolerable while this function drove nothing; now that it drives
  // the settle path, a swallowed read error means a stuck payment gets no
  // second attempt AND leaves no trace of why — defeating the one job §3.6
  // gives it.
  const { data: session, error: readError } = await supabase
    .from("sessions")
    .select("id, student_id, status, payment_ref")
    .eq("id", sessionId)
    .single();
  if (readError) {
    console.error(`[verifyPaymentNow] session read failed for ${sessionId}:`, readError);
    return;
  }
  if (!session || session.student_id !== user.id) return;
  // Nothing to re-check: either the payment already landed and moved the row
  // on, or no charge was ever opened.
  if (session.status !== "accepted" || !session.payment_ref) return;

  let event;
  try {
    event = await getPaymentPort().fetchPayment(session.payment_ref);
  } catch (e) {
    // fetchPayment's contract is to return null on a provider outage, so a
    // throw here is a bug or a misconfiguration, not an outage. Either way
    // this runs on the screen the student is watching: log it, never surface
    // it as a crash.
    console.error(`[verifyPaymentNow] provider lookup threw for ${sessionId}:`, e);
    return;
  }

  // No payment yet is the ordinary answer — the student is still at checkout,
  // or backed out. The payment window expiring is what resolves that, not us.
  if (!event) return;

  console.info(
    `[verifyPaymentNow] provider reports ${session.payment_ref} paid for ${sessionId}; ` +
      `settling through the webhook path`
  );
  // The SAME function the webhook calls, not a second implementation of it.
  // The response it returns describes what a provider should do next, which
  // is meaningless here — the settling is the point.
  await settleVerifiedEvent(event);
}
