# Child Safety, Consent and Privacy — Design

**Approved in conversation 2026-09-04.** This is the pilot blocker that has been open since M3
and that code alone could not close, because it needed decisions rather than commits.

Not part of the four-cycle redesign decomposition. It cuts across all of it: it changes signup,
it changes what a teacher sees, it decides what admin (piece 3) must do, and it settles whether
sessions are ever recorded.

---

## 1. Why this exists

Three things are true at once today, and together they are not defensible in front of a parent.

1. **The consent we collect is a self-attested tick.** `parseStudentSignUp`
   (`src/lib/validation.ts:93`) requires a `consent` field and `0014` records
   `consent_accepted_at` / `consent_version`. That is a real improvement over the decorative
   checkbox it replaced — but the tick happens in whatever browser is holding the account, and
   nothing establishes that an adult was ever present.

2. **There is no privacy policy.** No `/privacy` route exists. `signup-form.tsx:107` tells the
   user they agree to the "Privacy Policy" and links to `/terms`, which contains no
   data-collection, third-party, retention, or deletion content of any kind. `0014` made this
   worse rather than better: consent is now recorded in the database, so we store versioned,
   legally meaningful agreement to a document that does not exist.

3. **Nothing records who the responsible adult is.** `session_reports` (`0016`, `0017`) collects
   a `conduct` report and routes it to a Sentry alert. When one arrives, the only contact on file
   is the account holder — who may be the child who filed it.

Fixed on 2026-09-04, before this spec, because it needed no decision: the tutor signup checkbox
carried `required` and no `name`, so tutor consent never left the browser and `parseTutorSignUp`
never asked for it. Every teacher on the platform had `consent_accepted_at` NULL. Both routes
into a teacher account now require and record consent (`src/lib/validation.ts:112`,
`tutor-signup/actions.ts`). It was the same defect `0014` closed for students, missed on the
other form — which is the argument for making consent a mechanism with one implementation
rather than a rule each form remembers separately.

## 2. The fact that settles the account model

**Every student on this platform is a minor, by construction.**

```
sessions.grade         check (grade in ('6th','7th','8th','9th','10th','11th','12th'))  -- 0002:8
teacher_subjects.grade check (grade in ('6th',…,'12th'))                                -- 0001:25
```

A 12th grader is 17. There is no path in the product to book a lesson for an adult learner, and
no date-of-birth or age column anywhere in `profiles`.

Two consequences follow directly, and they are the reason the rest of this document is short:

- **The "or I am 18 or older" clause in the signup consent is close to vacuous.** It reads as a
  choice and functions as an escape hatch from the only requirement that applies.
- **Any design that branches on "is the user an adult student or a child?" serves an empty set.**
  It would mean two account shapes, two consent texts, two validation paths and two cases in
  admin, permanently, for a population that cannot exist while `grade` is constrained as above.

## 3. Scope

**In:** the account model; what counts as proof an adult consented; where that proof is stored;
`/privacy`; the contradictions in `/terms`, **including the unpublished refund policy**; the
Google sign-in path that records no consent at all; teacher vetting; session recording; and the
escalation path a report triggers.

**Out, deliberately:**
- **Admin UI.** This spec says what admin must be able to do (§12); building it is piece 3.
- **Anything that widens `grade`.** If an adult-learner tier is ever wanted, it is a new
  decision and it reopens §2. It is not smuggled in here.
- **Age verification of the child.** We record the grade the guardian states. Verifying a
  child's age is not achievable and not required — the guardian's consent is what matters.

## 4. The account model: the guardian holds the account

**The account holder is the parent or legal guardian. There is no branch.**

| | Today | After |
|---|---|---|
| Account holder | ambiguous — parent *or* student | always the guardian |
| `profiles.full_name` | whoever signed up | the guardian |
| `profiles.email` / `phone` | whoever signed up | the guardian's |
| The learner | not recorded at all | `learner_first_name`, `learner_grade` |
| What the teacher sees | `sessions.student_name`, a trigger-written copy of the account holder's `full_name` (`0004`) | the learner's first name |

