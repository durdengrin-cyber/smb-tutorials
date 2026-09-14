import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { firstName } from "@/lib/names";
import { moneyTouched } from "@/lib/student-sessions";
import { Money } from "@/components/money";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReportButton } from "./report-button";

const PAGE = 25;

// Server-rendered, so the runtime's zone is UTC on Vercel. Naming the zone
// keeps times right for the audience instead of silently 5:30 off.
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default async function SessionsPage() {
  const identity = await requireUser();
  const supabase = await createClient();

  // The teacher's NAME comes from a join, unlike the teacher's view of a
  // student, which reads a denormalised sessions.student_name (0004). The
  // asymmetry is in the RLS: 0001 lets anyone read a TEACHER profile
  // (`role = 'teacher' or id = auth.uid()`), so no extra column is needed here.
  // The money-touched predicate is duplicated here AND in the client-side
  // .filter(moneyTouched) below — deliberately. This .or() is what makes
  // `.limit(PAGE)` mean "the 25 most recent PAID sessions" instead of "the 25
  // most recent sessions, most of which are unpaid pending/declined/expired
  // rows that then get discarded, quietly shrinking the visible record".
  // Unpaid rows are the dominant row type (teachers/actions.ts inserts one on
  // every instant-pick attempt, retried on every decline/timeout), so without
  // this the limit bites long before 25 paid lessons and can render the empty
  // state for a paying parent. moneyTouched stays the single authoritative,
  // unit-tested statement of the rule; this is belt-and-braces at the query
  // layer, not a second source of truth.
  const { data, error } = await supabase
    .from("sessions")
    .select(
      // teacher_id and stream are here for "Book again": /teachers filters on
      // curriculum/grade/stream/subject, and stream was the one criterion this
      // page never needed until a row became a way back to the same teacher.
      "id, subject, curriculum, grade, stream, teacher_id, created_at, started_at, amount_paid_paise, refund_ref, cancellation_reason, teacher:profiles!sessions_teacher_id_fkey (full_name)"
    )
    .eq("student_id", identity.userId)
    .or("amount_paid_paise.not.is.null,refund_ref.not.is.null")
    .order("created_at", { ascending: false })
    .limit(PAGE);

  if (error) console.error("[sessions] history query failed", error);

  const rows = (data ?? []).filter(moneyTouched);

  return (
    <div className="min-h-screen bg-background">
      <div className="px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-3xl space-y-8">
          <PageHeader
            title="Your sessions"
            description="Every lesson you've paid for, and any refunds."
          />

          {rows.length === 0 ? (
            <EmptyState
              title={error ? "Couldn't load your sessions" : "No sessions yet"}
              description={
                error
                  ? "This is on us, not you. Try reloading in a moment."
                  : "Lessons you pay for will appear here, with what you were charged. Ready to start?"
              }
              action={
                <Button asChild>
                  <Link href="/find">Find a teacher</Link>
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex justify-end">
                <Button asChild variant="outline">
                  <Link href="/find">Find a teacher</Link>
                </Button>
              </div>
              <ul className="space-y-4">
                {rows.map((s) => {
                  const teacherName =
                    (s.teacher as { full_name?: string } | null)?.full_name ?? "Your teacher";
                  return (
                    <li key={s.id}>
                      <Card>
                        <CardContent className="p-6">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h3 className="font-semibold text-foreground">
                              {s.subject} with {teacherName}
                            </h3>
                            <span className="text-sm text-muted-foreground">
                              {when(s.started_at ?? s.created_at)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {s.curriculum} · {s.grade}
                          </p>
                          <p className="mt-3 text-sm">
                            {s.amount_paid_paise ? (
                              <>
                                Paid <Money paise={s.amount_paid_paise} />
                              </>
                            ) : (
                              "No charge recorded"
                            )}
                            {s.refund_ref && (
                              <span className="ml-2 rounded-full bg-success/12 px-2 py-0.5 text-xs font-medium text-success">
                                Refunded
                              </span>
                            )}
                            {s.cancellation_reason === "teacher_suspended" && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                Teacher unavailable
                              </span>
                            )}
                          </p>
                          {/* EVERY listed row gets this, whatever the status.
                              Why a lesson did not happen is not ours to read:
                              a payment that failed, a parent who changed their
                              mind and a teacher who declined all look the same
                              from here, and in each case wanting that same
                              teacher again is the parent's call. (Rows that
                              never touched money are not on this page at all,
                              so "every row" is every row a parent can see.)

                              An explicit control rather than the whole card
                              being a link: ReportButton is a button inside
                              this row, and nesting interactive elements is
                              invalid and breaks keyboard and screen-reader
                              navigation. Same reason the teacher card uses an
                              explicit disclosure instead of a tappable body.

                              Carries the subject and the rest of the criteria,
                              so the list arrives filtered the way it was the
                              first time. It is a query string, so the parent
                              can still change any of it on /teachers. */}
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <Button asChild variant="outline" size="sm">
                              <Link
                                href={`/teachers?${new URLSearchParams({
                                  curriculum: s.curriculum ?? "",
                                  grade: s.grade ?? "",
                                  stream: s.stream ?? "",
                                  subject: s.subject ?? "",
                                  again: s.teacher_id ?? "",
                                })}`}
                              >
                                Book {firstName(teacherName)} again
                              </Link>
                            </Button>
                            <ReportButton sessionId={s.id} />
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
              {rows.length === PAGE && (
                <p className="text-xs text-muted-foreground">
                  Showing your latest {PAGE} sessions.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
