"use client";

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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-lg transition-all duration-300 overflow-hidden">
      <div className="bg-gradient-to-br from-teal-50 to-cyan-50 p-6 text-center">
        <div className="text-6xl mb-3">🧑‍🏫</div>
        <h3 className="text-xl font-bold text-gray-900">{teacher.full_name}</h3>
        <p className="text-teal-600 font-medium">{teacher.subject}</p>
      </div>

      <div className="p-6">
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
          <button
            type="button"
            onClick={onStart}
            disabled={!onStart || starting}
            className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-semibold px-6 py-2 rounded-lg transition-all disabled:opacity-50"
          >
            {starting ? "Asking…" : "Start now →"}
          </button>
        </div>
      </div>
    </div>
  );
}
