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

export function ConsentForm({ role }: { role: Role }) {
  const [state, formAction, isPending] = useActionState(acceptConsent, null);

  return (
    <>
      <PageHeader
        as="h1"
        title="One more thing"
        description="We need a parent or guardian's agreement before lessons can start."
      />

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
          <span className="text-sm text-gray-600">
            {role === "student"
              ? "I am this student's parent or legal guardian, and I agree to the "
              : "I agree to the "}
            <Link href="/terms" className="text-teal-600 hover:text-teal-700 underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-teal-600 hover:text-teal-700 underline">
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
