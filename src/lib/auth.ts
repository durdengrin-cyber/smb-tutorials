import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveHome, signInRedirect, type Role } from "@/lib/routes";
import { needsConsent } from "@/lib/consent";

export interface Identity {
  userId: string;
  role: Role;
  fullName: string;
  consentVersion: string | null;
}

// Cached for the lifetime of one request, so a layout, a nested layout and the
// page it wraps share a single profile read instead of three.
export const getIdentity = cache(async (): Promise<Identity | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // profiles.role is authoritative. user_metadata.role is only the seed that
  // handle_new_user() reads at signup (migration 0001) — never read it here.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, full_name, consent_version")
    .eq("id", user.id)
    .single();

  // PGRST116 ("no rows") is the genuine "no profile" case — .single() reports
  // it as an error even though nothing went wrong. Any other error is a real
  // query failure (e.g. a transient Supabase outage) and must not be treated
  // the same as "no profile", or a student mid-payment gets silently signed
  // out. Throw so the nearest error boundary catches it instead.
  if (error && error.code !== "PGRST116") {
    console.error("getIdentity: profile query failed", error);
    throw new Error("Failed to load user profile");
  }

  if (!profile) return null;
  return {
    userId: profile.id,
    role: profile.role as Role,
    fullName: profile.full_name,
    consentVersion: profile.consent_version as string | null,
  };
});

async function currentPath(): Promise<string> {
  const h = await headers();
  return h.get("x-pathname") ?? "/";
}

export async function requireUser(): Promise<Identity> {
  const identity = await getIdentity();
  if (!identity) redirect(signInRedirect(await currentPath()));
  // Every authenticated page passes through here, so this is the only place
  // the question has to be asked. Spec §7 names the OAuth callback; that would
  // close Google alone and leave the next entry path to remember on its own.
  if (needsConsent(identity) && (await currentPath()) !== "/consent") {
    redirect("/consent");
  }
  return identity;
}

// Redirects rather than 404s: a student who lands on a teacher URL is helped,
// not stonewalled. This is a UX choice — RLS is what protects the data.
export async function requireRole(role: Role): Promise<Identity> {
  const identity = await requireUser();
  if (identity.role !== role) redirect(resolveHome(identity.role));
  return identity;
}
