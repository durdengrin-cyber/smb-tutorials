import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { createClient } from "@/lib/supabase/server";
import { isCurriculum, isGrade, isStream, isSubjectOf } from "@/lib/taxonomy";
import { TeacherCard, type TeacherCardData } from "./teacher-card";

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

  const curriculum = one(params.curriculum);
  const grade = one(params.grade);
  const stream = one(params.stream);
  const subject = one(params.subject);

  const supabase = await createClient();
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
      <SiteHeader
        action={
          <Link
            href="/find"
            className="text-teal-600 hover:text-teal-700 font-medium"
          >
            ← Back to Search
          </Link>
        }
      />

      <main className="px-8 py-12">
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
          ) : teachers.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {teachers.map((teacher) => (
                <TeacherCard key={teacher.id} teacher={teacher} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
              <div className="text-5xl mb-4">🔍</div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                No teachers {subject ? `for ${subject}` : "yet"} — check back
                soon
              </h3>
              <p className="text-gray-600">
                We&apos;re onboarding tutors now. Try another subject in the
                meantime.
              </p>
            </div>
          )}

          {/* Request tier arrives in M4 */}
          <div className="mt-16 text-center">
            <div className="bg-gradient-to-br from-teal-50 to-cyan-50 rounded-2xl p-12 border border-gray-100">
              <h3 className="text-2xl font-bold text-gray-900 mb-3">
                Didn&apos;t find what you&apos;re looking for?
              </h3>
              <p className="text-gray-600 mb-6 max-w-2xl mx-auto">
                We have more teachers who are currently inactive. Request them
                and we&apos;ll notify them that you need their expertise!
              </p>
              <button
                type="button"
                disabled
                title="Teacher requests arrive in M4"
                className="bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-semibold px-8 py-4 rounded-lg text-lg opacity-50 cursor-not-allowed"
              >
                Request a Teacher
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
