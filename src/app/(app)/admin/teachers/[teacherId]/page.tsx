import Link from "next/link";
import { notFound } from "next/navigation";
import { getIdentity } from "@/lib/auth";
import { createDispatchClient } from "@/lib/supabase/admin";
import { summariseSubjects, type SubjectRow } from "@/lib/subject-summary";
import { PageHeader } from "@/components/page-header";

/**
 * One teacher, in full.
 *
 * The roster at /admin is a triage list: who is waiting, and what is the
 * operator being asked to decide. Everything a teacher claims about themselves
 * was first added inline there, which made a single row a page tall and buried
 * that decision. It lives here instead, one click away from the same row —
 * minimal list, full detail on demand.
 *
 * There is no resume or CV in this product: no upload, no storage, no column
 * anywhere in the schema. What follows plus the demo video is the whole of what
 * exists to judge a stranger by.
 */
export default async function AdminTeacherPage({
  params,
}: {
  params: Promise<{ teacherId: string }>;
}) {
  const { teacherId } = await params;
  const identity = await getIdentity();
  // notFound rather than a redirect, matching /admin: a non-admin should not
  // learn that this route exists.
  if (identity?.role !== "admin") notFound();

  // Service-role client for the same reason /admin uses one: 0020 revokes
  // column-level SELECT on vetting_state from authenticated, table-wide, so
  // even an admin's own session cannot read it. The check above is the gate.
  const supabase = createDispatchClient();

  const [{ data: teacher }, { data: subjects }, { data: vettings }, { data: revets }, { data: suspensions }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, phone, demo_video_url, vetting_state, created_at, qualification, experience_years, specialization, teaching_level, hourly_rate, hours_per_week, bio")
        .eq("id", teacherId)
        .eq("role", "teacher")
        .maybeSingle(),
      supabase
        .from("teacher_subjects")
        .select("teacher_id, curriculum, grade, stream, subject")
        .eq("teacher_id", teacherId),
      supabase
        .from("teacher_vetting")
        .select("vetted_at, note")
        .eq("teacher_id", teacherId)
        .order("vetted_at", { ascending: false }),
      supabase
        .from("teacher_revet_events")
        .select("changed_at, changes")
        .eq("teacher_id", teacherId)
        .order("changed_at", { ascending: false })
        .limit(20),
      supabase
        .from("teacher_suspensions")
        .select("suspended_at, suspended_reason, lifted_at")
        .eq("teacher_id", teacherId)
        .order("suspended_at", { ascending: false }),
    ]);

  // A non-teacher id, or one that does not exist, is the same answer.
  if (!teacher) notFound();

  const lines = summariseSubjects((subjects ?? []) as SubjectRow[]);
  const facts: [string, string | null][] = [
    ["Email", teacher.email],
    ["Phone", teacher.phone],
    ["Qualification", teacher.qualification],
    ["Specialization", teacher.specialization],
    ["Experience", teacher.experience_years === null ? null : `${teacher.experience_years} years`],
    ["Teaches", teacher.teaching_level],
    ["Rate", teacher.hourly_rate === null ? null : `₹${teacher.hourly_rate}/hr`],
    ["Hours per week", teacher.hours_per_week],
    ["Applied", new Date(teacher.created_at).toLocaleDateString()],
  ];

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/admin"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to the roster
        </Link>

        <div className="mt-4">
          <PageHeader
            as="h1"
            title={teacher.full_name}
            description={`Currently ${teacher.vetting_state}. Check the ID against the name above, watch the demo, then clear them from the roster. Never save the document.`}
          />
        </div>

        <dl className="mt-8 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {facts
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <div key={label}>
                <dt className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                  {label}
                </dt>
                <dd className="text-foreground">{value}</dd>
              </div>
            ))}
        </dl>

        <section className="mt-8">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Would be listed for
          </h2>
          {lines.length > 0 ? (
            <ul className="mt-2 grid gap-1">
              {lines.map((l) => (
                <li key={`${l.subject}|${l.curriculum}|${l.stream ?? ""}`} className="text-foreground">
                  {l.subject} · {l.curriculum} · {l.grades}
                  {l.stream ? ` · ${l.stream}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-destructive">
              No subjects — clearing them puts them in front of nobody.
            </p>
          )}
        </section>

        {teacher.bio?.trim() ? (
          <section className="mt-8">
            <h2 className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Bio, as students see it
            </h2>
            <p className="mt-2 max-w-[70ch] whitespace-pre-line text-foreground">
              {teacher.bio.trim()}
            </p>
          </section>
        ) : null}

        <section className="mt-8">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Links
          </h2>
          <p className="mt-2 text-foreground">
            {teacher.demo_video_url ? (
              <a
                href={teacher.demo_video_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-4"
              >
                Demo video
              </a>
            ) : (
              <span className="text-muted-foreground">No demo video</span>
            )}
            {teacher.phone ? (
              <>
                {" · "}
                {/* Ask for the ID as view-once and delete it after checking:
                    WhatsApp history and phone backups are the same honeypot
                    §10 refuses to build in the database. */}
                <a
                  href={`https://wa.me/91${teacher.phone.replace(/\D/g, "").slice(-10)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-4"
                >
                  WhatsApp
                </a>
              </>
            ) : null}
          </p>
        </section>

        {/* The decision history. Who cleared them and whether the ID check was
            affirmed — NULL for every clearance made before 2026-09-10, which is
            a fact about the record, not a rendering gap. */}
        <section className="mt-8">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Vetting history
          </h2>
          {(vettings ?? []).length > 0 ? (
            <ul className="mt-2 grid gap-2">
              {(vettings ?? []).map((v) => (
                <li key={v.vetted_at} className="text-sm">
                  <span className="text-foreground">
                    {new Date(v.vetted_at).toLocaleString()}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {v.note ?? "no ID-check affirmation recorded"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Never cleared.</p>
          )}
        </section>

        {(revets ?? []).length > 0 ? (
          <section className="mt-8">
            <h2 className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Profile changes that sent them back for review
            </h2>
            <ul className="mt-2 grid gap-2">
              {(revets ?? []).map((r) => (
                <li key={r.changed_at} className="text-sm">
                  <span className="text-foreground">
                    {new Date(r.changed_at).toLocaleString()}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {Object.keys(r.changes as Record<string, unknown>).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {(suspensions ?? []).length > 0 ? (
          <section className="mt-8">
            <h2 className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Suspensions
            </h2>
            <ul className="mt-2 grid gap-2">
              {(suspensions ?? []).map((s) => (
                <li key={s.suspended_at} className="text-sm">
                  <span className="text-foreground">
                    {new Date(s.suspended_at).toLocaleString()}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {s.suspended_reason ?? "no reason recorded"}
                    {s.lifted_at ? " — lifted" : " — still open"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
