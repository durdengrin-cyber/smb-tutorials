import Link from "next/link";
import { PageHeader } from "@/components/page-header";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="px-4 py-10 sm:px-8 sm:py-12">
        <div className="max-w-4xl mx-auto">
          <div className="bg-card rounded-2xl shadow-sm p-6 sm:p-12 border border-hair">
            <PageHeader
              title="Terms & Conditions"
              description="Last updated: September 10, 2026"
            />

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                Refund policy
              </h2>
              <p className="text-muted-foreground mb-3">
                Our no-show and refund policy is as follows:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>
                  <strong>Tutor does not join:</strong> Full refund.
                </li>
                <li>
                  <strong>Tutor joins more than 10 minutes late:</strong> Full
                  refund if the student chooses to cancel.
                </li>
                <li>
                  <strong>Student does not join:</strong> No refund &mdash;
                  the tutor was present and available.
                </li>
                <li>
                  <strong>Technical failure preventing the session:</strong>{" "}
                  Full refund.
                </li>
                <li>
                  <strong>Session ended early by the tutor for conduct:</strong>{" "}
                  No refund.
                </li>
                <li>
                  <strong>Any refund</strong> is issued to the original
                  payment method within 7 business days.
                </li>
              </ul>
              <p className="text-muted-foreground mt-3">
                Contact{" "}
                <a
                  href="mailto:support@smbtutorials.com"
                  className="text-primary font-medium underline-offset-4 hover:underline"
                >
                  support@smbtutorials.com
                </a>{" "}
                with questions about a specific session.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                Tutor professional conduct &amp; penalties
              </h2>

              <p className="text-muted-foreground mb-4">
                To maintain the integrity of our marketplace, all tutors at SMB
                Tutorials are held to a high standard of professional
                accountability.
              </p>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  1. Attendance &amp; reliability
                </h3>
                <p className="text-muted-foreground mb-3">
                  Tutors are expected to be present and punctual for all
                  confirmed sessions.
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>
                    <strong>Tutor No-Show:</strong> Repeatedly failing to attend
                    confirmed sessions may result in suspension from the
                    platform. Any refund owed to the student follows the
                    refund policy above.
                  </li>
                  <li>
                    <strong>Late Arrival:</strong> Tutors arriving more than 5
                    minutes late are expected to extend the session by the
                    equivalent time.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  2. Platform circumvention
                </h3>
                <p className="text-muted-foreground mb-3">
                  Attempting to take a student &quot;off-platform&quot; to avoid
                  SMB Tutorials service fees is a critical violation.
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>
                    <strong>The Act:</strong> Sharing personal payment links,
                    phone numbers, or external booking links with intent to
                    bypass our payment system.
                  </li>
                  <li>
                    <strong>Penalty:</strong> Zero Tolerance. Permanent ban.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  3. Content &amp; quality violations
                </h3>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>
                    <strong>Misrepresentation:</strong> Tutors found to have
                    falsified credentials, certifications, or experience will be
                    permanently removed.
                  </li>
                  <li>
                    <strong>Unpreparedness:</strong> Documented proof of
                    significant unprofessionalism may result in account action.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  4. Conduct &amp; harassment
                </h3>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>
                    <strong>Prohibited Behavior:</strong> Any form of harassment,
                    hate speech, or inappropriate personal communication with a
                    student.
                  </li>
                  <li>
                    <strong>Penalty:</strong> Immediate account termination and
                    permanent block. SMB Tutorials will cooperate fully with law
                    enforcement if conduct is illegal.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  5. Live booking &amp; acceptance (&quot;Instant Connect&quot;
                  rule)
                </h3>
                <p className="text-muted-foreground mb-3">
                  Tutors who toggle their status to &quot;Live / Available
                  Now&quot; must be ready to accept bookings immediately.
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>
                    <strong>Acceptance Window:</strong> Tutors have a short,
                    fixed window to accept an instant session request. Failure
                    results in automatic &quot;Offline&quot; status.
                  </li>
                  <li>
                    <strong>&quot;Ghosting&quot;:</strong> Accepting a session and
                    then failing to join is a serious conduct violation and may
                    result in account action.
                  </li>
                </ul>
              </div>
            </section>

            <section id="tutor-agreement" className="mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                Tutor agreement
              </h2>
              <p className="text-muted-foreground mb-4">
                By creating a tutor account and accepting sessions on SMB
                Tutorials, you agree to the following as binding conditions of
                teaching on the platform.
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>
                  <strong>Identity Verification:</strong> You must provide a
                  government-issued ID, verified against the name on your
                  account, before you teach any session.
                </li>
                <li>
                  <strong>Conduct:</strong> You agree to the conduct rules set
                  out above in Tutor professional conduct &amp; penalties.
                </li>
                <li>
                  <strong>You Are Recorded Too:</strong> Every session is
                  recorded, and that includes your side of the call. The limits
                  in the Privacy Policy protect you exactly as they protect the
                  student: recordings are encrypted, deleted after 30 days, and
                  opened only where a report is filed about that session or the
                  law requires it. You may ask for a copy of a session you
                  taught. Teaching on SMB Tutorials means agreeing to this.
                </li>
                <li>
                  <strong>Reports Pending Review:</strong> A conduct report
                  filed against your account opens a review and suspends your
                  account. You will not receive or be able to accept new
                  session requests while the review is open, and any session
                  that has not yet started is cancelled and refunded to the
                  student. A session already under way may finish.
                </li>
              </ul>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                Student code of conduct &amp; safety policy
              </h2>

              <p className="text-muted-foreground mb-4">
                At SMB Tutorials, we are committed to providing a respectful,
                productive, and safe learning environment. By using our platform,
                students agree to adhere to the following standards of behavior.
              </p>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  1. Professionalism &amp; respect
                </h3>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>
                    <strong>Zero Tolerance for Harassment:</strong> Any form of
                    hate speech, discrimination (based on race, gender, religion,
                    etc.), or sexual harassment toward a tutor will result in
                    an immediate and permanent ban.
                  </li>
                  <li>
                    <strong>Appropriate Attire:</strong> Students must be dressed
                    appropriately for video sessions. Tutors have the right to
                    end a session immediately if a student is dressed
                    inappropriately, and no refund will be issued.
                  </li>
                  <li>
                    <strong>Respectful Communication:</strong> Do not use
                    profanity, aggressive language, or personal insults. Tutors
                    are here to help, not to be mistreated.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  2. Live session integrity
                </h3>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>
                    <strong>We Record Every Session:</strong> Every session is
                    recorded by SMB Tutorials, and using the platform means
                    agreeing to that. Sessions cannot be taken unrecorded.
                    What we do with a recording &mdash; who may open one, and
                    how long we keep it &mdash; is set out in the{" "}
                    <Link
                      href="/privacy"
                      className="text-primary underline underline-offset-4"
                    >
                      Privacy Policy
                    </Link>
                    , and those limits bind us.
                  </li>
                  <li>
                    <strong>You May Not Make Your Own Recording:</strong> Our
                    recording is not permission for yours. You may not record,
                    screen-capture, or distribute any portion of a live
                    tutoring session without explicit written permission of the
                    tutor and the platform.
                  </li>
                  <li>
                    <strong>Environment:</strong> Students should join sessions
                    from a quiet, stationary environment. Joining while driving
                    or in disruptive settings is grounds for the tutor to
                    terminate the call.
                  </li>
                  <li>
                    <strong>Off-Platform Requests:</strong> Do not ask tutors for
                    personal phone numbers, home addresses, or private social
                    media profiles.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  3. Academic integrity
                </h3>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>
                    <strong>No &quot;Do My Homework&quot;:</strong> Tutors are
                    mentors, not ghostwriters. You may not ask a tutor to
                    complete an exam, write a graded essay for you, or perform
                    any task that violates the academic integrity policy of your
                    school or institution.
                  </li>
                  <li>
                    <strong>Fair Use:</strong> Do not use the &quot;Instant
                    Connect&quot; feature to spam multiple tutors with the same
                    question in hopes of getting free answers during the trial
                    window.
                  </li>
                </ul>
              </div>
            </section>

            <section className="bg-muted rounded-xl p-6 mt-8">
              <h3 className="text-lg font-bold text-foreground mb-2">
                Questions about our policies?
              </h3>
              <p className="text-muted-foreground mb-3">
                If you have any questions about these terms and conditions,
                please contact us at:
              </p>
              <p className="text-foreground">
                <a
                  href="mailto:support@smbtutorials.com"
                  className="text-primary font-semibold underline-offset-4 hover:underline"
                >
                  support@smbtutorials.com
                </a>
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
