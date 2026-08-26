import { ROOM_GRACE_MINUTES, SESSION_DURATION_MINUTES } from "./session";

const DAILY_API = "https://api.daily.co/v1";

// A room outlives the session it hosts by the grace window and no more, so
// the room itself caps the call even if a client clock never reaches zero.
const DEFAULT_SESSION_TTL =
  (SESSION_DURATION_MINUTES + ROOM_GRACE_MINUTES) * 60;

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
  ttlSeconds: number = DEFAULT_SESSION_TTL
): Promise<Room> {
  if (!apiKey) throw new Error("DAILY_API_KEY is not set");

  const name = roomNameForSession(sessionId);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const res = await fetchImpl(`${DAILY_API}/rooms`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name,
      properties: {
        privacy: "private",
        enable_prejoin_ui: true,
        // Longer than the session so a call cannot die mid-lesson (design
        // spec §9), but not so long that the room stops being a cap.
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
    }),
  });
  if (res.ok) {
    const data = await res.json();
    return { url: data.url, name: data.name };
  }

  // The room name is derived from the session id, so Daily rejects the second
  // attempt for the same session. Accepting is retryable — the room can
  // outlive a failed write of the row — so a name clash resolves to the room
  // that already exists rather than stranding the session forever.
  if (res.status === 400 || res.status === 409) {
    const existing = await fetchImpl(`${DAILY_API}/rooms/${name}`, { headers });
    if (existing.ok) {
      const data = await existing.json();
      return { url: data.url, name: data.name };
    }
  }
  throw new Error(`Daily room create failed: ${res.status}`);
}

export async function createMeetingToken(
  roomName: string,
  userName: string,
  isOwner: boolean,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  ttlSeconds: number = DEFAULT_SESSION_TTL
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
