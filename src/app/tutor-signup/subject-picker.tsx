"use client";

import {
  CURRICULA,
  GRADES,
  STREAMS,
  SUBJECTS_BY_STREAM,
} from "@/lib/taxonomy";

// Checkboxes inside labels, so a plain form submission carries repeated
// entries — no client state needed. The action expands the three selections
// into one teacher_subjects row per combination.
function Chip({
  name,
  value,
  label,
}: {
  name: string;
  value: string;
  label: string;
}) {
  return (
    <label className="cursor-pointer">
      <input type="checkbox" name={name} value={value} className="peer sr-only" />
      <div className="py-3 px-4 rounded-lg border-2 font-medium text-center transition-all border-gray-200 text-gray-700 hover:border-teal-300 peer-checked:border-teal-600 peer-checked:bg-teal-50 peer-checked:text-teal-600">
        {label}
      </div>
    </label>
  );
}

export function SubjectPicker() {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          Curriculum * <span className="font-normal text-gray-500">(select all you teach)</span>
        </label>
        <div className="grid grid-cols-3 gap-3">
          {CURRICULA.map((c) => (
            <Chip key={c} name="curricula" value={c} label={c} />
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          Grades * <span className="font-normal text-gray-500">(select all you teach)</span>
        </label>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-3">
          {GRADES.map((g) => (
            <Chip key={g} name="grades" value={g} label={g} />
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          Subjects You Teach *
        </label>
        <div className="space-y-4">
          {STREAMS.map((stream) => (
            <div key={stream}>
              <p className="text-sm font-semibold text-teal-600 mb-2">{stream}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {SUBJECTS_BY_STREAM[stream].map((subject) => (
                  <Chip
                    key={`${stream}|${subject}`}
                    name="subjects"
                    value={`${stream}|${subject}`}
                    label={subject}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-sm text-gray-500 mt-3">
          Students find you by curriculum, grade and subject — your selections
          are combined, so CBSE + 11th, 12th + Physics means you teach Physics
          to both grades under CBSE.
        </p>
      </div>
    </div>
  );
}
