import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isCurriculum, isGrade, isStream, isSubjectOf } from "@/lib/taxonomy";
import { type TeacherCardData } from "./teacher-card";
import { OnlineList } from "./online-list";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

type SubjectRow = {
  curriculum: string;
  grade: string;
  stream: string;
  subject: string;
};

type TeacherRow = {
  id: string;
  full_name: string;
  qualification: string | null;
  specialization: string | null;
  experience_years: number | null;
  hourly_rate: number | null;
  bio: string | null;
  teacher_subjects: SubjectRow[];
};

// `amount` arrives as a query-string parameter, so it is attacker-controlled.
// Anything that isn't a clean positive integer is dropped rather than passed
// on to <Money>, which would otherwise render garbage.
function parsePositiveInt(v: string): number | undefined {
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n > 0 ? n : undefined;
}

export default async function TeachersPage({
  searchParams,
}: PageProps<"/teachers">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] ?? "" : v ?? "";

  const identity = await requireUser();
  const supabase = await createClient();

  let curriculum = one(params.curriculum);
  let grade = one(params.grade);
  let stream = one(params.stream);
  let subject = one(params.subject);

  // The student's search used to live ONLY in the url, so any route back here
  // that dropped it stranded them: the teachers still listed, but every
  // "Start now" greyed out, and the only way forward was to walk /find again
  // and re-pick what they had already picked. Found in the Task 13 run after
  // cancelling out of a payment window.
  //
  // Recovered from their own last request rather than by patching whichever
  // navigation dropped it — browser back, a bookmark, a shared link and any
  // future redirect all land here the same way, and the criteria are already
  // recorded on the row. Only recovers when the criteria are ENTIRELY absent:
  // a partly-specified url is the student narrowing their own search, and
  // overwriting that would be worse than the dead end.
  if (!curriculum && !grade && !stream && !subject) {
    const { data: last } = await supabase
      .from("sessions")
      .select("curriculum, grade, stream, subject")
      .eq("student_id", identity.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last) {
      curriculum = last.curriculum;
      grade = last.grade;
      stream = last.stream;
      subject = last.subject;
    }
  }
  // Kept as one string literal: Supabase parses the select at the type level,
  // and a concatenated string defeats that inference.
  let query = supabase
    .from("profiles")
    .select(
      "id, full_name, qualification, specialization, experience_years, hourly_rate, bio, teacher_subjects!inner(curriculum, grade, stream, subject)"
    )
    .eq("role", "teacher");

  // Each filter applies only if it is valid taxonomy, so a junk query
  // parameter is ignored rather than passed to the database.
  if (isCurriculum(curriculum))
    query = query.eq("teacher_subjects.curriculum", curriculum);
  if (isGrade(grade)) query = query.eq("teacher_subjects.grade", grade);
  if (isStream(stream)) query = query.eq("teacher_subjects.stream", stream);
  if (isSubjectOf(stream, subject))
    query = query.eq("teacher_subjects.subject", subject);

  const { data, error } = await query.returns<TeacherRow[]>();

  const teachers: TeacherCardData[] = (data ?? []).map((t) => ({
    id: t.id,
    full_name: t.full_name,
    qualification: t.qualification,
    specialization: t.specialization,
    experience_years: t.experience_years,
    hourly_rate: t.hourly_rate,
    bio: t.bio,
    subject:
      (isSubjectOf(stream, subject) && subject) ||
      t.teacher_subjects[0]?.subject ||
      "",
  }));

  const criteria = [subject, curriculum, grade].filter(Boolean).join(" • ");

  return (
    <div className="min-h-screen bg-background">
      <div className="px-4 py-8 sm:px-8 sm:py-12">
        <div className="max-w-6xl mx-auto">
          <PageHeader
            title="Available Teachers"
            description={
              criteria ? `Showing teachers for ${criteria}` : "Showing all teachers"
            }
          />

          {error ? (
            <Card>
              <CardContent className="p-6 text-center sm:p-12">
                <p className="text-foreground font-semibold mb-2">
                  Couldn&apos;t load teachers
                </p>
                <p className="text-muted-foreground">Refresh to try again.</p>
              </CardContent>
            </Card>
          ) : (
            <OnlineList
              eligible={teachers}
              subject={subject}
              curriculum={curriculum}
              grade={grade}
              stream={stream}
              outcome={one(params.outcome) || undefined}
              teacherName={one(params.teacher) || undefined}
              refundAmountPaise={parsePositiveInt(one(params.amount))}
            />
          )}

        </div>
      </div>
    </div>
  );
}
