import Link from "next/link";
import { SignInForm } from "./signin-form";

export default async function SignInPage({
  searchParams,
}: PageProps<"/signin">) {
  const { error, next } = await searchParams;
  const initialError =
    error === "oauth" ? "Google sign-in failed — try again." : undefined;

  return (
    <div className="min-h-screen bg-background flex">
      {/* The left panel was a hotlinked Unsplash photo under a teal gradient.
          Spec §6: no photographs of children. What replaces it is the reason a
          returning parent trusts the tab they just opened. */}
      <div className="hidden border-r border-border bg-card lg:flex lg:w-1/2">
        <div className="flex flex-col justify-center gap-8 p-16">
          <h2 className="text-balance text-4xl font-black tracking-tighter">
            Welcome back.
          </h2>
          <div className="grid gap-px border border-border bg-border">
            {[
              "See which teachers are online right now",
              "Start the lesson the moment one accepts",
              "Pay per lesson — no subscription, no minimum",
            ].map((benefit) => (
              <p key={benefit} className="bg-card p-5 text-sm text-muted-foreground">
                {benefit}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="mb-6">
            <Link
              href="/"
              className="text-primary font-medium underline-offset-4 hover:underline inline-flex items-center gap-2"
            >
              ← Back to Home
            </Link>
          </div>

          <SignInForm
            initialError={initialError}
            next={typeof next === "string" ? next : undefined}
          />
        </div>
      </div>
    </div>
  );
}
