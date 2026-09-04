import { requireUser } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";

// No shell, on the same principle (fullscreen) uses for the call screen:
// "protected because of where it lives" (route-groups.test.ts) means the
// layout is what decides both the auth gate AND the chrome, so a route
// placed here gets neither the app shell nor a reason to second-guess which
// page it's rendering.
//
// The one thing this route needs that (fullscreen) doesn't: a way out. An
// agreement nobody can refuse isn't consent — a guardian who will not agree
// must be able to leave, not just close the tab, so sign-out survives here
// on its own, deliberately, with nothing else next to it.
export default async function GateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return (
    <div className="min-h-screen">
      <div className="flex justify-end px-4 pt-4 sm:px-8">
        <SignOutButton />
      </div>
      {children}
    </div>
  );
}
