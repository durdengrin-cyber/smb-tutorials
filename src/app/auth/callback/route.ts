import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/routes";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNext(searchParams.get("next"), "/home");

  // The OAuth path. Google sends ?code and this is the only branch that
  // existed until 2026-09-09.
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/signin?error=oauth`);
  }

  // The email path. Supabase's recovery, magic-link and confirmation mails
  // carry token_hash + type, NOT a code — so before this branch existed every
  // such link landed on a page that ignored it and the user was simply stuck.
  // There was no password reset in this product at all; the "Forgot password?"
  // control on /signin was a button with no handler.
  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    if (!error) {
      // A recovery link proves control of the mailbox, not knowledge of the
      // password — so it lands on the page that sets a new one, never on the
      // signed-in app. Any other email type is an ordinary sign-in.
      return NextResponse.redirect(
        `${origin}${type === "recovery" ? "/reset-password" : next}`
      );
    }
    // Recovery links are single-use and time-limited, and an expired one is
    // the common case, not an exotic one. Say which failed so the page can
    // offer to send another instead of showing a generic error.
    return NextResponse.redirect(`${origin}/forgot-password?error=expired`);
  }

  return NextResponse.redirect(`${origin}/signin?error=oauth`);
}
