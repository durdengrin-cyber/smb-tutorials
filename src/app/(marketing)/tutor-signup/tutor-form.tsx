"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpTutor } from "./actions";
import { SubjectPicker } from "@/components/subject-picker";
import { FormError } from "@/components/form-error";
import { DemoVideoGuide } from "@/components/demo-video-guide";
import { useResubmitKey } from "@/components/use-resubmit-key";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SELECT =
  "h-8 w-full rounded-lg border border-input bg-card px-2.5 py-1 text-sm font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function TutorForm({ signedIn = false }: { signedIn?: boolean }) {
  const [state, formAction, isPending] = useActionState(signUpTutor, null);

  // React 19 resets an uncontrolled form when its action completes, so without
  // these a rejected application came back blank — fifteen fields and every
  // chip, lost to one mistyped character. The action echoes what was typed
  // (never the password) and it is re-seeded here.
  const v = state?.values;
  // <select> needs a remount to pick up a new default; see useResubmitKey.
  const resubmitKey = useResubmitKey(state);

  return (
    <form
      action={formAction}
      className="bg-card rounded-2xl shadow-xl p-8 border border-hair space-y-6"
    >
      {/* Personal Information */}
      <div>
        <h3 className="text-xl font-bold text-foreground mb-4">
          Personal Information
        </h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tutor-fullName">Full Name *</Label>
            <Input
              id="tutor-fullName"
            defaultValue={v?.fullName ?? ""}
              type="text"
              name="fullName"
              required
              placeholder="Dr. John Doe"
            />
          </div>
          {/* Only on the signed-out path. signUpTutor upgrades an existing
              account through become_teacher and never reads either field, so
              asking a signed-in person for a password made them invent one
              that was silently discarded. */}
          {signedIn ? null : (
            <>
              <div className="space-y-2">
                <Label htmlFor="tutor-email">Email Address *</Label>
                <Input
                  id="tutor-email"
            defaultValue={v?.email ?? ""}
                  type="email"
                  name="email"
                  required
                  placeholder="your.email@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tutor-password">
                  Password *{" "}
                  <span className="font-normal text-muted-foreground">
                    (you&apos;ll use this to sign in)
                  </span>
                </Label>
                <Input
                  id="tutor-password"
                  type="password"
                  name="password"
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                />
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label htmlFor="tutor-phone">Phone Number *</Label>
            <Input
              id="tutor-phone"
            defaultValue={v?.phone ?? ""}
              type="tel"
              name="phone"
              required
              placeholder="10-digit number"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tutor-experience">Years of Experience *</Label>
            <Input
              id="tutor-experience"
              defaultValue={v?.experience ?? ""}
              type="number"
              name="experience"
              required
              min={0}
              placeholder="e.g., 5"
            />
          </div>
        </div>
      </div>

      {/* Education & Qualifications */}
      <div>
        <h3 className="text-xl font-bold text-foreground mb-4">
          Education &amp; Qualifications
        </h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tutor-qualification">Highest Qualification *</Label>
            <Input
              id="tutor-qualification"
            defaultValue={v?.qualification ?? ""}
              type="text"
              name="qualification"
              required
              placeholder="e.g., PhD in Physics, IIT Delhi"
            />
          </div>

          <SubjectPicker
            defaultCurricula={v?.curricula}
            defaultGrades={v?.grades}
            defaultSubjects={v?.subjects}
          />

          <div className="space-y-2">
            <Label htmlFor="tutor-specialization">Specialization</Label>
            <Input
              id="tutor-specialization"
            defaultValue={v?.specialization ?? ""}
              type="text"
              name="specialization"
              placeholder="e.g., Mechanics, Thermodynamics"
            />
          </div>
        </div>
      </div>

      {/* Teaching Preferences */}
      <div>
        <h3 className="text-xl font-bold text-foreground mb-4">
          Teaching Preferences
        </h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tutor-teachingLevel">Preferred Teaching Level</Label>
            <select
              key={`teachingLevel-${resubmitKey}`}
              id="tutor-teachingLevel"
              name="teachingLevel"
              className={SELECT}
              defaultValue={v?.teachingLevel ?? ""}
            >
              <option value="">Select level</option>
              <option value="school">School (6th-12th)</option>
              <option value="college">College/University</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tutor-hourlyRate">Hourly Rate (₹) *</Label>
            <Input
              id="tutor-hourlyRate"
              defaultValue={v?.hourlyRate ?? ""}
              type="number"
              name="hourlyRate"
              required
              min={1}
              placeholder="e.g., 500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tutor-hoursPerWeek">Hours Available per Week *</Label>
            <select
              key={`hoursPerWeek-${resubmitKey}`}
              id="tutor-hoursPerWeek"
              name="hoursPerWeek"
              required
              className={SELECT}
              defaultValue={v?.hoursPerWeek ?? ""}
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

      {/* Demo Video */}
      <div>
        <h3 className="text-xl font-bold text-foreground mb-4">Demo Video</h3>
        <div className="space-y-3">
          <Label htmlFor="tutor-demoVideoUrl">Demo Video Link (YouTube) *</Label>
          <p className="text-sm text-muted-foreground mb-3">
            Upload your 2-5 minute demo video to YouTube as Unlisted, then paste
            the link here. This is what we check before approving you, and what
            students watch when choosing a tutor.
          </p>

          <Input
            id="tutor-demoVideoUrl"
            defaultValue={v?.demoVideoUrl ?? ""}
            type="url"
            name="demoVideoUrl"
            required
            placeholder="https://youtu.be/..."
          />

          <DemoVideoGuide />

          <div className="bg-muted border border-border rounded-lg p-4">
            <p className="text-sm font-semibold text-foreground">
              What makes a good demo
            </p>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1 ml-4 list-disc">
              <li>Good lighting and clear audio</li>
              <li>Explain a concept step-by-step</li>
              <li>Use a whiteboard or screen sharing</li>
              <li>Be enthusiastic and engaging</li>
              <li>Keep it 2-5 minutes long</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Terms */}
      <div className="flex items-start">
        {/* name="consent" matters: without it this never reaches the server
            and `required` is browser-only decoration. Validated again in
            parseTutorSignUp, which is what makes its absence fail loudly. */}
        <input
          type="checkbox"
          name="consent"
          value="yes"
          required
          defaultChecked={v?.consent ?? false}
          className="mt-1 mr-2"
        />
        <span className="text-sm text-muted-foreground">
          I agree to SMB Tutorials&apos;{" "}
          <Link
            href="/terms"
            className="text-primary underline underline-offset-4"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/terms#tutor-agreement"
            className="text-primary underline underline-offset-4"
          >
            Tutor Agreement
          </Link>
          , and{" "}
          <Link
            href="/privacy"
            className="text-primary underline underline-offset-4"
          >
            Privacy Policy
          </Link>
        </span>
      </div>

      {state?.error && <FormError>{state.error}</FormError>}

      <Button type="submit" disabled={isPending} className="w-full h-12 font-bold">
        {isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            Submitting Application...
          </span>
        ) : (
          "Submit Application"
        )}
      </Button>

      <p className="text-sm text-muted-foreground text-center">
        Our team will review your application and contact you within 2-3
        business days.
      </p>
    </form>
  );
}
