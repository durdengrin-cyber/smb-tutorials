import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { consentRedirect, resolveHome, signInRedirect, type Role } from "@/lib/routes";
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

// x-pathname (proxy-session.ts) carries the query string too, so comparing
// the raw value is query-sensitive: a stray "/consent?next=..." would not
// match "/consent" and the gate below would redirect the consent page to
// itself. Harmless today only because that fails closed; the day something
// links /consent with a query string this is what stops the loop.
async function currentPathname(): Promise<string> {
  return (await currentPath()).split("?")[0];
}

export async function requireUser(): Promise<Identity> {
  const identity = await getIdentity();
  if (!identity) redirect(signInRedirect(await currentPath()));
  // Every authenticated page passes through here, so this is the only place
  // the question has to be asked. Spec §7 names the OAuth callback; that would
  // close Google alone and leave the next entry path to remember on its own.
  if (needsConsent(identity) && (await currentPathname()) !== "/consent") {
    // Carries where they were going. Sanitised on the way back out by
    // safeNext in the consent action, not here — this value is our own
    // header, but it is the consent form that hands it to a redirect.
    redirect(consentRedirect(await currentPath()));
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

// requireUser()'s redirect protects page renders only. A Server Action is
// resolved by an action ID out of an app-wide manifest and Next runs it
// BEFORE any page renders — there is no per-route check on that dispatch
// path, and action IDs are readable from public /_next/static chunks. So an
// unconsented account can call any action directly (e.g. by POSTing to
// /consent, the one path requireUser() exempts from its own redirect, with a
// Next-Action header naming a different action) and requireUser()'s gate
// never runs at all.
//
// This is the backstop for that path: every authenticated Server Action and
// Route Handler must call this instead of a bare `supabase.auth.getUser()`.
// It refuses — returns null — rather than redirecting, because a redirect
// thrown from inside an action has no guaranteed page render on the other
// end to land on; the caller decides what refusal looks like in its own
// return shape, exactly as it already does for "not signed in".
//
// "Not signed in" and "signed in but hasn't consented" collapse to the same
// null on purpose: every call site already treats not-signed-in as a single
// refusal case, and which of the two applies is a /consent-page concern, not
// an action's.
export async function requireConsentedUser(): Promise<Identity | null> {
  const identity = await getIdentity();
  if (!identity || needsConsent(identity)) return null;
  return identity;
}

/**
 * The same gate, but saying WHICH refusal applied.
 *
 * The collapse above is right for a call site that only has to refuse. It is
 * wrong for one whose answer reaches a client that must then do something
 * about it: CONSENT_VERSION 2026-09-10-recording put every signed-in teacher
 * behind the consent gate at once, and "Sign in first." to someone signed in
 * is both untrue and unactionable — there is nothing on a sign-in page for
 * them to do. A client receiving `needs_consent` can send them to /consent,
 * which is the only thing that clears it.
 */
export async function consentGate(): Promise<
  { identity: Identity } | { refusal: "signed_out" | "needs_consent" }
> {
  const identity = await getIdentity();
  if (!identity) return { refusal: "signed_out" };
  if (needsConsent(identity)) return { refusal: "needs_consent" };
  return { identity };
}
