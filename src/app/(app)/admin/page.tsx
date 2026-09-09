import { notFound } from "next/navigation";
import { getIdentity } from "@/lib/auth";
import { createDispatchClient } from "@/lib/supabase/admin";
import { setVettingState, reinstateTeacher, suspendTeacher } from "./actions";

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
  const [{ data: teachers }, { data: openSuspensions }, { data: availability }] =
    await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, demo_video_url, vetting_state, created_at")
      .eq("role", "teacher")
      .order("created_at", { ascending: false }),
    // A teacher is off the roster for EITHER reason, and the operator cannot
    // act correctly without seeing which. Previously this page read only
    // profiles, so a teacher suspended by a conduct report still displayed as
    // "cleared" with a Clear button beside them.
    supabase
      .from("teacher_suspensions")
      .select("teacher_id, suspended_at")
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
      .eq("declared", true)
      .gt("declared_until", new Date().toISOString()),
  ]);

  const suspendedAt = new Map(
    (openSuspensions ?? []).map((s) => [s.teacher_id, s.suspended_at as string])
  );
  // Already narrowed by the query above to declared, unlapsed leases —
  // available_teachers' own test, made once, in the database.
  const online = new Set((availability ?? []).map((a) => a.teacher_id));

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-black tracking-tight">Teachers</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Check the ID against the name on the account, watch the demo, then clear them.
        Never save the document.
      </p>

      <ul className="divide-y divide-border border-y border-border">
        {(teachers ?? []).map((t) => {
          const suspended = suspendedAt.get(t.id);
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
                {suspended ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Suspended automatically by a conduct report. Reinstating is
                    the only way back — clearing them again will not do it.
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
