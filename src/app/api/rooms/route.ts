import { NextRequest, NextResponse } from "next/server";
import { getOrCreateRoom } from "@/lib/daily";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  // Interim hardening (spec §15): anonymous callers could mint Daily rooms on
  // our account. The full close — server-side minting on an authenticated
  // teacher-accept, tied to a session row, with scoped join tokens — is M2.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === "string" && body.name.length > 0
      ? body.name
      : `smb-${crypto.randomUUID().slice(0, 8)}`;
  try {
    const room = await getOrCreateRoom(name, process.env.DAILY_API_KEY ?? "");
    return NextResponse.json(room);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
