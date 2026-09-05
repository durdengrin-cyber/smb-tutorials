import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { needsConsent } from "@/lib/consent";
import { resolveHome } from "@/lib/routes";
import { ConsentForm } from "./consent-form";

export default async function ConsentPage() {
  // Safe despite the gate: requireUser exempts /consent from its own redirect.
  const identity = await requireUser();
  // requireUser() only refuses to send an ALREADY-unconsented account
  // elsewhere; it doesn't send a consented one away from here. Without this,
  // an already-agreed guardian who revisits (a stale tab, a bookmark, back
  // button after submitting) can resubmit and write a duplicate consent_event.
  if (!needsConsent(identity)) redirect(resolveHome(identity.role));
  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:px-8 sm:py-12">
      <div className="max-w-lg mx-auto bg-card rounded-2xl shadow-sm p-5 sm:p-8 border border-hair">
        <ConsentForm role={identity.role} />
      </div>
    </div>
  );
}
