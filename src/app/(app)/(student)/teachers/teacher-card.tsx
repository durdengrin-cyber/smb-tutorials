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
      <div className="bg-gradient-to-br from-teal-50 to-cyan-50 p-6 text-center">
        <div className="text-6xl mb-3">🧑‍🏫</div>
        <h3 className="text-xl font-bold text-gray-900">{teacher.full_name}</h3>
        <p className="text-teal-600 font-medium">{teacher.subject}</p>
      </div>

      <CardContent className="p-6">
        {teacher.experience_years !== null && (
          <div className="flex items-center justify-end mb-4">
            <span className="text-sm text-gray-600">
              {teacher.experience_years} yrs exp.
            </span>
          </div>
        )}

        {teacher.qualification && (
          <div className="mb-4">
            <p className="text-sm font-semibold text-gray-700 mb-1">Education</p>
            <p className="text-sm text-gray-600">{teacher.qualification}</p>
          </div>
        )}

        {teacher.specialization && (
          <div className="mb-4">
            <p className="text-sm font-semibold text-gray-700 mb-1">
              Specialization
            </p>
            <p className="text-sm text-gray-600">{teacher.specialization}</p>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          <div>
            <span className="text-2xl font-bold text-gray-900">
              ₹{teacher.hourly_rate ?? "—"}
            </span>
            <span className="text-sm text-gray-600">/hour</span>
          </div>
          <Button type="button" onClick={onStart} disabled={!onStart || starting}>
            {starting ? "Asking…" : "Start now →"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
