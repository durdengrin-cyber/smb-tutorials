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
`/privacy`; the contradictions in `/terms`; the Google sign-in path that records no consent at
all; and the decisions on teacher vetting and recording that everything else waits on.

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

It must also state plainly: **sessions are not recorded** (true today — and §11 is what changes
if that stops being true), what the retention periods are, and how to obtain deletion. Deletion
must be honest about what survives: `session_reports` deliberately outlives the teacher it
describes (`0017`), and `consent_events` deliberately outlives the account, retaining the email
the consent was given under (§6). Say so on the page; a deletion promise with an undisclosed
exception is worse than an honest one.

**Retention, decided here so the page can state it:** `notification_events` and delivery
diagnostics, 90 days. Session and payment records, as long as required for financial records.
`consent_events` and `session_reports`, indefinitely — they are the evidence.

## 9. `/terms` — what is actually wrong

The page is *accurate about the product*. An earlier note claiming it describes chat, packages
and ratings was wrong; it describes Instant Connect, the availability toggle and the acceptance
window, all of which exist. Three real problems:

1. **It is not a privacy policy**, yet it is what both "Privacy Policy" links point at (§8), and
   it is the URL Google shows on the consent screen.
2. **The refund policy is a placeholder** — "has not been published yet" (`terms/page.tsx:19`),
   restated at line 54. Still open; listed in `CLAUDE.md` as a pre-launch item.
3. **It forbids recording outright** (`terms/page.tsx:186`), which collides with §11.

The tutor form links to a **"Tutor Agreement"** (`tutor-form.tsx:256`) that does not exist.
Either write it or change the link text; do not keep asking teachers to agree to a missing
document. Now that tutor consent is required and recorded, that link is load-bearing.

## 10. Teacher vetting — decision required

Adults meeting children one-to-one on video is the highest-risk configuration in this product,
and `canBecomeTeacher` currently checks only that an account has no history.

**Recommended minimum before a teacher meets a child:** government ID checked against the name
on the account; a signed conduct agreement (the Tutor Agreement from §9); and the demo video,
which is already collected. Whether to go further — a formal background check — is a cost
decision, but *"we did not check"* is the answer that does not survive an incident.

Whatever is decided, it is admin's first job (§12) and it needs a state on the profile: a
teacher who has not cleared vetting must not appear in `available_teachers` (`0010`).

## 11. Recording — decided, and the three things that move together

Recording is **decided but deferred to launch** (carried forward from the prior handoff). The
tension is real and should be named: for one-to-one adult-to-minor video, recording is the
primary deterrent and the only evidence that exists when a child reports something. Safety
argues for it; privacy argues against. The standard resolution is to record, disclose it
prominently, retain briefly, and restrict access to one named person.

**When it ships, three things move in the same change or the product contradicts itself:**

1. The Daily room property that enables recording.
2. The payment notice — "may be recorded" becomes "will be".
3. `terms/page.tsx:186`, which currently forbids recording outright.

And a fourth, added by this spec: **`CONSENT_VERSION` bumps and every family re-consents.**
Recording is a material change to how a child's data is handled; prior consent is not consent to
it. This is precisely the case §6's log exists to handle and §5.1's video could not.

## 12. Escalation — what happens when a child reports something

`session_reports` collects evidence and raises a Sentry alert. Nothing else is defined, and
Sentry is a deliberate compromise recorded in the previous spec: *a safety report is not an
error*.

**Required before the pilot, and none of it is code:**

- **Who reads a `conduct` report, and within what window.** A named person and a stated time.
- **Who they contact.** The guardian on the account — which §4 is what makes possible.
- **What happens to the teacher meanwhile.** Recommended: a `conduct` report suspends the
  teacher from `available_teachers` pending review. Erring toward a lost lesson is the correct
  direction of error.
- **The external escalation path** — when a report goes to the police rather than to an operator.

**Required in code, in admin (piece 3):** reading reports without the service role; suspending a
teacher; recording that a report was reviewed and what was decided. Until then the operator
reads their own alerts, which is honest only for a pilot of this size.

## 13. Schema changes

| Migration | Change |
|---|---|
| `0018` | `profiles`: add `learner_first_name text`, `learner_grade text check (… '6th'…'12th')`, `guardian_phone_verified_at timestamptz`. |
| `0018` | `enforce_session_insert`: snapshot `learner_first_name` into `sessions.student_name`, falling back to `full_name` when null, so pre-existing rows and teacher-side reads are unaffected. |
| `0019` | `consent_events` table, insert-only RLS, `record_consent()` security-definer RPC, service-role-only read (`revoke select … from anon, authenticated` **explicitly by name** — `revoke … from public` does not remove a named grant; `0012` shipped that bug). |
| `0020` | Teacher vetting state on `profiles`, and `available_teachers` (`0010`) excludes teachers who have not cleared it. Gated on §10. |

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
| `conduct` suspends a teacher pending review | An innocent teacher loses lessons. Correct direction of error. |

## 16. Out of scope, explicitly

- **Admin UI** — piece 3, specified against §12 but not built here.
- **Stripe Connect, scheduled tier, chat, ranking** — still deferred per `CLAUDE.md`.
- **Resend for report emails** — carried forward from the previous spec; Sentry remains the
  compromise until admin exists.
- **Rate limiting on reporting**, and a retention sweep on `notification_events` — both still
  open from the previous spec. §8 now commits to a 90-day period, so the sweep has a number.
- **Verifying the child's age.** Not achievable, and not what is required.

## 17. What still needs a lawyer

This spec reasons from the schema and from the shape of the risk. It is not legal advice, and
three things must be confirmed by someone qualified before real money is taken from real
families:

1. **What counts as verifiable parental consent** under India's DPDP Act, which treats everyone
   under 18 as a child — and therefore whether §5's OTP-plus-payment is sufficient.
2. **The retention periods in §8**, against financial-record requirements.
3. **The escalation duties in §12** — specifically what must be reported to authorities, by whom,
   and how fast.

Everything in §§4–9 and §13 can be built before those answers land. §§10–12 cannot be closed
without them.
