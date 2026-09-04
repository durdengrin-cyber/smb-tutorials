import { requireUser } from "@/lib/auth";
import { needsConsent } from "@/lib/consent";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await requireUser();
  // requireUser() redirects anyone who still needs consent to /consent, and
  // exempts only that one path from the redirect. So reaching here with
  // needsConsent(identity) still true means this render IS /consent. The
  // consent screen is a gate, not a step in the app: no nav, no sign-out
  // button, no way to wander off into the product before agreeing.
  if (needsConsent(identity)) return <>{children}</>;
  return <AppShell identity={identity}>{children}</AppShell>;
}
