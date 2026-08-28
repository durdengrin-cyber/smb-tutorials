import { requireUser } from "@/lib/auth";

// No shell on purpose: the video call takes the whole viewport and navigation
// during a lesson is noise. Spec §3.
export default async function FullscreenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return <>{children}</>;
}
