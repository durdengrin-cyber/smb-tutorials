import { createClient } from "@/lib/supabase/server";
import { effectiveStatus, type SessionStatus } from "@/lib/session";

// This renders on the server, where the timezone is the runtime's (UTC on
// Vercel) rather than the teacher's. Naming the zone keeps the times right
// for the audience the product is built for instead of silently off by 5:30.
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

export async function SessionHistory({ teacherId }: { teacherId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sessions")
    .select(
      "id, subject, status, hourly_rate, duration_minutes, started_at, accept_deadline, created_at, student_id"
    )
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(25);

  const now = new Date();
  const rows = (data ?? []).map((s) => ({
    ...s,
    status: effectiveStatus({ ...s, status: s.status as SessionStatus }, now),
  }));

  // Earned = work actually completed. Not a balance, not a projection.
  const earned = rows
    .filter((r) => r.status === "completed")
    .reduce(
      (sum, r) => sum + Math.round((r.hourly_rate * r.duration_minutes) / 60),
      0
    );

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-bold text-gray-900">Your sessions</h3>
        <div className="text-right">
          <p className="text-2xl font-bold text-gray-900">₹{earned}</p>
          <p className="text-xs text-gray-500">earned · pending payout</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">
          No sessions yet. Go available and your first request will appear here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-2 font-semibold">Subject</th>
                <th className="py-2 font-semibold">When</th>
                <th className="py-2 font-semibold">Status</th>
                <th className="py-2 font-semibold text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50">
                  <td className="py-2 text-gray-900">{r.subject}</td>
                  <td className="py-2 text-gray-600">{when(r.created_at)}</td>
                  <td className="py-2 text-gray-600">{r.status}</td>
                  <td className="py-2 text-gray-900 text-right">
                    ₹{r.hourly_rate}/hr
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500 mt-4">
        Payouts are made manually while payments are being set up.
      </p>
    </section>
  );
}
