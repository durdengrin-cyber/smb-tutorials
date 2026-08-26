import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// postgres_changes are filtered by RLS against the identity on the *socket*,
// which is not the identity on your REST calls. supabase-js does push the JWT
// down via an INITIAL_SESSION auth event, but that fires a tick or two after
// the client is constructed — so a component that creates a client and
// subscribes in the same effect joins as `anon`.
//
// The failure is silent and total: subscribe() still acks SUBSCRIBED, and the
// channel then receives nothing at all, forever. That is what made a student's
// request invisible to their teacher until a manual page refresh.
//
// Await this before subscribing to any postgres_changes channel. Presence does
// not need it — presence is not RLS-filtered.
export async function createRealtimeClient(): Promise<SupabaseClient> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    await supabase.realtime.setAuth(session.access_token);
  }
  return supabase;
}
