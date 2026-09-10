import { PageHeader } from "@/components/page-header";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="px-4 py-10 sm:px-8 sm:py-12">
        <div className="max-w-4xl mx-auto">
          <div className="bg-card rounded-2xl shadow-sm p-6 sm:p-12 border border-hair">
            <PageHeader
              title="Privacy Policy"
              description="Last updated: September 10, 2026"
            />

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                Who we are and how to reach us
              </h2>
              <p className="text-muted-foreground">
                SMB Tutorials connects students in grades 6&ndash;12 with
                tutors for one-to-one video lessons. If you have a question
                about this policy, or about the data we hold on your family,
                write to{" "}
                <a
                  href="mailto:support@smbtutorial.com"
                  className="text-primary font-medium underline-offset-4 hover:underline"
                >
                  support@smbtutorial.com
                </a>
                .
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                Who holds the account
              </h2>
              <p className="text-muted-foreground">
                An account on SMB Tutorials is held by a student&apos;s parent
                or legal guardian. The student is named on the account so
                their tutor knows who they are teaching; the student does not
                have a login of their own. Everywhere below, &quot;your
                account&quot; means the guardian&apos;s account, and
                &quot;you&quot; means the guardian.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                What we collect
              </h2>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  For every family
                </h3>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>
                    <strong>Guardian details:</strong> your name, email
                    address, and phone number.
                  </li>
                  <li>
                    <strong>Student details:</strong> the student&apos;s first
                    name and grade &mdash; enough for a tutor to know who
                    they&apos;re teaching, nothing more.
                  </li>
                  <li>
                    <strong>Session recordings:</strong> the video and audio of
                    every lesson, recorded from the moment the tutor joins to
                    the moment the call ends.
                  </li>
                  <li>
                    <strong>Session records:</strong> the subject, curriculum
                    board, grade and stream, when a session was requested and
                    when it actually started, how long it ran, and the hourly
                    rate charged.
                  </li>
                  <li>
                    <strong>Payment records:</strong> a reference number for
                    each payment or refund, which provider processed it, and
                    the amount paid.
                  </li>
                  <li>
                    <strong>Reports:</strong> if you file a report about a
                    session, we keep the reason you chose from a fixed list
                    and any free-text detail you add.
                  </li>
                  <li>
                    <strong>Consent records:</strong> a log of every time you
                    agreed to these policies &mdash; when, through which form,
                    and which version of the policy you agreed to.
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  For tutors, additionally
                </h3>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>
                    Qualification, years of experience, specialization, and
                    teaching level.
                  </li>
                  <li>Hourly rate, hours available per week, and a bio.</li>
                  <li>A link to a demo video.</li>
                  <li>
                    The boards, grades, streams, and subjects you teach, and
                    whether you&apos;re currently marked available.
                  </li>
                  <li>
                    Your device&apos;s push-notification endpoint, so a
                    session request can reach you, and a log of whether each
                    notification we sent was actually delivered.
                  </li>
                </ul>
              </div>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                Who processes it
              </h2>
              <p className="text-muted-foreground mb-4">
                We don&apos;t sell your data. We do use these outside
                services to run the platform, and each only sees what it
                needs to do its job:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>
                  <strong>Supabase</strong> &mdash; our database and sign-in
                  provider. Everything described above lives here.
                </li>
                <li>
                  <strong>Daily.co</strong> &mdash; powers the video call
                  itself.
                </li>
                <li>
                  <strong>Razorpay</strong> &mdash; processes payments for
                  sessions.
                </li>
                <li>
                  <strong>Google</strong> &mdash; if you choose to sign in
                  with a Google account instead of a password.
                </li>
                <li>
                  <strong>Apple and Google&apos;s push notification
                  services</strong> &mdash; deliver session-request alerts to
                  a tutor&apos;s device. Students and guardians don&apos;t use
                  this.
                </li>
                <li>
                  <strong>Sentry</strong> &mdash; error reporting, so we know
                  when something breaks.
                </li>
                <li>
                  <strong>Vercel</strong> &mdash; hosts the website.
                </li>
              </ul>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                Every session is recorded
              </h2>
              <p className="text-muted-foreground">
                A tutoring session is a live video call between the student
                and the tutor, and we record all of it. This is a condition of
                using SMB Tutorials: there is no way to take a lesson here
                unrecorded, and that is deliberate. A child is on one end of
                the call and an adult on the other, and a recording is the
                only thing that can tell us what actually happened if you ever
                need to report one.
              </p>
              <p className="text-muted-foreground mt-4">
                Recordings are stored encrypted. Nobody at SMB Tutorials
                watches one unless a report is filed about that session, or
                the law requires us to produce it &mdash; not to check on
                tutors, not to improve the product, not out of curiosity.
                Every access to a recording is logged, and the log is kept
                after the recording itself is gone.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                How long we keep things
              </h2>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>
                  <strong>Session recordings:</strong> 30 days, then deleted.
                  A recording of a session someone has reported is kept until
                  that report is resolved, however long that takes, and then
                  deleted with the rest.
                </li>
                <li>
                  <strong>Notification delivery logs</strong> (whether a
                  session alert reached a tutor&apos;s device): our policy is
                  to keep these for 90 days. We have not yet built the
                  automatic cleanup that enforces that limit, so today these
                  rows are not deleted on any schedule and are kept
                  indefinitely until it ships. We&apos;re stating that gap
                  here rather than the tidier line we&apos;ll be able to
                  write once it&apos;s closed.
                </li>
                <li>
                  <strong>Session and payment records:</strong> for as long
                  as financial record-keeping rules require us to keep them.
                </li>
                <li>
                  <strong>Consent records and reports:</strong> indefinitely.
                  They&apos;re the evidence of what was agreed to and what was
                  reported, and evidence that expires isn&apos;t evidence.
                </li>
              </ul>
              <p className="text-muted-foreground mt-4">
                These are the defaults while an account stays open. Deleting
                an account moves faster than any of the timers above for your
                own session and payment records — see &quot;Deletion,
                honestly&quot; below.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                Deletion, honestly
              </h2>
              <p className="text-muted-foreground mb-4">
                Write to{" "}
                <a
                  href="mailto:support@smbtutorial.com"
                  className="text-primary font-medium underline-offset-4 hover:underline"
                >
                  support@smbtutorial.com
                </a>{" "}
                to ask us to delete your account. Here is exactly what that
                does and doesn&apos;t do.
              </p>
              <p className="text-muted-foreground mb-4">
                <strong>What we delete:</strong> your profile, including the
                student&apos;s name and grade; your session and payment
                history; and, for a tutor account, your subject listings,
                availability, and any devices registered for notifications.
                If a deleted session also involved someone else &mdash; the
                tutor or student on the other side of it &mdash; that record
                is removed for both of you.
              </p>
              <p className="text-muted-foreground mb-4">
                <strong>What survives, on purpose:</strong>
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>
                  <strong>Reports.</strong> If a report was filed about a
                  tutoring session, we keep the tutor&apos;s name, the
                  subject, and when the session happened &mdash; even after
                  the session itself is deleted, and even after the
                  tutor&apos;s own account is deleted. Deleting the account
                  that filed the report removes only the link back to who
                  filed it; the report&apos;s content stays. A safety report
                  about someone should not disappear because that person, or
                  the person who filed it, closed their account.
                </li>
                <li>
                  <strong>Consent records.</strong> We keep a permanent record
                  that you agreed to our policies, including the email
                  address the agreement was made under, even after the
                  account itself is deleted. This is the evidence that
                  consent was given, and it has to outlive the account it
                  describes to still mean anything.
                </li>
              </ul>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                Children
              </h2>
              <p className="text-muted-foreground">
                Every student on this platform is in grades 6 through 12
                &mdash; a minor, by design. That&apos;s why the account
                belongs to a parent or legal guardian and not the student:
                the guardian is the one who agrees to this policy on the
                family&apos;s behalf. A guardian may withdraw consent at any
                time by contacting{" "}
                <a
                  href="mailto:support@smbtutorial.com"
                  className="text-primary font-medium underline-offset-4 hover:underline"
                >
                  support@smbtutorial.com
                </a>
                .
              </p>
            </section>

            <section className="bg-muted rounded-xl p-6 mt-8">
              <h3 className="text-lg font-bold text-foreground mb-2">
                Questions, or want your data deleted?
              </h3>
              <p className="text-foreground">
                <a
                  href="mailto:support@smbtutorial.com"
                  className="text-primary font-semibold underline-offset-4 hover:underline"
                >
                  support@smbtutorial.com
                </a>
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
