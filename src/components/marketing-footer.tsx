import Link from "next/link";

// The site had no footer at all before this — the only links to /terms and
// /privacy lived inside the two signup forms, so a visitor who had not started
// signing up could not reach either. On a product handling children's data,
// the privacy policy should be reachable from every public page.
//
// The dedication (spec §2) was to live here, one line, out of the hero and out
// of the signup flow. It is deliberately NOT rendered for now — pulled by the
// owner on 2026-09-05. Do not restore it from the spec: the copy is theirs to
// write, and what stood here was our placeholder, not their words.
export function MarketingFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-card">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8">
        {/* THE DEDICATION GOES HERE when the owner supplies the copy. One or two
            sentences; the longer version belongs on /about. Nothing renders
            until then — and when it does, the link row below gets its
            `border-t border-hair pt-6` back, which only made sense as a rule
            BETWEEN the dedication and the links. With nothing above it, it read
            as a stray second rule under the footer's own top border. */}

        <div className="flex flex-wrap items-center gap-x-7 gap-y-3 text-sm text-muted-foreground">
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
          <a href="mailto:support@smbtutorials.com" className="hover:text-primary">
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}