`sessions.student_name` finally means what its name says. `0004` added it so a teacher would see
something other than "A student", because the `profiles` SELECT policy from `0001` returns zero
rows when a teacher reads a student's profile. That reasoning is unchanged and the mechanism is
unchanged — `enforce_session_insert` still snapshots, still cannot be forged by the caller. It
just snapshots the right name.

**Why the guardian rather than the student:**

- Consent is only worth recording if it attaches to someone who can give it. Under this model the
  consent record names an identified adult with their own email and phone.
- **It makes the payment signal meaningful.** `0014`'s own comment states the problem: *"the
  STUDENT account pays, so a teenager using UPI and a parent using their own card are
  indistinguishable in this schema."* When the account holder is the guardian, the payment
  instrument and the account holder are the same person, and every paid session becomes
  independent corroboration that an adult is involved.
- It gives §12 an answer. There is always an adult email and phone to reach, structurally.
- It is one account shape. Against the standing "build for scale" rule, one shape beats a
  permanent branch.

**What it costs:** signup grows two fields, the consent copy changes, `CONSENT_VERSION` bumps,
and a student who is nearly 18 still needs a guardian to hold the account. Accepted.

## 5. Verification: what counts as proof an adult was there

A tick is not proof. Two mechanisms, in this order:

1. **Phone OTP to the guardian's number**, at signup. Proves control of an adult's phone. The
   number is already collected. The evidence is a timestamp, not a document — nothing sensitive
   is created.
   Success stamps `profiles.guardian_phone_verified_at` (§13) and writes a `consent_events` row.
2. **The Razorpay payment**, as standing corroboration. An adult instrument touches every paid
   session already; today that signal is discarded.

Together these are stronger evidence than any artifact we could ask a family to upload, and they
add essentially no new risk surface.

**⚠ OTP has real lead time in India.** SMS to Indian numbers requires DLT registration of the
sender ID and of every template, which is a days-to-weeks process with the telecom registry, not
an afternoon of code. **This must not block the pilot.** For the pilot only, the guardian is
verified by the operator on a call and the fact is recorded as
`consent_events.path = 'operator_verified'` (§6). That is a legitimate verification — a human
spoke to the adult — and it is auditable. It does not scale, which is exactly why OTP replaces
it before any growth. The schema is identical either way, which is the point: get the record
right now, swap the mechanism later without a migration.

### 5.1 Rejected: a one-time signup video from every student

Proposed in conversation on 2026-09-04: every student records a video at signup with their
parent present giving consent, kept as proof. **Rejected.** Recorded here with the reasoning so
it is not relitigated.

The instinct is right — a tick is not a human artifact, and we do want evidence an adult was
actually there. The implementation inverts the risk:

- **It creates the most sensitive dataset we own, at the first touchpoint**, before the family
  has received a single lesson. Today the worst case is a name, a phone number and a subject.
- **It builds a honeypot**: video of identified children joined to name, grade, phone number and
  the hours they are online, in one project. There is also nowhere to put it — teacher demo
  videos are a `demo_video_url` the *teacher* hosts; students cannot do that, so it would mean
  new Storage, new RLS, retention rules and access logging, none of which exists.
- **It does not verify the parent.** A video shows *an* adult saying yes. An older sibling or a
  cousin passes identically. Maximum data risk, same unverified claim — and evidence that looks
  solid but is not is worse than a checkbox, because we would stop worrying about it.
- **It cannot be re-obtained on a version bump.** Consent must be withdrawable and re-given when
  terms change materially, which is why `consent_version` exists. Footage is frozen at a moment;
  when recording ships and the terms change, every video becomes consent to a document that no
  longer exists.
- **Someone must watch every one** before an account activates — a moderation queue, a backlog
  and a decision log, on an operator who is one person.

