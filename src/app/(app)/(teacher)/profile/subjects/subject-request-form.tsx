"use client";

import { useActionState } from "react";
import { requestSubjectChange } from "./actions";
import { SubjectPicker } from "@/components/subject-picker";
import { DemoVideoGuide } from "@/components/demo-video-guide";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SubjectRequestForm({
  defaultCurricula,
  defaultGrades,
  defaultSubjects,
}: {
  defaultCurricula: readonly string[];
  defaultGrades: readonly string[];
  defaultSubjects: readonly string[];
}) {
  const [state, formAction, isPending] = useActionState(requestSubjectChange, null);

  return (
    <form
      action={formAction}
      className="space-y-6 rounded-2xl border border-hair bg-card p-8 shadow-xl"
    >
      {/* Pre-filled with what they already teach, so a request to ADD one
          subject is not a request to re-enter all of them — and so the admin
          sees the whole intended list, not a delta they have to reconstruct. */}
      <SubjectPicker
        defaultCurricula={defaultCurricula}
        defaultGrades={defaultGrades}
        defaultSubjects={defaultSubjects}
      />

      <div className="space-y-3">
        <Label htmlFor="request-demoVideoUrl">
          A demo video for the new subjects *
        </Label>
        <p className="text-sm text-muted-foreground">
          This is the point of the request: whoever reviews it needs to watch
          you teach what you are asking to teach. An existing video of a
          different subject will not tell them anything.
        </p>
        <Input
          id="request-demoVideoUrl"
          type="url"
          name="demoVideoUrl"
          required
          placeholder="https://youtu.be/..."
        />
        <DemoVideoGuide />
      </div>

      {state?.error && <FormError>{state.error}</FormError>}

      <Button type="submit" disabled={isPending} className="h-11 w-full">
        {isPending ? "Sending…" : "Send request"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        You keep teaching your current subjects while this is reviewed.
      </p>
    </form>
  );
}
