import Link from "next/link";

// The site had no footer at all before this — the only links to /terms and
// /privacy lived inside the two signup forms, so a visitor who had not started
// signing up could not reach either. On a product handling children's data,
// the privacy policy should be reachable from every public page.
//
// It is also where the dedication lives (spec §2): present and findable, but
// out of the hero and out of the signup flow, because a parent's first need is
// "my child is stuck and someone can help" — not why the product exists.
export function MarketingFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-card">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8">
        {/* THE DEDICATION — placeholder. The owner's copy replaces this whole
            paragraph. Spec §2: worded around the value Syedna Mohammed
            Burhanuddin championed, that every child should be given the means
            to learn, never around religious authority — which would read as a
            membership marker the moment the audience widens beyond the
            community. Keep it to one or two sentences here; the longer version
            belongs on /about. */}
        <p className="mb-9 max-w-[60ch] border-l-2 border-primary pl-4 text-sm leading-relaxed text-muted-foreground">
          <span className="text-foreground">
            SMB is named in memory of Syedna Mohammed Burhanuddin
          </span>
          , who held that every child should be given the means to learn.
        </p>

        <div className="flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-hair pt-6 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} SMB Tutorials</span>
          <Link href="/about" className="hover:text-primary">
            About
          </Link>
          <Link href="/privacy" className="hover:text-primary">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-primary">
            Terms
          </Link>
          <a href="mailto:support@smbtutorial.com" className="hover:text-primary">
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}
