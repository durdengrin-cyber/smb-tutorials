import { notFound } from "next/navigation";
import { getIdentity } from "@/lib/auth";
import { createDispatchClient } from "@/lib/supabase/admin";
import { setVettingState } from "./actions";

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
  const { data: teachers } = await supabase
    .from("profiles")
    .select("id, full_name, phone, demo_video_url, vetting_state, created_at")
    .eq("role", "teacher")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-black tracking-tight">Teachers</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Check the ID against the name on the account, watch the demo, then clear them.
        Never save the document.
      </p>

      <ul className="divide-y divide-border border-y border-border">
        {(teachers ?? []).map((t) => (
          <li key={t.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="font-semibold">
                {t.full_name}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  {t.vetting_state}
                </span>
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
            </div>

            <form action={setVettingState} className="flex gap-2">
              <input type="hidden" name="teacherId" value={t.id} />
              <button
                name="state"
                value="cleared"
                className="rounded-sm bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
              >
                Clear
              </button>
              <button
                name="state"
                value="suspended"
                className="rounded-sm border border-border px-3 py-1.5 text-sm"
              >
                Suspend
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
