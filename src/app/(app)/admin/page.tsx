import { notFound } from "next/navigation";
import { getIdentity } from "@/lib/auth";
import { createDispatchClient } from "@/lib/supabase/admin";
import { NotificationSetup } from "@/components/notification-setup";
import {
  setVettingState,
  reinstateTeacher,
  suspendTeacher,
  decideSubjectChange,
} from "./actions";


// Column names are not admin-facing language, and a raw JSON blob is not a
// decision aid. Anything not named here falls back to the column name rather
// than being hidden — an unlabelled field is still a field the admin must see.
const FIELD_LABEL: Record<string, string> = {
  full_name: "Name",
  email: "Email",
  phone: "Phone",
  qualification: "Qualification",
  experience_years: "Experience",
  specialization: "Specialization",
  teaching_level: "Teaching level",
  hourly_rate: "Rate",
  hours_per_week: "Hours/week",
  bio: "Bio",
  demo_video_url: "Demo video",
};

// Long values (a bio, a URL) must not push the decision off the screen, and an
// empty field has to read as empty rather than as nothing at all.
function short(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  const s = String(v);
  return s.length > 48 ? `${s.slice(0, 48)}…` : s;
}

export default async function AdminPage() {
  const identity = await getIdentity();
  // notFound rather than a redirect: a non-admin should not learn this route
  // exists.
  if (identity?.role !== "admin") notFound();

  // Service-role client, not the user's: 0020 revokes column-level SELECT on
  // vetting_state (and its siblings) from BOTH anon and authenticated, and the
  // revoke is table-wide rather than role-conditional — so even this admin's
  // own session would get a column-permission error on the query below. The
  // admin check above already gated getting here; this client only reads what
  // that check already authorized.
  const supabase = createDispatchClient();
  // Teachers first, alone: every query below is scoped to the ids it returns.
  // An unscoped read of teacher_revet_events would pull a whole-row jsonb diff
  // for every profile edit any teacher has ever made, on every page load, and
  // discard most of it in JavaScript.
  const { data: teachers } = await supabase
    .from("profiles")
    .select("id, full_name, phone, demo_video_url, vetting_state, created_at")
    .eq("role", "teacher")
    .order("created_at", { ascending: false });

  const teacherIds = (teachers ?? []).map((t) => t.id);

  const [
    { data: openSuspensions },
    { data: availability },
    { data: revetEvents },
    { data: lastVetted },
    { data: subjectRequests },
  ] = await Promise.all([
    // A teacher is off the roster for EITHER reason, and the operator cannot
    // act correctly without seeing which. Previously this page read only
    // profiles, so a teacher suspended by a conduct report still displayed as
    // "cleared" with a Clear button beside them.
    supabase
      .from("teacher_suspensions")
      // suspended_by and the reason too: since 0025 a suspension has two
      // possible origins, and the page told the admin the wrong one.
      .select("teacher_id, suspended_at, suspended_by, suspended_reason")
      .in("teacher_id", teacherIds)
      .is("lifted_at", null),
    // available_teachers gates on THREE things, so this page must too. It
      // previously read vetting and suspension only, and printed "live" beside
    // a cleared teacher who had never gone online — telling the operator
    // someone was reachable by students when they were not.
    // Filtered in the query rather than in the component: available_teachers
    // makes the same comparison in SQL, and reading "now" during render is
    // both impure and a second clock to disagree with the database's.
    supabase
      .from("teacher_availability")
      .select("teacher_id")
      .in("teacher_id", teacherIds)
      .eq("declared", true)
      .gt("declared_until", new Date().toISOString()),
    // Why each unvetted teacher is back in the queue (0026), and when they
    // were last approved, so only the changes made SINCE that approval are
    // shown. Older diffs are history, not a decision the admin still owes.
    // Bounded. This table gains a row for every re-vetting profile edit by
    // every teacher, forever, and `changes` is a whole-row jsonb diff — an
    // unfiltered select would read all of it on every page load and then throw
    // most of it away in JavaScript. The teacher filter lets 0026's
    // (teacher_id, changed_at desc) index actually serve the query.
    supabase
      .from("teacher_revet_events")
      .select("teacher_id, changed_at, changes")
      .in("teacher_id", teacherIds)
      .order("changed_at", { ascending: false })
      .limit(200),
    supabase
      .from("teacher_vetting")
      .select("teacher_id, vetted_at")
      .in("teacher_id", teacherIds),
    // Pending subject changes (0027). Shown ABOVE the roster because each is a
    // teacher waiting on a decision that only an admin can make, where the
    // list below is mostly people needing nothing.
    supabase
      .from("subject_change_requests")
      .select("id, teacher_id, requested_at, demo_video_url, subjects")
      .eq("status", "pending")
      .order("requested_at", { ascending: true }),
  ]);

  const suspension = new Map(
    (openSuspensions ?? []).map((s) => [
      s.teacher_id,
      {
        at: s.suspended_at as string,
        by: s.suspended_by as string | null,
        reason: s.suspended_reason as string | null,
      },
    ])
  );
  // Already narrowed by the query above to declared, unlapsed leases —
  // available_teachers' own test, made once, in the database.
  const online = new Set((availability ?? []).map((a) => a.teacher_id));

  const approvedAt = new Map(
    (lastVetted ?? []).map((v) => [v.teacher_id, Date.parse(v.vetted_at as string)])
  );
  // Only what changed since the last approval. A teacher cleared, then edited,
  // then cleared again, then edited once more should present one decision, not
  // a growing pile.
  const changesSince = new Map<string, { changed_at: string; changes: Record<string, { from: unknown; to: unknown }> }[]>();
  for (const e of revetEvents ?? []) {
    const since = approvedAt.get(e.teacher_id) ?? 0;
    if (Date.parse(e.changed_at as string) <= since) continue;
    const list = changesSince.get(e.teacher_id) ?? [];
    list.push(e as never);
    changesSince.set(e.teacher_id, list);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-black tracking-tight">Teachers</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Check the ID against the name on the account, watch the demo, then clear them.
        Never save the document.
      </p>

      {/* Mounted here because there was nowhere else. notifyAdminsOfApplication
          has read teacher_devices for admins since 5b73f86, but register_device
          refused any role that was not 'teacher' (until 0029) and this
          component appeared only on two teacher routes, both of which redirect
          an admin away. The alert has therefore never fired. The card hides
          itself once a device is registered. */}
      <div className="mb-10">
        <NotificationSetup variant="card" />
      </div>

      {(subjectRequests ?? []).length > 0 ? (
        <section className="mb-10">
          <h2 className="mb-1 text-lg font-bold tracking-tight">
            Subject changes waiting
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Watch the video before approving. Approving adopts it as their demo
            video, replaces their subjects and clears them in one step — you do
            not need to clear them again afterwards.
          </p>
          <ul className="divide-y divide-border border-y border-border">
            {(subjectRequests ?? []).map((r) => {
              const teacher = (teachers ?? []).find((t) => t.id === r.teacher_id);
              const proposed = Array.isArray(r.subjects)
                ? (r.subjects as { curriculum: string; grade: string; stream: string; subject: string }[])
                : [];
              return (
                <li key={r.id} className="py-4">
                  <p className="font-semibold">
                    {teacher?.full_name ?? "Unknown teacher"}{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      requested{" "}
                      {new Date(r.requested_at as string).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </p>
                  <p className="mt-1 text-sm">
                    <a
                      href={r.demo_video_url as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      Watch the new demo video
                    </a>
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {[...new Set(proposed.map((s) => `${s.stream} · ${s.subject}`))].map(
                      (label) => (
                        <li
                          key={label}
                          className="rounded-sm bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
                        >
                          {label}
                        </li>
                      )
                    )}
                  </ul>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {[...new Set(proposed.map((s) => s.curriculum))].join(", ")} ·{" "}
                    {[...new Set(proposed.map((s) => s.grade))].join(", ")}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <form action={decideSubjectChange} className="flex flex-wrap gap-2">
                      <input type="hidden" name="requestId" value={r.id} />
                      <input
                        name="note"
                        placeholder="Note (optional)"
                        aria-label="Note on this decision"
                        className="w-44 rounded-sm border border-input bg-card px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                      <button
                        name="decision"
                        value="approve"
                        className="rounded-sm bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
                      >
                        Approve
                      </button>
                      <button
                        name="decision"
                        value="reject"
                        className="rounded-sm border border-border px-3 py-1.5 text-sm hover:bg-accent"
                      >
                        Reject
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <ul className="divide-y divide-border border-y border-border">
        {(teachers ?? []).map((t) => {
          const suspended = suspension.get(t.id);
          const cleared = t.vetting_state === "cleared";
          const isOnline = online.has(t.id);
          // The exact conjunction available_teachers applies. Anything less
          // here is a claim on the operator's screen that the roster does not
          // honour.
          const pickable = cleared && !suspended && isOnline;

          return (
            <li key={t.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="font-semibold">
                  {t.full_name}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {t.vetting_state}
                  </span>
                  {suspended ? (
                    <span className="ml-2 rounded-sm bg-destructive/15 px-1.5 py-0.5 font-mono text-xs text-destructive">
                      suspended
                    </span>
                  ) : null}
                  {pickable ? (
                    <span className="ml-2 rounded-sm bg-success/15 px-1.5 py-0.5 font-mono text-xs text-success">
                      live
                    </span>
                  ) : cleared && !suspended ? (
                    // Cleared and clean, but not online. Worth distinguishing
                    // from "not cleared": there is nothing for the operator to
                    // do about it.
                    <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      offline
                    </span>
                  ) : null}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t.demo_video_url ? (
                    <a href={t.demo_video_url} target="_blank" rel="noopener noreferrer" className="underline">
                      Demo video
                    </a>
                  ) : (
                    "No demo video"
                  )}
                  {t.phone ? (
                    <>
                      {" · "}
                      {/* Opens a chat so the operator can ask for the ID. Ask for
                          it as view-once, and delete it after checking: WhatsApp
                          history and phone backups are the same honeypot §10
                          refuses to build in the database. */}
                      <a
                        href={`https://wa.me/91${t.phone.replace(/\D/g, "").slice(-10)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        WhatsApp
                      </a>
                    </>
                  ) : null}
                </p>
                {!cleared && (changesSince.get(t.id)?.length ?? 0) > 0 ? (
                  <div className="mt-2 rounded-sm border border-border bg-muted/50 p-2">
                    <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                      changed since you approved them
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {(changesSince.get(t.id) ?? []).flatMap((e) =>
                        Object.entries(e.changes).map(([field, d]) => (
                          <li key={`${e.changed_at}-${field}`} className="text-sm">
                            <span className="font-medium text-foreground">
                              {FIELD_LABEL[field] ?? field}
                            </span>{" "}
                            <span className="text-muted-foreground">
                              {short(d.from)} → {short(d.to)}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                ) : null}

                {suspended ? (
                  // Two origins since 0025, and telling the admin the wrong
                  // one is worse than telling them nothing: this line read
                  // "Suspended automatically by a conduct report" for a
                  // suspension the admin had just applied by hand, with their
                  // own reason, seconds earlier.
                  <p className="mt-1 text-xs text-muted-foreground">
                    {suspended.by ? (
                      <>
                        Suspended by an admin
                        {suspended.reason ? <> — “{suspended.reason}”</> : null}.
                      </>
                    ) : (
                      <>Suspended automatically by a conduct report.</>
                    )}{" "}
                    Reinstating is the only way back — clearing them again will
                    not do it.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {/* Suspension and vetting are separate gates, so the controls
                    are separate too. The button that used to sit here sent
                    state="suspended" — a value VETTING_STATES has not held
                    since suspension moved to its own table, so every click
                    threw "invalid state: suspended" before reaching the
                    database. There is no manual-suspend RPC to point it at:
                    teacher_suspensions.session_report_id is NOT NULL, so a
                    suspension without a conduct report cannot be recorded. */}
                {suspended ? (
                  <form action={reinstateTeacher} className="flex gap-2">
                    <input type="hidden" name="teacherId" value={t.id} />
                    <input type="hidden" name="outcome" value="reinstated" />
                    <button className="rounded-sm bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
                      Reinstate
                    </button>
                  </form>
                ) : (
                  <form action={setVettingState} className="flex gap-2">
                    <input type="hidden" name="teacherId" value={t.id} />
                    {cleared ? (
                      <button
                        name="state"
                        value="unvetted"
                        title="Takes them off the roster immediately — available_teachers requires 'cleared'."
                        className="rounded-sm border border-border px-3 py-1.5 text-sm hover:bg-accent"
                      >
                        Send back to review
                      </button>
                    ) : (
                      <button
                        name="state"
                        value="cleared"
                        className="rounded-sm bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
                      >
                        Clear
                      </button>
                    )}
                  </form>
                )}

                {/* Suspension is a different statement from "not yet checked",
                    so it is a different control. 0025 requires a reason in
                    SQL, not merely in this form, so every suspension carries
                    one whatever calls it. Offered only for a teacher who is
                    not already suspended. */}
                {suspended ? null : (
                  <form action={suspendTeacher} className="flex gap-2">
                    <input type="hidden" name="teacherId" value={t.id} />
                    <input
                      name="reason"
                      required
                      placeholder="Reason (required)"
                      aria-label={`Reason for suspending ${t.full_name}`}
                      className="w-44 rounded-sm border border-input bg-card px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                    <button className="rounded-sm border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10">
                      Suspend
                    </button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
