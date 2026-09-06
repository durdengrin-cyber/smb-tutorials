"use client";

import {
  CURRICULA,
  GRADES,
  STREAMS,
  SUBJECTS_BY_STREAM,
} from "@/lib/taxonomy";
import { Label } from "@/components/ui/label";

// Checkboxes inside labels, so a plain form submission carries repeated
// entries — no client state needed. The action expands the three selections
// into one teacher_subjects row per combination.
function Chip({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="cursor-pointer">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <div className="py-3 px-4 rounded-lg border-2 font-medium text-center transition-all border-border text-muted-foreground hover:border-primary/40 peer-checked:border-primary peer-checked:bg-muted peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
        {label}
      </div>
    </label>
  );
}

export function SubjectPicker({
  defaultCurricula = [],
  defaultGrades = [],
  defaultSubjects = [],
}: {
  // Pre-selection for the profile-editing form, which reuses this same
  // picker (rather than a copy) so signup and editing can never disagree on
  // what curricula, grades or subjects look like. Signup passes none, so a
  // fresh application starts with nothing checked, as it always has.
  defaultCurricula?: readonly string[];
  defaultGrades?: readonly string[];
  defaultSubjects?: readonly string[]; // "Stream|Subject" pairs
} = {}) {
  return (
    <div className="space-y-6">
      <div>
        <Label className="mb-3">
          Curriculum * <span className="font-normal text-muted-foreground">(select all you teach)</span>
        </Label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CURRICULA.map((c) => (
            <Chip
              key={c}
              name="curricula"
              value={c}
              label={c}
              defaultChecked={defaultCurricula.includes(c)}
            />
          ))}
        </div>
      </div>

      <div>
        <Label className="mb-3">
          Grades * <span className="font-normal text-muted-foreground">(select all you teach)</span>
        </Label>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-3">
          {GRADES.map((g) => (
            <Chip
              key={g}
              name="grades"
              value={g}
              label={g}
              defaultChecked={defaultGrades.includes(g)}
            />
          ))}
        </div>
      </div>

      <div>
        <Label className="mb-3">Subjects You Teach *</Label>
        <div className="space-y-4">
          {STREAMS.map((stream) => (
            <div key={stream}>
              <p className="text-sm font-semibold text-primary mb-2">{stream}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {SUBJECTS_BY_STREAM[stream].map((subject) => (
                  <Chip
                    key={`${stream}|${subject}`}
                    name="subjects"
                    value={`${stream}|${subject}`}
                    label={subject}
                    defaultChecked={defaultSubjects.includes(`${stream}|${subject}`)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground mt-3">
          Students find you by curriculum, grade and subject — your selections
          are combined, so CBSE + 11th, 12th + Physics means you teach Physics
          to both grades under CBSE.
        </p>
      </div>
    </div>
  );
}
