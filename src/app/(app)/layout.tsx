import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await requireUser();
  return <AppShell identity={identity}>{children}</AppShell>;
}
