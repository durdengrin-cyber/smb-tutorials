import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader
        action={
          <Link
            href="/"
            className="text-teal-600 hover:text-teal-700 font-medium"
          >
            ← Back
          </Link>
        }
      />

      <main className="px-8 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-sm p-12 border border-gray-100">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Terms &amp; Conditions
            </h1>
            <p className="text-gray-600 mb-8">Last updated: February 7, 2026</p>

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Refund Policy
              </h2>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  How to Request a Refund
                </h3>
                <p className="text-gray-700 mb-3">
                  To initiate a refund, please email{" "}
                  <a
                    href="mailto:support@smbtutorial.com"
                    className="text-teal-600 hover:text-teal-700 font-medium"
                  >
                    support@smbtutorial.com
                  </a>{" "}
                  with your:
                </p>
                <ol className="list-decimal list-inside space-y-2 text-gray-700 ml-4">
                  <li>Full Name</li>
                  <li>Order Number</li>
                  <li>
                    Reason for the refund (this helps us improve our content!)
                  </li>
                </ol>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  Eligibility for Refunds
                </h3>
                <p className="text-gray-700 mb-3">
                  We offer a 14-day money-back guarantee for most courses,
                  subject to the following &quot;Fair Use&quot; conditions:
                </p>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>Consumption Limit:</strong> A refund request will
                    only be honored if you have viewed or accessed less than 25%
                    of the course content.
                  </li>
                  <li>
                    <strong>Resource Access:</strong> If you have already
                    downloaded supplemental materials (e.g., PDFs, proprietary
                    code, or worksheets), the course is no longer eligible for a
                    refund.
                  </li>
                  <li>
                    <strong>Timeframe:</strong> Requests must be submitted via
                    our support portal within exactly 14 days of the purchase
                    timestamp.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  The 24-Hour Rule
                </h3>
                <p className="text-gray-700 mb-3">
                  Because our tutors reserve specific time slots for students,
                  cancellations impact their schedule and livelihood.
                </p>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>Cancellations &gt; 24 Hours:</strong> If a student
                    cancels a session more than 24 hours in advance, they are
                    entitled to a full refund or a free reschedule.
                  </li>
                  <li>
                    <strong>Late Cancellations (&lt; 24 Hours):</strong>{" "}
                    Cancellations made within 24 hours of the session start time
                    are non-refundable. The tutor will be paid for their reserved
                    time.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  No-Show Policy
                </h3>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>Student No-Show:</strong> If a student does not show
                    up within the first 15 minutes of a scheduled session, the
                    session is considered &quot;Completed.&quot; No refund will
                    be issued, and the tutor is free to leave the call.
                  </li>
                  <li>
                    <strong>Tutor No-Show:</strong> If a tutor fails to show up,
                    the student is entitled to a 100% refund or a credit for a
                    future session, and the tutor may be subject to platform
                    penalties.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  Satisfaction Guarantee (The &quot;First 15 Minutes&quot;)
                </h3>
                <p className="text-gray-700 mb-3">
                  We want to ensure a good match between student and tutor.
                </p>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    If a student feels the tutor is not a good fit within the
                    first 15 minutes of their first-ever session, they may leave
                    the call and request a full refund or a switch to a different
                    tutor.
                  </li>
                  <li>
                    This &quot;Trial Protection&quot; only applies to the first
                    session with a specific tutor to prevent users from consuming
                    full lessons for free.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  Technical Difficulties
                </h3>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>Platform Issues:</strong> If the session cannot be
                    completed due to a failure of smbtutorial.com tools, a full
                    refund or reschedule will be provided.
                  </li>
                  <li>
                    <strong>User Issues:</strong> Refunds are generally not
                    granted for individual internet connectivity issues or
                    hardware problems on the student&apos;s end. We recommend
                    testing your setup 10 minutes before the call.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  Package &amp; Bundle Refunds
                </h3>
                <p className="text-gray-700 mb-3">
                  If a student purchases a bundle of hours (e.g., a 10-hour
                  package):
                </p>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>Unused Hours:</strong> Refundable within 30 days of
                    purchase, minus a 10% administrative processing fee.
                  </li>
                  <li>
                    <strong>Used Hours:</strong> Once a session is completed,
                    those hours are non-refundable.
                  </li>
                </ul>
              </div>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Tutor Professional Conduct &amp; Penalties
              </h2>

              <p className="text-gray-700 mb-4">
                To maintain the integrity of our marketplace, all tutors at SMB
                Tutorial are held to a high standard of professional
                accountability.
              </p>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  1. Attendance &amp; Reliability
                </h3>
                <p className="text-gray-700 mb-3">
                  Tutors are expected to be present and punctual for all
                  confirmed sessions.
                </p>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>Tutor No-Show:</strong>
                    <ul className="list-disc list-inside ml-6 mt-1">
                      <li>
                        First Offense: Full refund to the student + a warning
                        flag on the tutor&apos;s profile
                      </li>
                      <li>
                        Second Offense: Penalty fee deducted from tutor&apos;s
                        balance
                      </li>
                      <li>Third Offense: Immediate suspension from the platform</li>
                    </ul>
                  </li>
                  <li>
                    <strong>Late Arrival:</strong> Tutors arriving more than 5
                    minutes late must extend the session by the equivalent time
                    or offer a partial refund for the missed duration.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  2. Platform Circumvention
                </h3>
                <p className="text-gray-700 mb-3">
                  Attempting to take a student &quot;off-platform&quot; to avoid
                  SMB Tutorial service fees is a critical violation.
                </p>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>The Act:</strong> Sharing personal payment links,
                    phone numbers, or external booking links with intent to
                    bypass our payment system.
                  </li>
                  <li>
                    <strong>Penalty:</strong> Zero Tolerance. Permanent ban and
                    forfeiture of any pending/unpaid earnings.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  3. Content &amp; Quality Violations
                </h3>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>Misrepresentation:</strong> Tutors found to have
                    falsified credentials, certifications, or experience will be
                    permanently removed.
                  </li>
                  <li>
                    <strong>Unpreparedness:</strong> If a student provides
                    documented proof of significant unprofessionalism:
                    <ul className="list-disc list-inside ml-6 mt-1">
                      <li>
                        Penalty: Mandatory refund to student and a &quot;Low
                        Quality&quot; strike
                      </li>
                      <li>
                        Three strikes result in reduced visibility in search
                        results
                      </li>
                    </ul>
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  4. Conduct &amp; Harassment
                </h3>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>Prohibited Behavior:</strong> Any form of harassment,
                    hate speech, or inappropriate personal communication with a
                    student.
                  </li>
                  <li>
                    <strong>Penalty:</strong> Immediate account termination and
                    permanent block. SMB Tutorial will cooperate fully with law
                    enforcement if conduct is illegal.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  5. Live Booking &amp; Acceptance (&quot;Instant Connect&quot;
                  Rule)
                </h3>
                <p className="text-gray-700 mb-3">
                  Tutors who toggle their status to &quot;Live / Available
                  Now&quot; must be ready to accept bookings immediately.
                </p>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>Acceptance Window:</strong> Tutors have a short,
                    fixed window to accept an instant session request. Failure
                    results in automatic &quot;Offline&quot; status.
                  </li>
                  <li>
                    <strong>Acceptance Rate Tracking:</strong> We track
                    acceptance rates. Consistently declining requests while
                    marked &quot;Live&quot; may result in reduced visibility.
                  </li>
                  <li>
                    <strong>&quot;Ghosting&quot; Penalties:</strong> Accepting a
                    booking then failing to enter the classroom may incur a
                    penalty fee, and the student receives a credit at the
                    platform&apos;s expense.
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  6. Probationary Period for New Tutors
                </h3>
                <p className="text-gray-700 mb-3">
                  All new tutors enter a Probationary Status for their first 5
                  completed sessions:
                </p>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>Payment Holding:</strong> Payouts for first 5
                    sessions held for 14 days (instead of standard 7) to ensure
                    no disputes.
                  </li>
                  <li>
                    <strong>Visibility:</strong> Probationary tutors appear with
                    a &quot;New Tutor&quot; badge.
                  </li>
                  <li>
                    <strong>Mandatory Review:</strong> After the 5th session,
                    tutors are reviewed for full status or account
                    deactivation.
                  </li>
                </ul>
              </div>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Student Code of Conduct &amp; Safety Policy
              </h2>

              <p className="text-gray-700 mb-4">
                At SMB Tutorial, we are committed to providing a respectful,
                productive, and safe learning environment. By using our platform,
                students agree to adhere to the following standards of behavior.
              </p>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  1. Professionalism &amp; Respect
                </h3>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>Zero Tolerance for Harassment:</strong> Any form of
                    hate speech, discrimination (based on race, gender, religion,
                    etc.), or sexual harassment toward a tutor will result in
                    immediate and permanent ban without refund for remaining
                    credits.
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
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  2. Live Session Integrity
                </h3>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                  <li>
                    <strong>No Recording Without Consent:</strong> You may not
                    record, screen-capture, or distribute any portion of a live
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
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  3. Academic Integrity
                </h3>
                <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
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

            <section className="bg-teal-50 rounded-xl p-6 mt-8">
              <h3 className="text-lg font-bold text-gray-900 mb-2">
                Questions About Our Policies?
              </h3>
              <p className="text-gray-700 mb-3">
                If you have any questions about these terms and conditions,
                please contact us at:
              </p>
              <p className="text-gray-900">
                <a
                  href="mailto:support@smbtutorial.com"
                  className="text-teal-600 hover:text-teal-700 font-semibold"
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
