import Link from "next/link";
import { GoogleButton } from "@/components/google-button";
import { PageHeader } from "@/components/page-header";
import { getIdentity } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canBecomeTeacher, type Role } from "@/lib/routes";
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

  // The SAME predicate the action enforces, run here so the refusal arrives
  // before fifteen fields are filled in rather than after. canBecomeTeacher
  // needs counts as well as a role: a student who has taken a lesson, or who
  // already has subjects, cannot convert, and become_teacher re-checks that in
  // SQL regardless of what this page decided.
  //
  // Counted here rather than duplicated: importing the predicate is what stops
  // the page and the action drifting into disagreeing about who may apply.
  let history: { sessionCount: number; subjectCount: number } | null = null;
  if (identity) {
    try {
      const supabase = await createClient();
      const [sessionRes, subjectRes] = await Promise.all([
        supabase
          .from("sessions")
          .select("id", { count: "exact", head: true })
          .eq("student_id", identity.userId),
        supabase
          .from("teacher_subjects")
          .select("teacher_id", { count: "exact", head: true })
          .eq("teacher_id", identity.userId),
      ]);
      // A failed Postgrest query returns { count: null, error }, which is
      // indistinguishable from a genuine zero. Unlike the action — which fails
      // CLOSED, because it is the one writing the row — this page fails OPEN
      // and shows the form: a transient error must not turn a legitimate
      // applicant away, and the action is still the boundary that refuses.
      if (!sessionRes.error && !subjectRes.error) {
        history = {
          sessionCount: sessionRes.count ?? 0,
          subjectCount: subjectRes.count ?? 0,
        };
      }
    } catch (e) {
      console.error("[TutorSignUpPage] history check failed; showing the form", e);
    }
  }

  const canConvert =
    identity === null ||
    history === null ||
    canBecomeTeacher({
      role: identity.role as Role,
      sessionCount: history.sessionCount,
      subjectCount: history.subjectCount,
    });

  // A used account and a wrong role are refused for different reasons, and a
  // parent who has booked lessons should not be told to "register with a
  // different email" as though their role were the problem.
  const usedAccount =
    signedIn && !canConvert && history !== null &&
    (history.sessionCount > 0 || history.subjectCount > 0);

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

          {signedIn && !canConvert && identity?.role !== "teacher" ? (
            // canBecomeTeacher (routes.ts) admits only "student" and
            // "teacher". An admin filling this form in would be refused by
            // become_teacher AFTER every field was typed — the same shape of
            // defect as the dead Suspend button: a surface inviting an action
            // the machinery behind it will not perform.
            <div className="mx-auto max-w-md rounded-2xl border border-hair bg-card p-8 text-center">
              <p className="font-semibold text-foreground">
                {usedAccount
                  ? "This account has already been used for lessons."
                  : "This account cannot become a tutor account."}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {usedAccount ? (
                  <>
                    Signed in as {identity?.fullName}. An account with lesson
                    history keeps that history as a student&apos;s, so it
                    can&apos;t be turned into a tutor account. Sign out and
                    register as a tutor with a different email.
                  </>
                ) : (
                  <>
                    You are signed in as {identity?.fullName} ({identity?.role}).
                    To apply as a tutor, sign out and register with a different
                    email.
                  </>
                )}
              </p>
              <div className="mt-6">
                <Link
                  href="/dashboard"
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
                >
                  Go to your dashboard
                </Link>
              </div>
            </div>
          ) : identity?.role === "teacher" ? (
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
