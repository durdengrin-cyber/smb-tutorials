"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import "./globals.css";

// Catches a throw from the root layout itself — e.g. requireUser()'s Supabase
// read in (app)/layout.tsx — which (app)/error.tsx cannot: a segment's error
// boundary wraps that segment's page and nested layouts, never the layout.tsx
// in the same segment it sits beside. This is the only boundary above that.
// Must define its own <html>/<body>; it replaces the root layout when active.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <div className="mx-auto max-w-lg px-4 py-24 text-center">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-muted-foreground">
            The app hit an unexpected error. Your session and any payment are
            unaffected.
          </p>
          <Button className="mt-6" onClick={reset}>
            Try again
          </Button>
        </div>
      </body>
    </html>
  );
}
