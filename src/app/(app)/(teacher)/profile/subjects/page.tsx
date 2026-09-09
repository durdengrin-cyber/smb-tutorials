import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { SubjectRequestForm } from "./subject-request-form";

export default async function SubjectChangePage() {
  const identity = await requireRole("teacher");
  const supabase = await createClient();

  const [{ data: subjects }, { data: pending }] = await Promise.all([
    supabase
      .from("teacher_subjects")
      .select("curriculum, grade, stream, subject")
      .eq("teacher_id", identity.userId),
    // Own rows only — that is all the RLS policy in 0027 allows, and all a
    // teacher needs: whether one is waiting, and what was decided.
    supabase
      .from("subject_change_requests")
      .select("id, requested_at, demo_video_url, subjects, status, decision_note")
      // RLS already limits this to their own rows; filtering explicitly too so
      // the query says what it means and does not depend on a policy staying
      // exactly as it is to remain correct.
      .eq("teacher_id", identity.userId)
      .eq("status", "pending")
      .maybeSingle(),
  ]);

  const rows = subjects ?? [];
  const currentPairs = [...new Set(rows.map((r) => `${r.stream}|${r.subject}`))];
  const currentCurricula = [...new Set(rows.map((r) => r.curriculum))];
  const currentGrades = [...new Set(rows.map((r) => r.grade))];

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link
        href="/profile"
        className="text-sm text-primary underline underline-offset-4"
      >
        ← Back to your profile
      </Link>

      <div className="mb-8 mt-4">
        <PageHeader
          as="h1"
          title="Request a subject change"
          description="What you teach was approved from a video of you teaching it. Changing it needs a new one."
        />
      </div>

      {pending ? (
        // One open request at a time (0027 enforces it with a partial unique
        // index). Showing the form anyway would invite a submission that the
        // database is going to refuse.
        <div className="rounded-2xl border border-hair bg-card p-8">
          <p className="font-semibold text-foreground">
            Your request is waiting to be reviewed.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Sent{" "}
            {new Date(pending.requested_at as string).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            . You are still teaching your current subjects in the meantime.
          </p>
          <a
            href={pending.demo_video_url as string}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
          >
            The video you sent
          </a>
        </div>
      ) : (
        <SubjectRequestForm
          defaultCurricula={currentCurricula}
          defaultGrades={currentGrades}
          defaultSubjects={currentPairs}
        />
      )}
    </div>
  );
}
