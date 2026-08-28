import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { NAV } from "@/lib/nav";
import type { Identity } from "@/lib/auth";
import { Button } from "@/components/ui/button";

// Responsive by construction: a top bar everywhere, plus a bottom tab bar on
// small screens. The product is built for whatever device someone has, not for
// a device we assumed (spec §6).
export function AppShell({
  identity,
  children,
}: {
  identity: Identity;
  children: React.ReactNode;
}) {
  const items = NAV[identity.role];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <Link href="/home" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <span className="text-xs font-bold text-primary-foreground">SMB</span>
            </div>
            <span className="hidden font-bold sm:inline">SMB Tutorials</span>
          </Link>

          <nav className="hidden gap-1 sm:flex">
            {items.map((item) => (
              <Button key={item.href} asChild variant="ghost">
                <Link href={item.href}>{item.label}</Link>
              </Button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {identity.fullName}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-20 sm:pb-0">{children}</main>

      {/* Bottom tab bar: small screens only. */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t bg-background sm:hidden">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex-1 py-3 text-center text-sm font-medium"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
