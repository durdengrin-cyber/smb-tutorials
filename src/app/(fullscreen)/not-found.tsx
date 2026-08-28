import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="mx-auto max-w-lg text-center">
        <h1 className="text-2xl font-bold">Session not found</h1>
        <p className="mt-2 text-muted-foreground">
          That call doesn&apos;t exist, or it isn&apos;t yours to join.
        </p>
        <Button asChild className="mt-6">
          <Link href="/home">Back to your home</Link>
        </Button>
      </div>
    </div>
  );
}