The principle kept from it: **keep the proof, not the payload.** Where a human check is wanted,
record *that it happened* — timestamp, who verified, who they spoke to — never the raw footage.
This is also why the demo video is right for teachers and wrong for students: teachers are
adults, it is professional and public-facing, and they host it themselves at a URL we reference.

## 6. The consent record: an append-only log

`profiles.consent_accepted_at` / `consent_version` are a *latest-value* convenience. The record
of what was agreed becomes its own table, following the `notification_events` precedent (`0015`)
— an append-only log whose whole purpose is outliving the thing it describes.

```
consent_events
  id           uuid pk
  user_id      uuid references profiles(id) on delete set null  -- nullable: see below
  version      text not null           -- CONSENT_VERSION at the time
  path         text not null check (path in (
                 'student_signup','tutor_signup','google_interstitial',
                 'reconsent','operator_verified'))
  accepted_at  timestamptz not null default now()   -- server clock, never the client's
  subject_email text not null          -- snapshotted; see below
  detail       text                                 -- who verified, for operator_verified
```

- **`on delete set null`, not cascade.** Deleting an account must not erase the record that
  consent was given, for the same reason `notification_events` keeps its rows.
- **`subject_email` is snapshotted at insert.** This is `0017`'s lesson applied: a report that
  destroyed its own evidence when the teacher was deleted was useless, so it snapshots
  `teacher_name` / `subject` / `session_at`. A consent row whose `user_id` has gone null is
  evidence of nothing — it records that *somebody* agreed. The snapshot is what makes the row
  still answer "who agreed, and when". It is also the one field that survives deletion, which
  §8 must disclose rather than bury.
- **Insert-only.** No update or delete policy for anyone. A withdrawal is a new row, not an edit.
- **Written through a `security definer` RPC**, `record_consent(p_version, p_path, p_detail)`,
  which stamps `now()` and `auth.uid()` in SQL. The client cannot forge either. This follows
  `become_teacher` (`0013`): the rule is enforced in the database, for every caller, not only
  the path the app happens to take.
- **Read by the service role only**, as `session_reports` is (`0017`). Acceptable only while the
  operator is one person; §12 is where that stops being true.

**Why a log and not just the two columns:** the columns cannot answer "what did this family
agree to, and when, and how was it obtained" after a version bump — the previous agreement is
overwritten. That is the question that matters if anything ever goes wrong.

**No backfill.** The only existing accounts are two test accounts. The pilot starts clean.

## 7. Google sign-in records no consent at all

`src/app/auth/callback/route.ts` exchanges the code and redirects. Google sends no consent, and
`handle_new_user` (`0014`) copies `consent_accepted_at` from signup metadata that OAuth never
supplies. **One tap therefore mints a live student account with `consent_accepted_at` NULL.**

This is a hole today, independent of every decision in this spec, and it is the same class as
the tutor checkbox: a consent requirement that one path enforces and another bypasses.

**Fix:** the callback routes any profile with no consent row to a blocking interstitial before
`resolveHome()` runs. The interstitial collects what OAuth cannot supply — guardian confirmation,
`learner_first_name`, `learner_grade` — and calls `record_consent(path => 'google_interstitial')`.
No student surface is reachable until it completes.

This is why §6 puts consent in its own table: "has this account consented?" must be one query
that every entry path asks, rather than a rule each signup form remembers on its own.

## 8. `/privacy`

A real page at `/privacy`. The student form's "Privacy Policy" link (`signup-form.tsx:107`)
points at it instead of at `/terms`. **The tutor form has no privacy link at all** — its two
links are Terms of Service and a Tutor Agreement (§9) — so it gains one. Teachers' data is in
the inventory below; they are entitled to the same page.

The factual inventory it must state, taken from the schema rather than assumed:

