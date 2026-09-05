"use client";

import { ThemeProvider as NextThemes } from "next-themes";

// attribute="class" because globals.css keys dark off `.dark`
// (@custom-variant dark (&:is(.dark *))), which is shadcn's convention.
//
// defaultTheme="system": the device already knows the person's preference —
// usually because they set it by time of day themselves. Spec §5.1 rejects
// switching on time of day in the app; a page changing under someone mid-read
// guesses wrong constantly (a parent in a bright kitchen at 9pm wants light).
//
// next-themes has been a dependency since cycle 1 and sonner.tsx already calls
// useTheme(), but no provider was ever mounted, so all of it sat inert.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemes>
  );
}
