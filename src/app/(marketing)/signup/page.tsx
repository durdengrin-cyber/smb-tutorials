import Link from "next/link";
import { SignUpForm } from "./signup-form";

// The left panel used to be a hotlinked Unsplash photo of children under a
// teal gradient, with three emoji benefit badges. Spec §6 removes photographs
// of children entirely, and a signup form does not need decoration — so the
// panel now carries the only three things a parent hesitating at this step
// actually wants confirmed. Each is something the product does today.
const ASSURANCES = [
  {
    label: "VERIFIED",
    text: "Every teacher's government ID is checked against the name on their account before they teach.",
  },
  {
    label: "GUARDIAN",
    text: "You hold the account. Your child is named on it so their teacher knows who they are teaching, and gets no login of their own.",
  },
  {
    label: "PRIVATE",
    text: "Every lesson is recorded, encrypted, and opened only if you report a problem or the law demands it. A person reads that report the same day.",
  },
];

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden border-r border-border bg-card lg:flex lg:w-1/2">
        <div className="flex flex-col justify-center gap-10 p-16">
          <div>
            <h2 className="mb-4 text-balance text-4xl font-black tracking-tighter">
              One teacher, one child, right now.
            </h2>
            <p className="max-w-[42ch] text-base text-muted-foreground">
              You are two minutes from your child being able to ask someone
              qualified the moment they are stuck.
            </p>
          </div>

          <div className="grid gap-px border border-border bg-border">
            {ASSURANCES.map((a) => (
              <div key={a.label} className="bg-card p-5">
                <span className="mb-2 block font-mono text-[11px] tracking-wider text-primary">
                  {a.label}
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {a.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <Link
              href="/signin"
              className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
            >
              ← Back to Sign In
            </Link>
          </div>

          <SignUpForm />
        </div>
      </div>
    </div>
  );
}
