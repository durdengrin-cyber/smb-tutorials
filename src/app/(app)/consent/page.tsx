import { requireUser } from "@/lib/auth";
import { ConsentForm } from "./consent-form";

export default async function ConsentPage() {
  // Safe despite the gate: requireUser exempts /consent from its own redirect.
  const identity = await requireUser();
  return (
    <div className="min-h-screen bg-gray-50 px-8 py-12">
      <div className="max-w-lg mx-auto bg-white rounded-2xl shadow-sm p-8 border border-gray-100">
        <ConsentForm role={identity.role} />
      </div>
    </div>
  );
}