| Data | Where | Whose |
|---|---|---|
| Name, email, phone | `profiles` | guardian; teacher |
| Learner first name, grade | `profiles` (new) | the child |
| Qualification, experience, specialisation, rate, hours, bio, demo video URL | `profiles` | teacher |
| Subjects, curriculum, grade taught | `teacher_subjects` | teacher |
| Session records: subject, grade, timestamps, duration, rate | `sessions` | both |
| Payment references, amount, refund reference | `sessions` (`0005`) | guardian |
| Availability and lease times | `teacher_availability` | teacher |
| Push endpoint, auth key, user agent | `teacher_devices` | teacher |
| Delivery outcomes per device | `notification_events` (`0015`) | teacher |
| Report reason and free-text detail | `session_reports` (`0016`) | reporter |
| Consent events | `consent_events` (new) | both |

Processors it must name: **Supabase** (database and auth), **Daily.co** (video),
**Razorpay** (payments), **Google** (optional sign-in), **Apple/Google push services** (FCM and
`web.push.apple.com`, teacher devices only), **Sentry** (error reporting), **Vercel** (hosting).

It must state plainly that **sessions are recorded, retained 30 days and then deleted** (§11) —
prominently, not buried, because it is the single most surprising thing on the page. It must
also state the retention periods and how to obtain deletion. Deletion
must be honest about what survives: `session_reports` deliberately outlives the teacher it
describes (`0017`), and `consent_events` deliberately outlives the account, retaining the email
the consent was given under (§6). Say so on the page; a deletion promise with an undisclosed
exception is worse than an honest one.

**Retention, decided here so the page can state it:**

| Data | Kept |
|---|---|
| Session recordings (§11) | **30 days**, then deleted automatically; preserved beyond that only while a report about that session is open |
| `notification_events` and delivery diagnostics | 90 days |
| Session and payment records | as long as financial-record requirements demand (§17) |
| `consent_events`, `session_reports` | indefinitely — they are the evidence |

Add recordings to the inventory table above: **session video and audio, held by Daily.co,
concerning both the child and the teacher.** It is now the most sensitive row on the page and
should not be the one a reader has to hunt for.

## 9. `/terms` — what is actually wrong

The page is *accurate about the product*. An earlier note claiming it describes chat, packages
and ratings was wrong; it describes Instant Connect, the availability toggle and the acceptance
window, all of which exist. Three real problems:

1. **It is not a privacy policy**, yet it is what both "Privacy Policy" links point at (§8), and
   it is the URL Google shows on the consent screen.
2. **The refund policy is a placeholder** — "has not been published yet" (`terms/page.tsx:19`),
   restated at line 54. **Now in scope and blocking** (§17): the pilot charges real money, so a
   published refund policy is owed before the first paid session. It also has to answer the
   no-show case, which is the one that will actually occur.
3. **It forbids recording outright** (`terms/page.tsx:186`), which collides with §11.

The tutor form links to a **"Tutor Agreement"** (`tutor-form.tsx:256`) that does not exist.
Either write it or change the link text; do not keep asking teachers to agree to a missing
document. Now that tutor consent is required and recorded, that link is load-bearing.

## 10. Teacher vetting — DECIDED

Adults meeting children one-to-one on video is the highest-risk configuration in this product,
and `canBecomeTeacher` currently checks only that an account has no history.

**Decided 2026-09-04. Before a teacher may meet a child, all three:**

1. **Government ID, checked against the name on the account.** Reviewed by the operator by eye
   for the pilot. The ID document itself is **not stored** — §5.1's principle applies here too:
   record that the check happened, who did it, and when. Keeping a library of teachers' ID
   scans creates the same honeypot for a different population.
2. **A signed Tutor Agreement** — the document §9 says the tutor form already links to and which
   does not exist. It has to be written, and it is where the conduct rules become binding rather
   than decorative.
3. **The demo video**, already collected as `demo_video_url` and teacher-hosted.

