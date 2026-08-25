const DAILY_API = "https://api.daily.co/v1";

export interface Room {
  url: string;
  name: string;
}

export async function getOrCreateRoom(
  name: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
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
    body: JSON.stringify({ name, properties: { enable_prejoin_ui: true } }),
  });
  if (!created.ok) throw new Error(`Daily create failed: ${created.status}`);
  const data = await created.json();
  return { url: data.url, name: data.name };
}
