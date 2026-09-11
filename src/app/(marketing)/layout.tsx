import { unstable_rethrow } from "next/navigation";
import { getIdentity } from "@/lib/auth";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // getIdentity throws on a genuine query error so the authenticated tree can
  // surface a failure rather than silently signing someone out. These pages are
  // public, and the only thing identity decides here is whether the header says
  // "Sign in" or "Go to your dashboard" — so a transient Supabase failure must
  // degrade to the signed-out header, not take the whole marketing surface down.
  //
  // It has to be caught HERE: an error.tsx does not wrap the layout.js of its
  // own segment, so a throw from this file would bubble past (marketing)/error.tsx
  // to global-error.tsx and replace /, /signin, /signup and /terms at once.
  //
  // unstable_rethrow FIRST, before the log. getIdentity reads cookies, and at
  // build time Next probes these routes for static generation — cookies()
  // raises DynamicServerError, which is control flow, not a failure. Next's
  // own docs say the error cookies() throws "should not be caught by the
  // developer". Swallowing it printed "identity lookup failed" nine times in
  // a clean build, and a warning that cries wolf every time is how the real
  // Supabase outage this line exists to surface gets scrolled past. The catch
  // below is for genuine query failures only.
  let signedIn = false;
  try {
    signedIn = (await getIdentity()) !== null;
  } catch (e) {
    unstable_rethrow(e);
    console.error("[MarketingLayout] identity lookup failed; rendering signed-out", e);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader signedIn={signedIn} />
      <div className="flex-1">{children}</div>
      <MarketingFooter />
    </div>
  );
}
