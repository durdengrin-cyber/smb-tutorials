import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { resolveHome } from "@/lib/routes";

// A resolver, not a page. Every sign-in path lands here and exactly one place
// decides where a role belongs. Cycle 2 replaces the student branch with the
// real student dashboard; nothing else changes.
export default async function HomePage() {
  const identity = await requireUser();
  redirect(resolveHome(identity.role));
}
