/**
 * The recording policy, stated on the page where consent is actually given.
 *
 * A guardian signed up on 2026-09-10 and reported never having seen it. They
 * were right: /signup carried it in an ASSURANCES column beside the form, and
 * the consent checkbox only linked to /privacy and /terms. Someone can tick a
 * box agreeing to a policy about video of their child without ever meeting the
 * part that matters most — and a consent record is only worth what was on
 * screen when it was written.
 *
 * One component, one sentence, three call sites. Three hand-written copies is
 * how policy text drifts, and drift HERE means a consent_events row that
 * misstates what was agreed to. src/app/recording-claims.test.ts pins each form
 * to rendering this and to not inlining its own copy.
 */
export function RecordingNotice({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-hair bg-muted/40 p-4">
      <p className="mb-1 text-sm font-semibold text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">
        Every lesson is recorded from the moment the tutor joins. Recordings are
        stored encrypted and nobody at SMB Tutorials watches one unless a report
        is filed about that session, or the law requires us to produce it. They
        are deleted after 30 days. Recording is a condition of using SMB
        Tutorials &mdash; lessons cannot be taken unrecorded.
      </p>
    </div>
  );
}
