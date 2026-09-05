import { createClient } from "@/lib/supabase/server";
import { effectiveStatus, type SessionStatus } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/money";

// This renders on the server, where the timezone is the runtime's (UTC on
// Vercel) rather than the teacher's. Naming the zone keeps the times right
// for the audience the product is built for instead of silently off by 5:30.
// Rows shown in the table. Earnings deliberately ignore this cap.
const PAGE = 25;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

export async function SessionHistory({ teacherId }: { teacherId: string }) {
  const supabase = await createClient();
  const now = new Date();

  const { data } = await supabase
    .from("sessions")
    .select(
      "id, subject, status, hourly_rate, duration_minutes, started_at, accept_deadline, payment_deadline, created_at, student_name"
    )
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(PAGE);

  const rows = (data ?? []).map((s) => ({
    ...s,
    status: effectiveStatus({ ...s, status: s.status as SessionStatus }, now),
  }));

  // Earnings run over every session, not the page being displayed. Reducing
  // the same 25 rows the table shows would quietly understate the payout of a
  // teacher who has done more than that — as wrong, under the spec's
  // no-fabricated-data rule, as inventing a figure.
  // Earnings are money actually collected, never recomputed from the rate
  // (M3 spec §6 invariant 4). A refunded session is not earnings.
  const { data: billable, error: billableError } = await supabase
    .from("sessions")
    .select("status, amount_paid_paise, refund_ref, accept_deadline, payment_deadline, started_at, duration_minutes")
    .eq("teacher_id", teacherId)
    .in("status", ["active", "completed"]);

  if (billableError) {
    console.error(`[session-history] earnings query failed for ${teacherId}:`, billableError);
  }

  const earnedPaise = (billable ?? [])
    .filter(
      (r) =>
        r.refund_ref === null &&
        r.amount_paid_paise !== null &&
        effectiveStatus({ ...r, status: r.status as SessionStatus }, now) === "completed"
    )
    .reduce((sum, r) => sum + (r.amount_paid_paise ?? 0), 0);

  return (
    <Card className="p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-bold text-foreground">Your sessions</h3>
        <div className="text-right">
          <p className="font-mono text-2xl font-bold tabular-nums text-foreground">
            {billableError ? "—" : <Money paise={earnedPaise} />}
          </p>
          <p className="text-xs text-muted-foreground">
            {billableError ? "couldn't load earnings" : "earned · pending payout"}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sessions yet. Go available and your first request will appear here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-hair">
                <th className="py-2 font-semibold">Student</th>
                <th className="py-2 font-semibold">Subject</th>
                <th className="py-2 font-semibold">When</th>
                <th className="py-2 font-semibold">Status</th>
                <th className="py-2 font-semibold text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-hair">
                  <td className="py-2 text-foreground">
                    {r.student_name || "A student"}
                  </td>
                  <td className="py-2 text-muted-foreground">{r.subject}</td>
                  <td className="py-2 text-muted-foreground">{when(r.created_at)}</td>
                  <td className="py-2 text-muted-foreground">{r.status}</td>
                  <td className="py-2 text-right">
                    <span className="font-mono text-sm tabular-nums text-foreground">
                      ₹{r.hourly_rate}/hr
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-4">
        Payouts are made manually while payments are being set up.
        {rows.length === PAGE && ` Showing your latest ${PAGE} sessions; earnings cover all of them.`}
      </p>
    </Card>
  );
}