A formal third-party background check was considered and **deferred, not rejected**: at pilot
size the operator knows every teacher personally, and the cost and days of lead time per teacher
would stall recruiting the first cohort. It is the obvious next step when teachers arrive from
outside that circle, and the vetting state in §13 is designed so adding a check is a new value
rather than a new mechanism.

**In code:** a vetting state on `profiles`, and `available_teachers` (`0010`) excludes any
teacher who has not cleared it. A teacher who has not been vetted can hold an account and
complete their profile; they cannot be picked.

## 11. Recording — DECIDED

**Decided 2026-09-04: every session is recorded, retained 30 days, then deleted automatically.
A session that is the subject of a `session_report` is preserved until the report is closed.**

The tension is real and worth naming rather than glossing. For one-to-one adult-to-minor video,
recording is the primary deterrent and the only evidence that exists when a child reports
something. Safety argues for it; privacy argues against.

**Why this does not contradict §5.1**, which rejected collecting video: a signup video is taken
from everyone, before any value is delivered, and verifies nothing. A session recording is a
byproduct of the service itself, serves a concrete safety purpose, and expires. **The expiry is
what separates them** — it bounds the honeypot to a rolling 30 days rather than letting it grow
forever, which is why the retention is part of the decision and not an implementation detail.

**Five things move together, or the product contradicts itself:**

1. The Daily room property that enables recording.
2. The payment notice — "may be recorded" becomes "will be".
3. `terms/page.tsx:186`, which currently forbids recording outright.
4. **`CONSENT_VERSION` bumps and every family re-consents.** Recording is a material change to
   how a child's data is handled; prior consent is not consent to it. This is exactly the case
   §6's log exists to handle and §5.1's video could not have.
5. **`/privacy` stops saying sessions are not recorded** (§8) and states the 30-day retention.

**Access is restricted to the operator**, by the same service-role-only posture as
`session_reports` (`0017`). A teacher may not download a recording of their own session — the
recording exists as evidence about them, not as a resource for them.

## 12. Escalation — DECIDED

`session_reports` collects evidence and raises a Sentry alert. Everything after that was
undefined. Sentry remains a deliberate compromise recorded in the previous spec: *a safety
report is not an error*.

**Decided 2026-09-04:**

- **A `conduct` report suspends the teacher immediately and automatically** — they drop out of
  `available_teachers` before any human looks at it. An innocent teacher loses at most a day of
  lessons; the other direction of error is a child. **Automatic, not operator-initiated**,
  because a report filed at 2am must not wait for someone to wake up.
- **The operator reviews within 24 hours** and either reinstates or removes. The operator is the
  founder for the pilot; this stops being honest the moment there is a second one.
- **The guardian on the account is contacted** — which §4 is what makes possible at all.
- **A reinstatement is recorded, not just performed.** The review outcome is evidence in the same
  way the report is; a teacher reinstated twice is a pattern nobody will see if reinstatement
  leaves no row.

**⚠ Auto-suspension makes the report endpoint an attack surface, which it was not before.**
The previous spec left reporting deliberately un-rate-limited, which was fine while a report only
raised an alert. Now a report *acts*: it removes a teacher from the platform with no human in the
loop. The RLS participation check means only someone who actually had a session with that teacher
can file, which bounds it — but a student who wants a teacher gone can now achieve it instantly,
and repeatedly.

**Required before signups open beyond the pilot** (not before the pilot itself, where every
family is known to the operator, and where a teacher suspended in error is one phone call away
from reinstatement):

- **One auto-suspension per reporter per teacher.** A second report from the same student against
  the same teacher still files and still alerts; it does not re-suspend. This kills the repeat
  vector without discarding evidence.
- **A rate limit on reporting**, which §16 previously listed as deferred and which this decision
  promotes to required.

Recorded explicitly because it is the kind of hole that appears only when two decisions meet:
neither auto-suspension nor an open report endpoint is dangerous alone.

