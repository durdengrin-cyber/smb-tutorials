"use client";

import Link from "next/link";
import { useActionState } from "react";
import { acceptConsent } from "./actions";
import { FormError } from "@/components/form-error";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GRADES } from "@/lib/consent";
import type { Role } from "@/lib/routes";

export function ConsentForm({
  role,
  returning = false,
}: {
  role: Role;
  returning?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(acceptConsent, null);

  return (
    <>
      <PageHeader
        as="h1"
        title={returning ? "Our policies have changed" : "One more thing"}
        description={
          // Teachers and admins reach this screen too — on a version bump,
          // all three roles do — and telling a tutor we need their parent's
          // agreement is nonsense.
          role === "student"
            ? "We need a parent or guardian's agreement before lessons can start."
            : "We need your agreement to these policies before you can continue."
        }
      />

      {returning && (
        // The substance of 2026-09-10-recording, on the screen that records
        // agreement to it. A guardian pointing at this page later must find
        // the thing they are said to have agreed to.
        <div className="mt-6 rounded-lg border border-hair bg-muted/40 p-4">
          <p className="text-sm font-semibold text-foreground mb-1">
            What changed: we now record every session.
          </p>
          <p className="text-sm text-muted-foreground">
            Every lesson is recorded from the moment the tutor joins. Recordings
            are stored encrypted and nobody at SMB Tutorials watches one unless
            a report is filed about that session, or the law requires us to
            produce it. They are deleted after 30 days. Recording is a condition
            of using SMB Tutorials &mdash; lessons cannot be taken unrecorded.
          </p>
        </div>
      )}

      <form action={formAction} className="space-y-4 mt-6">
        {role === "student" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="consent-learnerFirstName">Student&apos;s First Name</Label>
              <Input
                id="consent-learnerFirstName"
                type="text"
                name="learnerFirstName"
                required
                placeholder="The name their tutor will see"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="consent-learnerGrade">Student&apos;s Grade</Label>
              <select
                id="consent-learnerGrade"
                name="learnerGrade"
                required
                defaultValue=""
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
          </>
        )}

        <div className="flex items-start">
          {/* name="consent" matters: without it this never reaches the server
              and `required` is browser-only decoration. Validated again in
              acceptConsent. */}
          <input type="checkbox" name="consent" value="yes" required className="mt-1 mr-2" />
          <span className="text-sm text-muted-foreground">
            {role === "student"
              ? "I am this student's parent or legal guardian, and I agree to the "
              : "I agree to the "}
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

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Saving…" : "Agree and continue"}
        </Button>
      </form>
    </>
  );
}
