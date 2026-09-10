import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { settleSuspension } from "@/lib/suspension/settle";
import { DashboardLive } from "./dashboard-live";
import { SessionHistory } from "./session-history";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { NotificationSetup } from "@/components/notification-setup";
import { VettingBanner } from "@/components/vetting-banner";
import { canBePicked, isVettingState } from "@/lib/vetting";
import { summariseSubjects } from "@/lib/subject-summary";

export default async function DashboardPage() {
  const identity = await requireRole("teacher");
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, hourly_rate")
    .eq("id", identity.userId)
    .single();

  const { data: subjects } = await supabase
    .from("teacher_subjects")
    .select("curriculum, grade, stream, subject")
    .eq("teacher_id", identity.userId);

  // The durable half of "available" (spec §4.1), read server-side so the
  // toggle opens already knowing the truth instead of flashing Offline
  // while a client effect catches up. No row yet is not an error — it just
  // means this teacher has never declared.
  const { data: availability } = await supabase
    .from("teacher_availability")
    .select("declared_until")
    .eq("teacher_id", identity.userId)
    .maybeSingle();

  // Whether ANY of this teacher's devices holds a push subscription — not
  // this browser's. RLS already scopes teacher_devices to its owner
  // (migrations 0008/0009), so the ordinary client is enough here; only the
  // count is read, never an endpoint, because a device row is a capability
  // (spec §4.3).
  const { count: deviceCount, error: deviceError } = await supabase
    .from("teacher_devices")
    .select("id", { count: "exact", head: true })
    .eq("teacher_id", identity.userId);

  // This read used to discard its error. That is not cosmetic here: a failed
  // count is indistinguishable from zero, and zero devices with a not-yet-
  // connected realtime channel makes availability-toggle render "Can't reach
  // you" — telling a perfectly reachable teacher they are invisible. On the
  // 2026-09-04 walk that sentence was seen on the dashboard the notification
  // had just opened. The cause there is unconfirmed, but a read that fails
  // silently into a false accusation should not survive the finding either way.
  if (deviceError) {
    console.error("[dashboard] device count read failed", deviceError);
  }

  // Idempotent, and this is one of the two guaranteed paths: if the reporter's
  // request died before the cleanup ran, it runs here instead.
  //
  // This read's error must not be discarded either, for the same reason as
  // the device count above: a failed read is indistinguishable from "not
  // suspended", which would render a suspended teacher "Available", re-enable
  // their toggle, and skip settleSuspension entirely — the opposite of what a
  // transient RPC failure should do here.
  const { data: suspendedAt, error: suspensionError } =
    await supabase.rpc("my_suspension");

  // Read here rather than on Identity: getIdentity runs in every layout on
  // every request, and only this screen needs the vetting state. Mirrors the
  // my_suspension() read directly above it.
  const { data: vetting, error: vettingError } =
    await supabase.rpc("my_vetting_state");
  if (vettingError) {
    console.error("[dashboard] my_vetting_state read failed", vettingError);
  }
  // Fail closed: an unreadable state shows the "under review" banner rather
  // than silently implying the teacher is live.
  const vettingState = isVettingState(vetting ?? "") ? vetting : "unvetted";
  if (suspensionError) {
    console.error("[dashboard] my_suspension read failed", suspensionError);
  }
  // Fail CLOSED, which is what the comment above this read has always demanded
  // and what the code did not do: the error was logged and then discarded, so
  // suspendedAt stayed null and a suspended teacher read "Available now" with
  // a working go-online toggle. Treating an unreadable state as suspended
  // costs an available teacher one page load; treating it as clear puts a
  // suspended one back in front of children.
  //
  // The vetting read directly above already resolves this way
  // (`isVettingState(vetting ?? "") ? vetting : "unvetted"`). Only the
  // suspension read was left failing open.
  const suspended = suspensionError !== null || suspendedAt !== null;

  // Only on a CONFIRMED suspension. The settle pass cancels and refunds, and
  // must not be driven by a read that failed — it is idempotent and runs again
  // from here, from /waiting, and from the report that opened the suspension.
  if (!suspensionError && suspendedAt) await settleSuspension(identity.userId);

  return (
    <div className="min-h-screen bg-background">
      <div className="px-4 py-8 sm:px-8 sm:py-12">
        <div className="max-w-4xl mx-auto space-y-8">
          <PageHeader
            title={`Welcome, ${profile?.full_name ?? identity.fullName}`}
            description="Go available to receive instant student requests."
          />

          <NotificationSetup variant="card" />

          <VettingBanner state={vettingState} />

          <DashboardLive
            teacherId={identity.userId}
            fullName={identity.fullName}
            hourlyRate={profile?.hourly_rate ?? 0}
            declaredUntil={availability?.declared_until ?? null}
            hasDevice={(deviceCount ?? 0) > 0}
            suspended={suspended}
            // available_teachers gates on 'cleared', so while this is false
            // nothing can reach them and the toggle must not offer a state it
            // cannot deliver. The VettingBanner above says why.
            cleared={canBePicked(vettingState)}
          />

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between gap-4 mb-3">
                <h3 className="font-bold text-foreground">You&apos;re live for</h3>
                {subjects && subjects.length > 0 && (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/profile">Edit subjects</Link>
                  </Button>
                )}
              </div>
              {subjects && subjects.length > 0 ? (
                // One badge per listing, not one per grade: two subjects across
                // four grades is eight rows, and eight near-identical chips
                // told the teacher nothing the two lines do.
                <ul className="flex flex-wrap gap-2">
                  {summariseSubjects(subjects).map((l) => (
                    <li key={`${l.curriculum}|${l.stream}|${l.subject}`}>
                      <Badge variant="secondary">
                        {l.subject} · {l.curriculum} · {l.grades}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No subjects yet"
                  description="Add subjects to your profile to go live for students."
                  action={
                    <Button asChild variant="outline">
                      <Link href="/profile">Add subjects</Link>
                    </Button>
                  }
                />
              )}
            </CardContent>
          </Card>

          <SessionHistory teacherId={identity.userId} />
        </div>
      </div>
    </div>
  );
}
