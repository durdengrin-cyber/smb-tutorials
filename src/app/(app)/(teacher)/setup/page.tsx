import { requireRole } from "@/lib/auth";
import { NotificationSetup } from "@/components/notification-setup";

export default async function SetupPage() {
  await requireRole("teacher");
  return <NotificationSetup variant="full" audience="teacher" />;
}
