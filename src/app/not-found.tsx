import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getIdentity } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";

/**
 * The 404 for a URL that matches no route group at all.
 *
 * Four not-found.tsx files already existed — (marketing), (app), (gate),
 * (fullscreen) — and each is correct for its own segment. None of them catches
 * a path outside every group, which fell through to Next's built-in default:
 * "404 | This page could not be found" on black, with no header, no footer, no
 * link back, and not even this product's theme.
 *
 * Unlike its four siblings this page brings its own chrome. They render inside
 * a route-group layout that already supplies a header, a footer and a way out;
 * this one renders inside RootLayout, which supplies a <body> and nothing else.
 * Without the header and footer it is a single sentence on an empty ground,
 * which reads as a broken deployment rather than a handled error.
 */
export default async function NotFound() {
  // Lifted from (marketing)/layout.tsx along with its reasoning: identity
  // decides only whether the header offers "Sign in" or "Go to your
  // dashboard". A transient Supabase failure must degrade to the signed-out
  // header — replacing a handled 404 with an unhandled 500 would be a strictly
  // worse answer to the same mistyped URL.
  //
  // unstable_rethrow FIRST, before the log. Next renders this file as part of
  // the build-time probe for EVERY route — it is the fallback for notFound()
  // anywhere in the tree — so cookies() throws DynamicServerError once per
  // route. That is control flow, not a failure: Next's own docs say the error
  // cookies() raises "should not be caught by the developer". Swallowing it
  // printed "identity lookup failed" nineteen times in a clean build, which
  // is exactly how the real Supabase outage this line exists to surface would
  // get scrolled past. Rethrowing lets Next mark the route dynamic and leaves
  // the catch for genuine query failures only.
  let signedIn = false;
  try {
    signedIn = (await getIdentity()) !== null;
  } catch (e) {
    unstable_rethrow(e);
    console.error("[NotFound] identity lookup failed; rendering signed-out", e);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader signedIn={signedIn} />
      <div className="flex-1">
        <div className="mx-auto max-w-lg px-4 py-24 text-center">
          <h1 className="text-2xl font-bold">Page not found</h1>
          <p className="mt-2 text-muted-foreground">
            That link doesn&apos;t lead anywhere. It may have been mistyped, or
            the page may have moved.
          </p>
          {/* One exit, and deliberately the only route that works for everyone.
              /find, /home and /sessions all require a session, so offering one
              to a signed-out visitor would bounce them to /signin — turning the
              way out into a second dead end. (gate)/not-found.tsx carries the
              same warning about /home. Whoever is signed in already has their
              dashboard in the header above. */}
          <Button asChild className="mt-6">
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