**Still open, and it is the one thing in this section that is not code:** the external escalation
path — the threshold at which a report goes to the police rather than to the operator, and who
makes that call. It needs the legal input in §17.

**Required in admin (piece 3):** reading reports without the service role; reinstating a
suspended teacher; recording the review outcome; and retrieving the preserved recording (§11)
for a report under review. Until admin exists the operator reads their own alerts and acts in
SQL, which is honest only at pilot size.

## 13. Schema changes

| Migration | Change |
|---|---|
| `0018` | `profiles`: add `learner_first_name text`, `learner_grade text check (… '6th'…'12th')`, `guardian_phone_verified_at timestamptz`. |
| `0018` | `enforce_session_insert`: snapshot `learner_first_name` into `sessions.student_name`, falling back to `full_name` when null, so pre-existing rows and teacher-side reads are unaffected. |
| `0019` | `consent_events` table, insert-only RLS, `record_consent()` security-definer RPC, service-role-only read (`revoke select … from anon, authenticated` **explicitly by name** — `revoke … from public` does not remove a named grant; `0012` shipped that bug). |
| `0020` | `profiles.vetting_state text not null default 'unvetted' check (… 'unvetted','cleared','suspended','removed')`, plus `vetted_at`, `vetted_by`, and `vetting_note` — recording that the ID was checked, by whom, and when, **never the document** (§10). `available_teachers` (`0010`) returns only `cleared`. |
| `0021` | A `conduct` report sets `vetting_state = 'suspended'` in the same transaction that inserts the report — a trigger, not application code, so it holds for every caller and cannot be forgotten by a future write path (`0013`'s discipline). Plus `report_reviews`: an append-only row per review with the outcome, so a reinstatement is evidence and not just a state change (§12). |
| `0022` | Recording: `sessions.recording_id text`, `recording_expires_at timestamptz`, `recording_preserved boolean not null default false`. The expiry is a stored column rather than a computed one so the sweep is a plain indexed query, and preservation is a flag the report trigger sets. Gated on §11 shipping. |

`0006` stays unapplied. Nothing here needs it.

**Migrations are applied by hand into the SQL editor: strip `begin;`/`commit;` first.** `0013`
silently rolled back with them and every verification count came back `0` with no explanation.

## 14. Testing

- `parseStudentSignUp` requires `learner_first_name` and a `learner_grade` in the allowed set;
  rejects a grade outside it. Unit, mirroring the existing consent tests.
- The Google callback redirects an account with no consent row to the interstitial, and does not
  redirect one that has consented. Unit against a mocked client, mirroring
  `tutor-signup/actions.test.ts`.
- `record_consent` stamps the server clock and `auth.uid()`, and ignores any client-supplied
  timestamp. Probe against the live database — `probe-consent.mjs`, mints a throwaway account and
  deletes it in a `finally`, like the other seven.
- `consent_events` is unreadable with the anon key and unreadable by an authenticated user who is
  not the subject. Same probe. This is the `0017` lesson: assert the revoke, not only the policy.
- A session created by a guardian account snapshots the **learner's** first name into
  `student_name`. Probe, because it runs in a trigger.

## 15. Decisions, and what each costs if wrong

| Decision | If wrong |
|---|---|
| Guardian holds the account, no branch | A 17-year-old who wants to book alone cannot. Recoverable: widening later is additive. |
| OTP + payment, not an uploaded artifact | Weaker-looking evidence than footage. Deliberate — §5.1. |
| Operator verification for the pilot | Does not scale. Bounded by pilot size and replaced by OTP. |
| Consent as an append-only log | One more table. Cheap; the alternative loses history on every version bump. |
| Blocking interstitial on Google sign-in | Friction on the fastest signup path. Accepted: the alternative is accounts with no consent. |
| Retention: reports and consent kept indefinitely | Holding data longer than strictly needed. Deliberate — it is the evidence. |
| `conduct` auto-suspends a teacher pending review | An innocent teacher loses up to a day of lessons. Correct direction of error; the alternative errs against a child. |
| Vetting = ID + agreement + demo, no background check | A teacher passes who a formal check would have caught. Bounded while the operator knows every teacher personally; §10 says when that stops being true. |
| ID checked but not stored | Cannot re-examine the document later. Deliberate — storing them recreates §5.1's honeypot for teachers. |
| Record every session, 30-day expiry | Storage cost, and a rolling window of sensitive video. The expiry is what makes it defensible; without it this is the option §5.1 argues against. |
| Recordings withheld from teachers | A teacher cannot review their own lesson. Deliberate: the recording is evidence about them. |
| Pilot charges real money before legal sign-off | Exposure on a consent model no lawyer has reviewed. Bounded by pilot size, operator-verified guardians, and a published refund policy. |

## 16. Out of scope, explicitly

- **Admin UI** — piece 3, specified against §12 but not built here.
- **Stripe Connect, scheduled tier, chat, ranking** — still deferred per `CLAUDE.md`.
- **Resend for report emails** — carried forward from the previous spec; Sentry remains the
  compromise until admin exists.
- **A retention sweep on `notification_events`** — still open from the previous spec. §8 now
  commits to a 90-day period, so the sweep has a number.
- **Rate limiting on reporting is no longer deferred.** §12's auto-suspension promoted it to
  required-before-general-signup; it is out of scope only for the pilot itself.
- **Verifying the child's age.** Not achievable, and not what is required.

## 17. The pilot gate, and what still needs a lawyer

**Decided 2026-09-04: the pilot charges real money, at the real price, with legal review running
in parallel rather than blocking it.**

Running the pilot free was considered and rejected on discovering what it actually costs.
`src/lib/session.ts:37` states the rule the state machine is built around — *"The only route to
`active` is through `paid`"* — and `accepted` transitions only to `paid`, `payment_expired` or
`cancelled`. The schema agrees at every level: `sessions.hourly_rate check (> 0)`,
`amount_paid_paise check (> 0)`, and cycle 3's `/sessions` lists on
`amount_paid_paise IS NOT NULL OR refund_ref IS NOT NULL` (`student-sessions.ts:12`). **A free
pilot would mean no session ever reaching `active`, no call ever starting, and an empty session
record for every student** — closed by adding a `waived` path through the most safety-critical
state machine in the product, all of it thrown away the day charging begins. The refund policy
that a free pilot would have deferred is owed before launch regardless, so writing it now is
permanent work rather than avoided work.

**Therefore blocking the first paid session, and neither needs a lawyer:**

- The refund policy, published, answering the no-show case (§9).
- Guardian verification by operator call, recorded as `consent_events.path = 'operator_verified'`
  (§5).

**Still requiring qualified legal input.** This spec reasons from the schema and from the shape
of the risk; it is not legal advice. Three questions:

1. **What counts as verifiable parental consent** under India's DPDP Act, which treats everyone
   under 18 as a child — and therefore whether §5's operator call, and later OTP-plus-payment,
   is sufficient.
2. **The retention periods in §8**, against financial-record requirements — and specifically
   whether 30 days is defensible for recordings of children.
3. **The external escalation threshold in §12** — what must be reported to authorities, by whom,
   and how fast. This is the one decision in §§10–12 left deliberately open.

**Sequencing.** §§4–9 and §13 can be built now. §§10–12 are decided and buildable, except the
external escalation threshold. The legal answers can change §5's verification mechanism and §8's
retention numbers — both are configuration rather than architecture, which is why the pilot is
not gated on them.

**One honest note carried forward from the previous handoff:** the engineering here is calibrated
for a platform serving thousands of families. There are currently two test accounts and the
product has never met a real student. The safety machinery is not premature — the first real
child is exactly when it has to already exist — but the rest of the roadmap should stay honest
about that gap.
