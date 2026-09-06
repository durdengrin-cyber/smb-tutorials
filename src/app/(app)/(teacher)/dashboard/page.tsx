import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { settleSuspension } from "@/lib/suspension/settle";
import { DashboardLive } from "./dashboard-live";
import { SessionHistory } from "./session-history";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { NotificationSetup } from "@/components/notification-setup";

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
  const { data: suspendedAt } = await supabase.rpc("my_suspension");
  if (suspendedAt) await settleSuspension(identity.userId);

  return (
    <div className="min-h-screen bg-background">
      <div className="px-4 py-8 sm:px-8 sm:py-12">
        <div className="max-w-4xl mx-auto space-y-8">
          <PageHeader
            title={`Welcome, ${profile?.full_name ?? identity.fullName}`}
            description="Go available to receive instant student requests."
          />

          <NotificationSetup variant="card" />

          <DashboardLive
            teacherId={identity.userId}
            fullName={identity.fullName}
            hourlyRate={profile?.hourly_rate ?? 0}
            declaredUntil={availability?.declared_until ?? null}
            hasDevice={(deviceCount ?? 0) > 0}
          />

          <Card>
            <CardContent className="p-6">
              <h3 className="font-bold text-foreground mb-3">You&apos;re live for</h3>
              {subjects && subjects.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {subjects.map((s) => (
                    <li key={`${s.curriculum}|${s.grade}|${s.stream}|${s.subject}`}>
                      <Badge variant="secondary">
                        {s.subject} · {s.curriculum} · {s.grade}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No subjects yet"
                  description="Add subjects from your tutor application to go live for students."
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
