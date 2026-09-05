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
}: {
  name: string;
  value: string;
  label: string;
}) {
  return (
    <label className="cursor-pointer">
      <input type="checkbox" name={name} value={value} className="peer sr-only" />
      <div className="py-3 px-4 rounded-lg border-2 font-medium text-center transition-all border-border text-muted-foreground hover:border-border peer-checked:border-primary peer-checked:bg-muted peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
        {label}
      </div>
    </label>
  );
}

export function SubjectPicker() {
  return (
    <div className="space-y-6">
      <div>
        <Label className="mb-3">
          Curriculum * <span className="font-normal text-muted-foreground">(select all you teach)</span>
        </Label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CURRICULA.map((c) => (
            <Chip key={c} name="curricula" value={c} label={c} />
          ))}
        </div>
      </div>

      <div>
        <Label className="mb-3">
          Grades * <span className="font-normal text-muted-foreground">(select all you teach)</span>
        </Label>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-3">
          {GRADES.map((g) => (
            <Chip key={g} name="grades" value={g} label={g} />
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
