"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps /admin current without a manual reload.
 *
 * The operator's actual complaint: a push said someone applied, clicking it
 * focused the already-open /admin, and the applicant was not there until F5.
 * Two causes — the service worker focuses without navigating (fixed in sw.js),
 * and this page had no live updates whatsoever.
 *
 * Deliberately NOT a postgres_changes subscription. Only `sessions` is in the
 * supabase_realtime publication, and 0020 revokes column-level SELECT on
 * vetting_state from `authenticated` table-wide — so an admin's own session
 * cannot read the rows this page is about, and realtime honours RLS. Making it
 * work would mean a migration AND a hole in that revoke, to save a few seconds
 * on a single-operator console.
 *
 * router.refresh() re-runs the Server Component instead, which reads with the
 * service-role client it already uses. Nothing new is exposed to the browser:
 * the client here learns only that it should ask again.
 */
export function LiveRefresh({ intervalMs = 20_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    // The path that matters most. Arriving from a notification, or coming back
    // to a tab left open, refetches immediately rather than after the timer.
    function onVisible() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", onVisible);

    // Only while the tab is actually being looked at. A background tab polling
    // the roster forever is a cost with no reader.
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, [router, intervalMs]);

  return null;
}
