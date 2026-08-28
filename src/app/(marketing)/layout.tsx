import { getIdentity } from "@/lib/auth";
import { MarketingHeader } from "@/components/marketing-header";

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
  let signedIn = false;
  try {
    signedIn = (await getIdentity()) !== null;
  } catch (e) {
    console.error("[MarketingLayout] identity lookup failed; rendering signed-out", e);
  }

  return (
    <>
      <MarketingHeader signedIn={signedIn} />
      {children}
    </>
  );
}
