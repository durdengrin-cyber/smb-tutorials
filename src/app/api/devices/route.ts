import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The service worker cannot call a Server Action, so registration lands here.
// It is a thin shell over register_device, which does the real work under
// security definer (spec §4.3).
export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "incomplete subscription" }, { status: 400 });
  }

  const { error } = await supabase.rpc("register_device", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: request.headers.get("user-agent") ?? null,
  });

  if (error) {
    console.error("[api/devices] register_device failed", error);
    return NextResponse.json({ error: "could not register" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.endpoint) {
    return NextResponse.json({ error: "no endpoint" }, { status: 400 });
  }
  // RLS scopes this to the caller's own rows, so an endpoint belonging to
  // someone else simply matches nothing.
  const { error } = await supabase
    .from("teacher_devices").delete().eq("endpoint", body.endpoint);
  if (error) return NextResponse.json({ error: "could not remove" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
