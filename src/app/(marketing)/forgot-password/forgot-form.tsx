"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotForm({ expired }: { expired: boolean }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function send(formData: FormData) {
    setPending(true);
    setError(null);

    const email = String(formData.get("email") ?? "").trim();
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // Must point at the callback, not at the site root. Supabase's own
      // default lands on the Site URL, where nothing consumes the token —
      // which is exactly why this flow appeared broken before it existed.
      redirectTo: new URL("/auth/callback", location.origin).toString(),
    });

    setPending(false);
    // Deliberately not surfacing whether the address exists: "no account with
    // that email" turns this form into a way to find out who has an account.
    if (error && error.status !== 400) setError(error.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <p className="text-sm text-muted-foreground">
        If that address has an account, a reset link is on its way. The link
        works once and expires — request another if it does.
      </p>
    );
  }

  return (
    <form action={send} className="space-y-4">
      {expired && (
        <FormError>That link has expired or was already used. Request a new one.</FormError>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
