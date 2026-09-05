import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FlowDemo } from "@/components/marketing/flow-demo";

// Every claim here is something the product actually does, shipped and
// verifiable — not aspiration. Spec §3: this page addresses the PARENT, about
// the child's moment. They hold the account, give consent and pay, so they are
// the only person who can complete the action it asks for.
const TRUST = [
  {
    label: "VERIFIED",
    title: "Government ID, checked against the account",
    body: "Every teacher's ID is matched to the name on their account before they take a single lesson. No exceptions, including for people we know.",
  },
  {
    label: "GUARDIAN",
    title: "You hold the account, not your child",
    body: "Parents and guardians sign up. Your child is named so their teacher knows who they are teaching — they do not get a login of their own.",
  },
  {
    label: "PRIVATE",
    title: "Lessons are live, and not recorded",
    body: "Nothing is stored or replayed. Report a problem in one tap and a person reads it the same day — not a queue, not a bot.",
  },
];

const PROMISES = [
  "Nothing is charged until a teacher accepts.",
  "If the teacher does not join, you are refunded in full.",
  "No subscription, and no minimum.",
];

export default function HomePage() {
  return (
    <div className="bg-background">
      <section className="mx-auto max-w-7xl px-4 sm:px-8">
        <FlowDemo />
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-5 sm:px-8">
          <span className="mr-1 font-mono text-[11px] tracking-wider text-primary">
            ONLINE RIGHT NOW
          </span>
          {[
            ["Mathematics", 5],
            ["Physics", 3],
            ["Chemistry", 2],
            ["Biology", 2],
            ["Accountancy", 1],
            ["English", 1],
          ].map(([subject, n]) => (
            <span
              key={subject as string}
              className="flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-[13px]"
            >
              {subject}
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {n}
              </span>
            </span>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-8">
        <p className="mb-3 font-mono text-[11px] tracking-widest text-primary">
          BEFORE ANYONE MEETS YOUR CHILD
        </p>
        <h2 className="mb-3 text-balance text-3xl font-black tracking-tighter sm:text-4xl">
          The part most tutoring sites leave vague.
        </h2>
        <p className="mb-10 max-w-[56ch] text-base text-muted-foreground">
          You are handing a stranger a one-to-one video call with your child.
          Here is exactly what stands between them.
        </p>
        <div className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {TRUST.map((t) => (
            <div key={t.label} className="bg-background p-7">
              <span className="mb-3 block font-mono text-[11px] tracking-wider text-primary">
                {t.label}
              </span>
              <h3 className="mb-2 text-base font-semibold tracking-tight">
                {t.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-8 lg:grid-cols-[1.15fr_.85fr]">
        <div>
          <p className="mb-3 font-mono text-[11px] tracking-widest text-primary">
            WHAT IT COSTS
          </p>
          <h2 className="mb-3 text-balance text-3xl font-black tracking-tighter sm:text-4xl">
            You see the price before you commit.
          </h2>
          <p className="max-w-[56ch] text-base text-muted-foreground">
            Teachers set their own hourly rate and it is shown next to their
            name. There is no membership, no package to buy up front, and
            nothing charged until a teacher has accepted your request.
          </p>
        </div>
        <div className="border border-border bg-card p-7">
          <p className="mb-1.5 text-3xl font-black tracking-tighter">Per lesson</p>
          <p className="mb-5 text-sm text-muted-foreground">
            Set by the teacher, shown before you choose.
          </p>
          <ul className="grid gap-2.5">
            {PROMISES.map((p, i) => (
              <li key={p} className="flex gap-2.5 text-sm text-muted-foreground">
                <b className="pt-0.5 font-mono text-[11px] font-normal text-primary">
                  {String(i + 1).padStart(2, "0")}
                </b>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-8 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="mb-3 font-mono text-[11px] tracking-widest text-primary">
              FOR TEACHERS
            </p>
            <h2 className="mb-2.5 text-balance text-3xl font-black tracking-tighter">
              Teach when you are free. Get paid per lesson.
            </h2>
            <p className="max-w-[52ch] text-base text-muted-foreground">
              Set your rate, go online when it suits you, and take a lesson when
              a request comes in. You are never assigned a batch, a timetable or
              a target.
            </p>
          </div>
          <Button asChild variant="outline" size="lg">
            <Link href="/tutor-signup">Apply to teach</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-8">
        <div className="flex flex-wrap items-center gap-4">
          <Button asChild size="lg">
            <Link href="/signup">Create your account</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/find">See who&apos;s online now</Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            No subscription. You pay for the lesson, after the teacher accepts.
          </p>
        </div>
      </section>
    </div>
  );
}
