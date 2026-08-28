import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DashboardLive } from "./dashboard-live";
import { SessionHistory } from "./session-history";

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
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome, {identity.fullName}
            </h2>
            <p className="text-gray-600">
              Go available to receive instant student requests.
            </p>
          </div>

          <DashboardLive
            teacherId={identity.userId}
            fullName={identity.fullName}
            hourlyRate={profile?.hourly_rate ?? 0}
          />

          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-bold text-gray-900 mb-3">You&apos;re live for</h3>
            {subjects && subjects.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <li
                    key={`${s.curriculum}|${s.grade}|${s.stream}|${s.subject}`}
                    className="text-sm bg-teal-50 text-teal-700 border border-teal-200 rounded-lg px-3 py-1"
                  >
                    {s.subject} · {s.curriculum} · {s.grade}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-600 text-sm">
                No subjects yet — add them from your tutor application.
              </p>
            )}
          </section>

          <SessionHistory teacherId={identity.userId} />
        </div>
      </div>
    </div>
  );
}
