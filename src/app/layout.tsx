import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

// Archivo carries the identity: 900 tracked tight is the voice (spec §5.3).
// 400-600 do the ordinary work.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "900"],
});

// Mono is not decoration: it marks what is live or factual — the online count,
// step numbers, rates, timers — against Archivo's editorial voice.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "SMB Tutorials",
  description: "Find a teacher online right now for a one-to-one video lesson.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "SMB", statusBarStyle: "default" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: next-themes writes the theme class before
    // React hydrates, so server and client markup differ by design. Without
    // it React logs a hydration error on every page load.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
