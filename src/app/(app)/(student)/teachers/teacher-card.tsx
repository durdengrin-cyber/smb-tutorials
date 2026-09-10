"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface TeacherCardData {
  id: string;
  full_name: string;
  qualification: string | null;
  specialization: string | null;
  experience_years: number | null;
  hourly_rate: number | null;
  bio: string | null;
  demo_video_url: string | null;
  subject: string;
}

export function TeacherCard({
  teacher,
  onStart,
  starting,
}: {
  teacher: TeacherCardData;
  onStart?: () => void;
  starting?: boolean;
}) {
  return (
    <Card className="gap-0 py-0 hover:shadow-lg transition-shadow duration-300">
      <div className="bg-muted p-6 text-center">
        <h3 className="text-xl font-bold tracking-tight text-foreground">
          {teacher.full_name}
        </h3>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-primary">
          {teacher.subject}
        </p>
      </div>

      <CardContent className="p-6">
        {teacher.experience_years !== null && (
          <div className="flex items-center justify-end mb-4">
            <span className="text-sm text-muted-foreground">
              {teacher.experience_years} yrs exp.
            </span>
          </div>
        )}

        {/* The only free text a teacher controls, and until now the only field
            the profile editor promised students would read and none of them
            could. Clamped to three lines so one teacher writing an essay does
            not make every card in the row that tall; the whole thing is still
            there for the admin to read when vetting. */}
        {teacher.bio?.trim() ? (
          <p className="mb-4 line-clamp-3 text-sm italic text-muted-foreground">
            {teacher.bio.trim()}
          </p>
        ) : null}

        {teacher.qualification && (
          <div className="mb-4">
            <p className="text-sm font-semibold text-muted-foreground mb-1">Education</p>
            <p className="text-sm text-muted-foreground">{teacher.qualification}</p>
          </div>
        )}

        {teacher.specialization && (
          <div className="mb-4">
            <p className="text-sm font-semibold text-muted-foreground mb-1">
              Specialization
            </p>
            <p className="text-sm text-muted-foreground">{teacher.specialization}</p>
          </div>
        )}

        {/* The teacher is told, on their profile form, that an unlisted
            YouTube link "is what students watch when choosing a tutor". Until
            2026-09-10 nobody but an admin could watch it: the column was not
            selected here and not rendered. Pinned by profile-claims.test.ts,
            which fails if either half goes away. */}
        {teacher.demo_video_url ? (
          <a
            href={teacher.demo_video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-4"
          >
            Watch their demo lesson
          </a>
        ) : null}

        <div className="flex items-center justify-between pt-4 border-t border-hair">
          <div>
            <span className="text-2xl font-bold text-foreground">
              ₹{teacher.hourly_rate ?? "—"}
            </span>
            <span className="text-sm text-muted-foreground">/hour</span>
          </div>
          <Button type="button" onClick={onStart} disabled={!onStart || starting}>
            {starting ? "Asking…" : "Start now →"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
