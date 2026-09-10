import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { needsConsent } from "@/lib/consent";
import { resolveHome } from "@/lib/routes";
import { ConsentForm } from "./consent-form";

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Safe despite the gate: requireUser exempts /consent from its own redirect.
  const identity = await requireUser();
  // requireUser() only refuses to send an ALREADY-unconsented account
  // elsewhere; it doesn't send a consented one away from here. Without this,
  // an already-agreed guardian who revisits (a stale tab, a bookmark, back
  // button after submitting) can resubmit and write a duplicate consent_event.
  if (!needsConsent(identity)) redirect(resolveHome(identity.role));

  // A returning family already has these stored, and acceptConsent overwrites
  // them with whatever this form submits. Rendering the fields blank asked a
  // guardian to retype the child's name and grade from memory, and quietly
  // replaced the name the tutor sees with any typo. Identity does not carry
  // them, so they are read here. Not selected for a teacher or admin — they
  // have no learner and the form does not render the fields.
  let learner = { firstName: "", grade: "" };
  if (identity.role === "student") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("learner_first_name, learner_grade")
      .eq("id", identity.userId)
      .single();
    learner = {
      firstName: data?.learner_first_name ?? "",
      grade: data?.learner_grade ?? "",
    };
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:px-8 sm:py-12">
      <div className="max-w-lg mx-auto bg-card rounded-2xl shadow-sm p-5 sm:p-8 border border-hair">
        {/* A returning account is here because CONSENT_VERSION moved, and the
            form has to say what moved — agreeing to "the Privacy Policy"
            without being shown what changed in it is not agreement to the
            change. consent_events records this submission as agreement to a
            specific version; the screen must have named what that version
            says. */}
        <ConsentForm
          role={identity.role}
          returning={identity.consentVersion !== null}
          learner={learner}
          next={next}
        />
      </div>
    </div>
  );
}
