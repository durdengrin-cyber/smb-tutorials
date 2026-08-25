import Link from "next/link";
import type { ReactNode } from "react";

// Plain component on purpose: no "use client", not async, no server-only
// imports, so Server and Client pages can both render it.
export function SiteHeader({ action }: { action?: ReactNode }) {
  return (
    <header className="bg-white shadow-sm sticky top-0 z-50 border-b border-gray-100">
      <div className="px-8 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-lg flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-lg">SMB</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">SMB Tutorials</h1>
              <p className="text-xs text-teal-600 font-medium">
                One Student, One Teacher
              </p>
            </div>
          </Link>
          {action}
        </div>
      </div>
    </header>
  );
}
