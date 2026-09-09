import Link from "next/link";
import { GoogleButton } from "@/components/google-button";
import { PageHeader } from "@/components/page-header";
import { getIdentity } from "@/lib/auth";
import { TutorForm } from "./tutor-form";

export default async function TutorSignUpPage() {
  // This page contradicted itself while signed in: the header said "Go to your
  // dashboard" and the page beneath it offered "Sign up with Google" and asked
  // for an email and a password that signUpTutor never reads on that path.
  //
  // Degrades to the signed-out view on a lookup failure, matching the
  // (marketing) layout: these pages are public, and a transient Supabase error
  // must not take the tutor application down. The server action re-resolves
  // identity itself, so the worst case is a form that asks for credentials it
  // then ignores — never a wrong account being written.
  let identity = null;
  try {
    identity = await getIdentity();
  } catch (e) {
    console.error("[TutorSignUpPage] identity lookup failed; rendering signed-out", e);
  }

  const signedIn = identity !== null;

  return (
    <div className="min-h-screen bg-background">
      <main className="px-8 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <PageHeader
              title="Join as a Tutor"
              description="Start teaching and making a difference today"
            />
          </div>

          {identity?.role === "teacher" ? (
            // Already a tutor. Letting them submit this form would fail at
            // become_teacher anyway — after they had filled in every field.
            <div className="mx-auto max-w-md rounded-2xl border border-hair bg-card p-8 text-center">
              <p className="font-semibold text-foreground">
                You are already registered as a tutor.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Signed in as {identity.fullName}. Change your rate, subjects or
                demo video from your profile.
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Link
                  href="/profile"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  Edit your profile
                </Link>
                <Link
                  href="/dashboard"
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
                >
                  Go to your dashboard
                </Link>
              </div>
            </div>
          ) : (
            <>
              {signedIn ? (
                <div className="mx-auto mb-8 max-w-md rounded-lg border border-border bg-muted p-4 text-center">
                  <p className="text-sm text-foreground">
                    Signed in as{" "}
                    <span className="font-semibold">{identity?.fullName}</span>.
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Completing this form converts that account into a tutor
                    account — you will keep the same sign-in.
                  </p>
                </div>
              ) : (
                <div className="max-w-md mx-auto mb-8">
                  <GoogleButton label="Sign up with Google" next="/tutor-signup" />
                </div>
              )}

              <TutorForm signedIn={signedIn} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
