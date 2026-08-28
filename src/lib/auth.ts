import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveHome, signInRedirect, type Role } from "@/lib/routes";

export interface Identity {
  userId: string;
  role: Role;
  fullName: string;
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
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", user.id)
    .single();

  if (!profile) return null;
  return {
    userId: profile.id,
    role: profile.role as Role,
    fullName: profile.full_name,
  };
});

async function currentPath(): Promise<string> {
  const h = await headers();
  return h.get("x-pathname") ?? "/";
}

export async function requireUser(): Promise<Identity> {
  const identity = await getIdentity();
  if (!identity) redirect(signInRedirect(await currentPath()));
  return identity;
}

// Redirects rather than 404s: a student who lands on a teacher URL is helped,
// not stonewalled. This is a UX choice — RLS is what protects the data.
export async function requireRole(role: Role): Promise<Identity> {
  const identity = await requireUser();
  if (identity.role !== role) redirect(resolveHome(identity.role));
  return identity;
}
