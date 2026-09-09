"use client";

import { useActionState, useState } from "react";
import { updateTeacherProfile } from "./actions";
import { SubjectPicker } from "@/components/subject-picker";
import { useResubmitKey } from "@/components/use-resubmit-key";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SELECT =
  "h-8 w-full rounded-lg border border-input bg-card px-2.5 py-1 text-sm font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export interface ProfileFormValues {
  fullName: string;
  phone: string;
  experienceYears: number | null;
  qualification: string;
  specialization: string;
  teachingLevel: string;
  hourlyRate: number | null;
  hoursPerWeek: string;
  demoVideoUrl: string;
  bio: string;
  defaultCurricula: readonly string[];
  defaultGrades: readonly string[];
  defaultSubjects: readonly string[];
}

export function ProfileForm(values: ProfileFormValues) {
  const [state, formAction, isPending] = useActionState(updateTeacherProfile, null);

  // What the teacher last TYPED, which must win over what is SAVED.
  // React 19 resets an uncontrolled form when its action completes, so before
  // this a rejected save quietly reverted every unsaved edit back to stored
  // data — the same defect as the signup form's blank return, but harder to
  // notice, because the form looks populated and simply is not showing your
  // work any more. Named `edited` because `values` is already this
  // component's prop, holding the saved row.
  const edited = state?.values;
  // <select> needs a remount to pick up a new default; see useResubmitKey.
  const resubmitKey = useResubmitKey(state);

  // Nothing else on this page tells a teacher their save actually landed —
  // there is no redirect and no toast wired into the app shell, so a
  // successful submit that returns null (AuthState's success case) would
  // otherwise look identical to not having clicked Save at all. Adjusted
  // during render rather than in an Effect (React's own recommended pattern
  // for deriving state from a prop/state change) so a save is never missed
  // to a render that ran between an Effect firing and the next paint.
  const [prevPending, setPrevPending] = useState(isPending);
  const [justSaved, setJustSaved] = useState(false);
  if (isPending !== prevPending) {
    setPrevPending(isPending);
    if (prevPending && !isPending && !state?.error) setJustSaved(true);
    else if (isPending) setJustSaved(false);
  }

  return (
    <form
      action={formAction}
      // "Saved." never lies about a half-save — every partial failure returns
      // an error, and this is guarded by !state?.error — but it would sit
      // beside an edit the teacher has since made and not yet saved. Clear it
      // on the next change, before that edit is submitted.
      onChange={() => setJustSaved(false)}
      className="bg-card rounded-2xl shadow-xl p-8 border border-hair space-y-6"
    >
      <div>
        <h3 className="text-xl font-bold text-foreground mb-4">
          Personal Information
        </h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="profile-fullName">Full Name *</Label>
            <Input
              id="profile-fullName"
              type="text"
              name="fullName"
              required
              defaultValue={edited?.fullName ?? values.fullName}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-phone">Phone Number *</Label>
            <Input
              id="profile-phone"
              type="tel"
              name="phone"
              required
              defaultValue={edited?.phone ?? values.phone}
              placeholder="10-digit number"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-experience">Years of Experience *</Label>
            <Input
              id="profile-experience"
              type="number"
              name="experience"
              required
              min={0}
              defaultValue={edited?.experience ?? values.experienceYears ?? ""}
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold text-foreground mb-4">
          Education &amp; Qualifications
        </h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-qualification">Highest Qualification *</Label>
            <Input
              id="profile-qualification"
              type="text"
              name="qualification"
              required
              defaultValue={edited?.qualification ?? values.qualification}
              placeholder="e.g., PhD in Physics, IIT Delhi"
            />
          </div>

          <SubjectPicker
            defaultCurricula={edited?.curricula ?? values.defaultCurricula}
            defaultGrades={edited?.grades ?? values.defaultGrades}
            defaultSubjects={edited?.subjects ?? values.defaultSubjects}
          />

          <div className="space-y-2">
            <Label htmlFor="profile-specialization">Specialization</Label>
            <Input
              id="profile-specialization"
              type="text"
              name="specialization"
              defaultValue={edited?.specialization ?? values.specialization}
              placeholder="e.g., Mechanics, Thermodynamics"
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold text-foreground mb-4">
          Teaching Preferences
        </h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="profile-teachingLevel">Preferred Teaching Level</Label>
            <select
              key={`teachingLevel-${resubmitKey}`}
              id="profile-teachingLevel"
              name="teachingLevel"
              className={SELECT}
              defaultValue={edited?.teachingLevel ?? values.teachingLevel}
            >
              <option value="">Select level</option>
              <option value="school">School (6th-12th)</option>
              <option value="college">College/University</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-hourlyRate">Hourly Rate (₹) *</Label>
            <Input
              id="profile-hourlyRate"
              type="number"
              name="hourlyRate"
              required
              min={1}
              defaultValue={edited?.hourlyRate ?? values.hourlyRate ?? ""}
            />
            <p className="text-sm text-muted-foreground">
              A student already mid-request is charged the rate that was live
              when they asked — changing this never re-prices a session in
              progress.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-hoursPerWeek">Hours Available per Week *</Label>
            <select
              key={`hoursPerWeek-${resubmitKey}`}
              id="profile-hoursPerWeek"
              name="hoursPerWeek"
              required
              className={SELECT}
              defaultValue={edited?.hoursPerWeek ?? values.hoursPerWeek}
            >
              <option value="">Select hours</option>
              <option value="5-10">5-10 hours/week</option>
              <option value="10-20">10-20 hours/week</option>
              <option value="20-30">20-30 hours/week</option>
              <option value="30-40">30-40 hours/week</option>
              <option value="40+">40+ hours/week (Full-time)</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold text-foreground mb-4">Demo Video</h3>
        <div className="space-y-2">
          <Label htmlFor="profile-demoVideoUrl">Demo Video Link (YouTube) *</Label>
          <p className="text-sm text-muted-foreground">
            An Unlisted YouTube link — this is what students watch when choosing
            a tutor. Changing it sends your profile back for review, and you
            will not appear in search until someone has watched the new one.
          </p>
          <Input
            id="profile-demoVideoUrl"
            type="url"
            name="demoVideoUrl"
            required
            defaultValue={edited?.demoVideoUrl ?? values.demoVideoUrl}
            placeholder="https://youtu.be/..."
          />
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold text-foreground mb-4">Bio</h3>
        <div className="space-y-2">
          <Label htmlFor="profile-bio">
            About you{" "}
            <span className="font-normal text-muted-foreground">
              (optional, 1000 characters max)
            </span>
          </Label>
          <textarea
            id="profile-bio"
            name="bio"
            rows={5}
            maxLength={1000}
            defaultValue={edited?.bio ?? values.bio}
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            placeholder="Tell students what it's like to learn from you."
          />
        </div>
      </div>

      {state?.error && <FormError>{state.error}</FormError>}
      {justSaved && !state?.error && (
        <p role="status" className="text-sm text-success">
          Saved.
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full h-12 font-bold">
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
