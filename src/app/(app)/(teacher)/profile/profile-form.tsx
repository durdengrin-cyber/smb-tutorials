"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { updateTeacherProfile } from "./actions";
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
      {/* At the top and about the whole form, not tucked under Demo Video.
          0024 compares the entire profile row minus bookkeeping, so changing
          the rate, bio, phone, qualification, specialization or teaching level
          sends a cleared teacher back to the queue exactly as a new video
          does. A warning under one field would have been read as applying to
          that field alone. */}
      <div className="rounded-lg border border-border bg-muted p-4">
        <p className="text-sm font-semibold text-foreground">
          Saving any change here sends your profile back for review
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          You will not appear in search until someone has looked at it again.
          Your rate, your bio, your name — anything on this page. Sessions
          already booked are unaffected.
        </p>
      </div>

      <div>
        <h3 className="text-xl font-bold text-foreground mb-4">
          Personal information
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
          Education &amp; qualifications
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

          {/* Read-only since 0027. Changing what you claim to be qualified to
              teach a child is not a form field: it goes through a request that
              carries a new demo video and takes effect only when an admin has
              watched it. The picker is still used, on /profile/subjects, to
              compose that request. */}
          <div className="rounded-lg border border-border bg-muted p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                What you teach
              </p>
              <Link
                href="/profile/subjects"
                className="text-sm text-primary underline underline-offset-4"
              >
                Request a change
              </Link>
            </div>
            {values.defaultSubjects.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No subjects yet.
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {values.defaultSubjects.map((s) => (
                  <li
                    key={s}
                    className="rounded-sm bg-card px-2 py-1 font-mono text-xs text-muted-foreground"
                  >
                    {s.replace("|", " · ")}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Across {values.defaultCurricula.join(", ") || "no curriculum"} ·{" "}
              {values.defaultGrades.join(", ") || "no grade"}
            </p>
          </div>

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
          Teaching preferences
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
        <h3 className="text-xl font-bold text-foreground mb-4">Demo video</h3>
        <div className="space-y-2">
          <Label htmlFor="profile-demoVideoUrl">Demo Video Link (YouTube) *</Label>
          <p className="text-sm text-muted-foreground">
            An Unlisted YouTube link — this is what students watch when choosing
            a tutor.
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
              (optional, shown to students, 1000 characters max)
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
