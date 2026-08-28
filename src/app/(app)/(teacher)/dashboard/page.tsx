import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DashboardLive } from "./dashboard-live";
import { SessionHistory } from "./session-history";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="px-8 py-12">
        <div className="max-w-4xl mx-auto space-y-8">
          <PageHeader
            title={`Welcome, ${profile?.full_name ?? identity.fullName}`}
            description="Go available to receive instant student requests."
          />

          <DashboardLive
            teacherId={identity.userId}
            fullName={identity.fullName}
            hourlyRate={profile?.hourly_rate ?? 0}
          />

          <Card>
            <CardContent className="p-6">
              <h3 className="font-bold text-gray-900 mb-3">You&apos;re live for</h3>
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
