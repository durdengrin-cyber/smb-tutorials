"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpStudent } from "@/app/auth/actions";
import { FormError } from "@/components/form-error";
import { GoogleButton } from "@/components/google-button";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(signUpStudent, null);

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg">
          <span className="text-white font-bold text-2xl">SMB</span>
        </div>
        <PageHeader as="h1" title="Create Account" description="Start your learning journey" />
      </div>

      <GoogleButton label="Sign up with Google" />

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-white text-gray-500">
            Or sign up with email
          </span>
        </div>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="signup-fullName">Full Name</Label>
          <Input
            id="signup-fullName"
            type="text"
            name="fullName"
            required
            placeholder="John Doe"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-email">Email Address</Label>
          <Input
            id="signup-email"
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

        <div className="flex items-start">
          {/* name="consent" matters: without it this never reaches the server
              and `required` is browser-only decoration. Validated again in
              parseStudentSignUp. */}
          <input
            type="checkbox"
            name="consent"
            value="yes"
            required
            className="mt-1 mr-2"
          />
          <span className="text-sm text-gray-600">
            I am this student&apos;s parent or guardian, or I am 18 or older,
            and I agree to the{" "}
            <Link
              href="/terms"
              className="text-teal-600 hover:text-teal-700 underline"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/terms"
              className="text-teal-600 hover:text-teal-700 underline"
            >
              Privacy Policy
            </Link>
          </span>
        </div>

        {state?.error && <FormError>{state.error}</FormError>}

        <Button type="submit" disabled={isPending} className="w-full h-11">
          {isPending ? "Creating account…" : "Create Account"}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-gray-600">
          Already have an account?{" "}
          <Link
            href="/signin"
            className="text-teal-600 hover:text-teal-700 font-semibold"
          >
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
