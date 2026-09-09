import { redirect } from "next/navigation";
import { getIdentity } from "@/lib/auth";
import { ResetForm } from "./reset-form";

export default async function ResetPasswordPage() {
  // Reaching here without a session means the link was never clicked, or it
  // expired before the callback could verify it. Send them back to ask for
  // another rather than showing a form that cannot save.
  const identity = await getIdentity().catch(() => null);
  if (!identity) redirect("/forgot-password?error=expired");

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-6 py-16">
      <h1 className="mb-2 text-2xl font-black tracking-tight">Set a new password</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        At least 8 characters. You&rsquo;ll be signed in once it&rsquo;s saved.
      </p>
      <ResetForm />
    </div>
  );
}
