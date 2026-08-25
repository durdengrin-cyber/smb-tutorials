const DAILY_API = "https://api.daily.co/v1";

export interface Room {
  url: string;
  name: string;
}

export async function getOrCreateRoom(
  name: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  ttlSeconds: number = 7200
): Promise<Room> {
  if (!apiKey) throw new Error("DAILY_API_KEY is not set");

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const existing = await fetchImpl(`${DAILY_API}/rooms/${name}`, { headers });
  if (existing.ok) {
    const data = await existing.json();
    return { url: data.url, name: data.name };
  }
  if (existing.status !== 404) {
    throw new Error(`Daily lookup failed: ${existing.status}`);
  }

  const created = await fetchImpl(`${DAILY_API}/rooms`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name,
      // Rooms self-expire so they don't accumulate on the Daily account.
      properties: {
        enable_prejoin_ui: true,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
    }),
  });
  if (!created.ok) throw new Error(`Daily create failed: ${created.status}`);
  const data = await created.json();
  return { url: data.url, name: data.name };
}

export const roomNameForSession = (sessionId: string) => `smb-${sessionId}`;

// Production rooms are private and reached only with a per-user meeting token
// (spec §15). This is the replacement for the M0 spike's open, client-named rooms.
export async function createSessionRoom(
  sessionId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  ttlSeconds: number = 7200
): Promise<Room> {
  if (!apiKey) throw new Error("DAILY_API_KEY is not set");

  const res = await fetchImpl(`${DAILY_API}/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: roomNameForSession(sessionId),
      properties: {
        privacy: "private",
        enable_prejoin_ui: true,
        // Comfortably longer than a 60-minute session so a call cannot die
        // mid-lesson (design spec §9).
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
    }),
  });
  if (!res.ok) throw new Error(`Daily room create failed: ${res.status}`);
  const data = await res.json();
  return { url: data.url, name: data.name };
}

export async function createMeetingToken(
  roomName: string,
  userName: string,
  isOwner: boolean,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  ttlSeconds: number = 7200
): Promise<string> {
  if (!apiKey) throw new Error("DAILY_API_KEY is not set");

  const res = await fetchImpl(`${DAILY_API}/meeting-tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName,
        is_owner: isOwner,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
    }),
  });
  if (!res.ok) throw new Error(`Daily token create failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}
