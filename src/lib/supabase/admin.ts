import "server-only";
import { createClient } from "@supabase/supabase-js";

// Spec §12, RATIFIED 2026-09-03 as option (b): the dispatcher runs on the
// service role, deliberately, until cycle 3.
//
// What decided it. The service role was already on student-triggerable app
// paths before this cycle — payment-actions.ts and settle.ts both use it when
// a student pays — so the dispatcher is a third instance of an existing
// pattern, not a new class of exposure. A dedicated sb_secret_* key would be
// independently rotatable but carries the SAME privileges, so it narrows
// rotation blast radius and not privilege. Real narrowing needs a dedicated
// Postgres role, and teacher_devices has RLS with policies only `to
// authenticated`, so such a role is refused outright unless the dispatcher's
// whole DB surface first becomes security-definer RPCs. That is cycle-3 work,
// and it belongs with the profiles.role fix (cycle-1 §17.1) because both are
// the same problem: the database should enforce this, not the app code.
//
// Deferring costs almost nothing precisely because the seam is already in the
// right place — one env var, one line to swap, no refactor.
export function createDispatchClient() {
  const dedicated = process.env.NOTIFICATION_DB_KEY;
  const key = dedicated ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("No dispatcher credential configured");

  // Say so when the fallback takes effect. The finding that produced this was
  // never "wrong key" — it was that the fallback was reached by DEFAULT rather
  // than by choice and nothing anywhere said so, in the logs or at deploy. A
  // ratified decision that is still invisible in production is the same
  // failure one step later, so the ratification is stated out loud, once per
  // cold start, where whoever is reading logs at 2am will see it.
  if (!dedicated && !warned) {
    warned = true;
    console.warn(
      "[notify] NOTIFICATION_DB_KEY is unset — dispatcher is running on the " +
        "SERVICE ROLE (spec §12 option (b), ratified 2026-09-03). This is " +
        "intended today. Set NOTIFICATION_DB_KEY to narrow it."
    );
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Module-scoped so a busy minute doesn't print this per request. Serverless
// gives each cold start a fresh module, which is exactly the cadence wanted:
// once per instance, not once per push.
let warned = false;
