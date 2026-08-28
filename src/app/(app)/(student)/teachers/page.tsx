import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isCurriculum, isGrade, isStream, isSubjectOf } from "@/lib/taxonomy";
import { type TeacherCardData } from "./teacher-card";
import { OnlineList } from "./online-list";

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
  teacher_subjects: SubjectRow[];
};

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
  // recorded on the row. Only fills a COMPLETE set of gaps: a partly-specified
  // url is the student narrowing their own search, and overwriting that would
  // be worse than the dead end.
  if (!(curriculum && grade && stream && subject)) {
    const { data: last } = await supabase
      .from("sessions")
      .select("curriculum, grade, stream, subject")
      .eq("student_id", identity.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last) {
      curriculum = curriculum || last.curriculum;
      grade = grade || last.grade;
      stream = stream || last.stream;
      subject = subject || last.subject;
    }
  }
  // Kept as one string literal: Supabase parses the select at the type level,
  // and a concatenated string defeats that inference.
  let query = supabase
    .from("profiles")
    .select(
      "id, full_name, qualification, specialization, experience_years, hourly_rate, teacher_subjects!inner(curriculum, grade, stream, subject)"
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
    subject:
      (isSubjectOf(stream, subject) && subject) ||
      t.teacher_subjects[0]?.subject ||
      "",
  }));

  const criteria = [subject, curriculum, grade].filter(Boolean).join(" • ");

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="px-8 py-12">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Available Teachers
            </h2>
            <p className="text-gray-600">
              {criteria ? (
                <>
                  Showing teachers for{" "}
                  <span className="font-semibold text-teal-600">{criteria}</span>
                </>
              ) : (
                "Showing all teachers"
              )}
            </p>
          </div>

          {error ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
              <p className="text-gray-900 font-semibold mb-2">
                Couldn&apos;t load teachers
              </p>
              <p className="text-gray-600">Refresh to try again.</p>
            </div>
          ) : (
            <OnlineList
              eligible={teachers}
              subject={subject}
              curriculum={curriculum}
              grade={grade}
              stream={stream}
              outcome={one(params.outcome) || undefined}
              teacherName={one(params.teacher) || undefined}
            />
          )}

        </div>
      </div>
    </div>
  );
}
