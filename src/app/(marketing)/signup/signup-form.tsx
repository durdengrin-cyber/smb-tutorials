"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpStudent } from "@/app/auth/actions";
import { GRADES } from "@/lib/consent";
import { FormError } from "@/components/form-error";
import { GoogleButton } from "@/components/google-button";
import { PageHeader } from "@/components/page-header";
import { useResubmitKey } from "@/components/use-resubmit-key";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RecordingNotice } from "@/components/recording-notice";

export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(signUpStudent, null);

  // React 19 resets an uncontrolled form when its action completes. Without
  // these a rejected sign-up asked a parent to re-enter their name, their
  // child's name and grade, and their email — and re-tick guardian consent.
  // The password is deliberately not echoed and must be retyped.
  const v = state?.values;
  // <select> needs a remount to pick up a new default; see useResubmitKey.
  const resubmitKey = useResubmitKey(state);

  return (
    <div className="bg-card rounded-2xl shadow-xl p-8 border border-hair">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg">
          <span className="text-primary-foreground font-bold text-2xl">SMB</span>
        </div>
        <PageHeader as="h1" title="Create account" description="Start your learning journey" />
      </div>

      <GoogleButton label="Sign up with Google" />

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-card text-muted-foreground">
            Or sign up with email
          </span>
        </div>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="signup-fullName">Your Full Name (parent or guardian)</Label>
          <Input
            id="signup-fullName"
            defaultValue={v?.fullName ?? ""}
            type="text"
            name="fullName"
            required
            placeholder="John Doe"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-learnerFirstName">Student&apos;s First Name</Label>
          <Input
            id="signup-learnerFirstName"
            defaultValue={v?.learnerFirstName ?? ""}
            type="text"
            name="learnerFirstName"
            required
            placeholder="The name their tutor will see"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-learnerGrade">Student&apos;s Grade</Label>
          <select
            key={`learnerGrade-${resubmitKey}`}
            id="signup-learnerGrade"
            name="learnerGrade"
            required
            defaultValue={v?.learnerGrade ?? ""}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
          >
            <option value="" disabled>
              Select a grade
            </option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-email">Email Address</Label>
          <Input
            id="signup-email"
            defaultValue={v?.email ?? ""}
            type="email"
            name="email"
            required
            placeholder="your.email@example.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-password">Password</Label>
          <Input
            id="signup-password"
            type="password"
            name="password"
            required
            minLength={8}
            placeholder="Create a strong password"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-confirmPassword">Confirm Password</Label>
          <Input
            id="signup-confirmPassword"
            type="password"
            name="confirmPassword"
            required
            minLength={8}
            placeholder="Re-enter your password"
          />
        </div>

        {/* Immediately above the tick, not in the column beside the form. A
            guardian who signed up on 2026-09-10 never saw the ASSURANCES panel
            and submitted without meeting the recording policy at all. */}
        <RecordingNotice title="Every session is recorded." />

        <div className="flex items-start">
          {/* name="consent" matters: without it this never reaches the server
              and `required` is browser-only decoration. Validated again in
              parseStudentSignUp. */}
          <input
            type="checkbox"
            name="consent"
            value="yes"
            required
            defaultChecked={v?.consent ?? false}
            className="mt-1 mr-2"
          />
          <span className="text-sm text-muted-foreground">
            I am this student&apos;s parent or legal guardian, and I agree to the{" "}
            <Link href="/terms" className="text-primary underline underline-offset-4">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-primary underline underline-offset-4">
              Privacy Policy
            </Link>
          </span>
        </div>

        {state?.error && <FormError>{state.error}</FormError>}

        <Button type="submit" disabled={isPending} className="w-full h-11">
          {isPending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/signin"
            className="text-primary font-semibold underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
