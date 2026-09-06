import Link from "next/link";
import { Button } from "@/components/ui/button";

// Back to /consent, NOT to /home like (app)/not-found.tsx does. Everyone who
// can reach this group is signed in and has not agreed yet, so requireUser()
// would bounce them straight back here — an offer that looks like a way out
// and is a redirect loop.
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-muted-foreground">
        That page doesn&apos;t exist. You can finish setting up your account, or
        sign out above.
      </p>
      <Button asChild className="mt-6">
        <Link href="/consent">Back to the agreement</Link>
      </Button>
    </div>
  );
}
