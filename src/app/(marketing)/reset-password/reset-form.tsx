"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseNewPassword } from "@/lib/validation";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setError(null);

    // Checked here AND by Supabase. This one exists to give the same message
    // signup gives, rather than a provider error string.
    const parsed = parseNewPassword(formData);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setPending(true);
    const supabase = createClient();
    // The recovery link already established a session in the callback, so this
    // updates the signed-in user — which is why this page is worthless to
    // anyone who did not click a link from that mailbox.
    const { error } = await supabase.auth.updateUser({ password: parsed.value.password });
    setPending(false);

    if (error) {
      setError(error.message);
      return;
    }
    router.push("/home");
  }

  return (
    <form action={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password" name="password" type="password"
          required minLength={8} autoComplete="new-password"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword" name="confirmPassword" type="password"
          required minLength={8} autoComplete="new-password"
        />
      </div>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
