// Throwaway accounts for the live probes.
//
// Why this exists: two probes need to write as a REAL signed-in user, not as
// the service role, because migration 0005's trigger branches on auth.uid().
// The `cancelled` gate is the clearest case — it reads
// `uid is distinct from old.student_id` with NO service-role escape, unlike
// the payment-column gate, so the service role genuinely cannot stand in for
// a student. Only a real student JWT can prove that write is still permitted.
//
// Every account here is created, used and deleted inside one script run. The
// password is generated at runtime and never written down, never logged and
// never leaves the process — so no probe depends on a standing credential
// that has to be rotated later. Deleting the auth user cascades to
// public.profiles and to any sessions it took part in (both are
// `on delete cascade`), and each probe asserts the profiles count returned
// to its baseline, the same way it already asserts the sessions count.
import fs from "node:fs";
import crypto from "node:crypto";

// Skips comments. The original one-liner took any line containing "=", which
// was fine while .env.local held only assignments — but the file now carries
// commented-out examples (`# RAZORPAY_KEY_ID=rzp_test_`), and those became
// junk keys like "# RAZORPAY_KEY_ID". Harmless today, because a leading "#"
// can never collide with a real name; a trap the first time someone writes
// `#PAYMENT_WEBHOOK_SECRET=old-value` above the live one and wonders which
// won. Ignoring comments is what every dotenv parser does, including the one
// Next.js reads this same file with.
export function readEnv() {
  return Object.fromEntries(
    fs.readFileSync(".env.local", "utf8").split("\n")
      .filter((l) => !l.trim().startsWith("#") && l.includes("="))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
  );
}

export const jsonHeaders = (h) => ({ ...h, "content-type": "application/json" });
export const serviceHeaders = (env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
});

// PostgREST returns 204 with no body unless asked for the row back.
export const serviceRepr = (env) => ({ ...serviceHeaders(env), prefer: "return=representation" });

// The headers a signed-in browser session would send: the ANON key plus that
// user's own access token. This is the exact path the app uses, and the only
// path that makes auth.uid() non-null inside the trigger.
export const userHeaders = (env, token) =>
  jsonHeaders({
    apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    prefer: "return=representation",
  });

// A real-looking domain on purpose: the public /auth/v1/signup endpoint
// rejects @example.com. The admin API does not validate it, but keeping one
// convention means a leftover row is recognisable as ours either way.
const throwawayEmail = () => `probe-${crypto.randomUUID()}@smbtutorials.in`;

// email_confirm: true both marks the address confirmed and suppresses the
// confirmation mail, so creating these sends nothing to anyone.
export async function createThrowawayUser(env, { role, fullName, hourlyRate = null }) {
  const email = throwawayEmail();
  const password = crypto.randomBytes(24).toString("base64url");

  const created = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: jsonHeaders(serviceHeaders(env)),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role },
    }),
  });
  const user = await created.json();
  if (!created.ok || !user.id) {
    throw new Error(`could not create the throwaway ${role} (setup, not the test): ${JSON.stringify(user)}`);
  }

  // handle_new_user() copies role/full_name/email off the metadata but knows
  // nothing about hourly_rate, and the session insert trigger refuses a
  // teacher whose rate is null. Set it here, before anything seeds a row.
  if (hourlyRate !== null) {
    const rate = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
      method: "PATCH",
      headers: jsonHeaders(serviceRepr(env)),
      body: JSON.stringify({ hourly_rate: hourlyRate }),
    });
    if (!rate.ok) {
      await deleteThrowawayUser(env, user.id);
      throw new Error(`could not set the throwaway teacher's rate (setup, not the test): ${await rate.text()}`);
    }
  }

  const signedIn = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: jsonHeaders({ apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }),
    body: JSON.stringify({ email, password }),
  });
  const session = await signedIn.json();
  if (!signedIn.ok || !session.access_token) {
    await deleteThrowawayUser(env, user.id);
    throw new Error(`could not sign in the throwaway ${role} (setup, not the test): ${JSON.stringify(session)}`);
  }

  return { id: user.id, email, role, token: session.access_token };
}

// Best-effort by design: this runs in a `finally`, so it must never throw and
// mask the real failure that sent us there. It returns false instead, and the
// caller prints the id so a human can remove it by hand.
export async function deleteThrowawayUser(env, id) {
  if (!id) return true;
  try {
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: serviceHeaders(env),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function profileCount(env) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?select=id`, {
    headers: serviceHeaders(env),
  });
  return (await res.json()).length;
}
