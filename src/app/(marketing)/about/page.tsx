import { PageHeader } from "@/components/page-header";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="px-4 py-14 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <PageHeader
            title="About SMB Tutorials"
            description="Who we are and why this exists"
          />

          <section className="mt-10 max-w-[68ch]">
            <h2 className="mb-3 text-2xl font-black tracking-tighter">
              What we do
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground">
              SMB Tutorials connects a student in grades 6&ndash;12 with a
              qualified teacher for a one-to-one video lesson, usually within a
              minute of asking. There is no timetable to fit into and no batch
              of forty. A parent or guardian holds the account; teachers are
              verified against government ID before they meet a child; lessons
              are live and are not recorded.
            </p>
          </section>

          {/* THE DEDICATION GOES HERE — the owner's copy, not ours.
              Spec §2: worded around the value Syedna Mohammed Burhanuddin
              championed, that every child should be given the means to learn,
              and never around religious authority, which would read as a
              membership marker the moment the audience widens beyond the
              community. Deliberately absent from the hero and the signup flow.
              The footer echo was PULLED on 2026-09-05 at the owner's request —
              see marketing-footer.tsx. Nothing renders here or there until the
              owner writes the copy; do not fill it in from this spec note. */}
        </div>
      </main>
    </div>
  );
}
