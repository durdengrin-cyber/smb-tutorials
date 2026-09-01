import "server-only";
import { createClient } from "@supabase/supabase-js";

// Spec §12: the dispatcher needs a privileged read of teacher_devices across
// teachers, and the cycle-1 handoff reserves the service role for the payment
// webhook alone. Which credential this ends up being is a DEFERRED decision —
// a dedicated sb_secret_* key is preferred, the service role is the fallback.
//
// It is one line of config on purpose. Set NOTIFICATION_DB_KEY to narrow the
// blast radius; leave it unset and this falls back to the service role, which
// works but widens that key's reach into a student-triggerable path.
export function createDispatchClient() {
  const key =
    process.env.NOTIFICATION_DB_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("No dispatcher credential configured");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
