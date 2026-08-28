import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-muted-foreground">
        That page doesn&apos;t exist, or it isn&apos;t yours to see.
      </p>
      <Button asChild className="mt-6">
        <Link href="/home">Back to your home</Link>
      </Button>
    </div>
  );
}
