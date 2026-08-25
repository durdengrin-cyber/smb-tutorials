import { NextRequest, NextResponse } from "next/server";
import { getOrCreateRoom } from "@/lib/daily";

export async function POST(req: NextRequest) {
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
