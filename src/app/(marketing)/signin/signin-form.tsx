"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/app/auth/actions";
import { GoogleButton } from "@/components/google-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignInForm({
  initialError,
  next,
}: {
  initialError?: string;
  next?: string;
}) {
  const [state, formAction, isPending] = useActionState(signIn, null);
  const error = state?.error ?? initialError;

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg">
          <span className="text-white font-bold text-2xl">SMB</span>
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Sign In</h2>
        <p className="text-gray-600">Access your account</p>
      </div>

      <GoogleButton label="Continue with Google" />

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-white text-gray-500">
            Or sign in with email
          </span>
        </div>
      </div>

      <form action={formAction} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <div className="space-y-2">
          <Label htmlFor="signin-email">Email Address</Label>
          <Input
            id="signin-email"
            type="email"
            name="email"
            required
            placeholder="your.email@example.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="signin-password">Password</Label>
          <Input
            id="signin-password"
            type="password"
            name="password"
            required
            placeholder="Enter your password"
          />
        </div>

        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center">
            <input type="checkbox" className="mr-2" />
            <span className="text-gray-600">Remember me</span>
          </label>
          <Button type="button" variant="link" className="h-auto p-0">
            Forgot password?
          </Button>
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={isPending} className="w-full h-11">
          {isPending ? "Signing in…" : "Sign In"}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-gray-600">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="text-teal-600 hover:text-teal-700 font-semibold"
          >
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  );
}
