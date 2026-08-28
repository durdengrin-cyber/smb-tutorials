import Link from "next/link";
import { Button } from "@/components/ui/button";

export function MarketingHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <span className="text-sm font-bold text-primary-foreground">SMB</span>
          </div>
          <div>
            <span className="block font-bold leading-tight">SMB Tutorials</span>
            <span className="block text-xs font-medium text-primary">
              One Student, One Teacher
            </span>
          </div>
        </Link>
        <Button asChild>
          <Link href={signedIn ? "/home" : "/signin"}>
            {signedIn ? "Go to your dashboard" : "Sign in"}
          </Link>
        </Button>
      </div>
    </header>
  );
}
