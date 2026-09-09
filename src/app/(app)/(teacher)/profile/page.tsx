import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "./profile-form";
import { PageHeader } from "@/components/page-header";

export default async function ProfilePage() {
  const identity = await requireRole("teacher");
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, phone, experience_years, qualification, specialization, teaching_level, hourly_rate, hours_per_week, demo_video_url, bio"
    )
    .eq("id", identity.userId)
    .single();

  const { data: subjectRows } = await supabase
    .from("teacher_subjects")
    .select("curriculum, grade, stream, subject")
    .eq("teacher_id", identity.userId);

  const subjects = subjectRows ?? [];
  // Distinct curricula/grades across the teacher's existing rows, so a
  // teacher teaching CBSE 11th Physics and ICSE 12th Chemistry sees CBSE,
  // ICSE, 11th, 12th and both subject chips pre-checked — the same
  // curriculum × grade × subject expansion parseTeacherProfileFields uses
  // to turn selections back into rows on save.
  const defaultCurricula = [...new Set(subjects.map((s) => s.curriculum as string))];
  const defaultGrades = [...new Set(subjects.map((s) => s.grade as string))];
  const defaultSubjects = [
    ...new Set(subjects.map((s) => `${s.stream}|${s.subject}`)),
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="px-4 py-8 sm:px-8 sm:py-12">
        <div className="max-w-3xl mx-auto space-y-8">
          <PageHeader
            title="Your profile"
            description="Students see your rate, subjects, qualification, experience and bio when they pick a teacher."
          />
          <ProfileForm
            fullName={profile?.full_name ?? identity.fullName}
            phone={profile?.phone ?? ""}
            experienceYears={profile?.experience_years ?? null}
            qualification={profile?.qualification ?? ""}
            specialization={profile?.specialization ?? ""}
            teachingLevel={profile?.teaching_level ?? ""}
            hourlyRate={profile?.hourly_rate ?? null}
            hoursPerWeek={profile?.hours_per_week ?? ""}
            demoVideoUrl={profile?.demo_video_url ?? ""}
            bio={profile?.bio ?? ""}
            defaultCurricula={defaultCurricula}
            defaultGrades={defaultGrades}
            defaultSubjects={defaultSubjects}
          />
        </div>
      </div>
    </div>
  );
}
