import { describe, it, expect, vi } from "vitest";
import { getOrCreateRoom, createSessionRoom, createMeetingToken } from "@/lib/daily";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("getOrCreateRoom", () => {
  it("returns the existing room when lookup succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { url: "https://x.daily.co/abc", name: "abc" })
      );
    const room = await getOrCreateRoom("abc", "key", fetchMock as unknown as typeof fetch);
    expect(room).toEqual({ url: "https://x.daily.co/abc", name: "abc" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates the room when lookup returns 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { url: "https://x.daily.co/new", name: "new" })
      );
    const room = await getOrCreateRoom("new", "key", fetchMock as unknown as typeof fetch);
    expect(room).toEqual({ url: "https://x.daily.co/new", name: "new" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sets a self-expiry (exp) on created rooms", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { url: "https://x.daily.co/new", name: "new" })
      );
    await getOrCreateRoom("new", "key", fetchMock as unknown as typeof fetch, 3600);
    const createCall = fetchMock.mock.calls[1];
    const body = JSON.parse((createCall[1] as RequestInit).body as string);
    expect(body.properties.exp).toBeTypeOf("number");
    expect(body.properties.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("throws when the api key is missing", async () => {
    await expect(
      getOrCreateRoom("x", "", vi.fn() as unknown as typeof fetch)
    ).rejects.toThrow("DAILY_API_KEY is not set");
  });
});

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

describe("createSessionRoom", () => {
  it("creates a PRIVATE room named for the session, with an expiry", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = init;
      return okJson({ url: "https://smbtutorials.daily.co/smb-s1", name: "smb-s1" });
    }) as unknown as typeof fetch;

    const room = await createSessionRoom("s1", "key", fetchImpl, 7200);

    expect(room).toEqual({ url: "https://smbtutorials.daily.co/smb-s1", name: "smb-s1" });
    const body = JSON.parse(String(captured?.body));
    expect(body.name).toBe("smb-s1");
    expect(body.properties.privacy).toBe("private");
    expect(body.properties.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("falls back to the existing room when the name is already taken", async () => {
    // Accept minted the room, then the row write failed. The teacher retries;
    // Daily rejects the duplicate name. That must not strand the session.
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if ((init?.method ?? "GET") === "POST") {
        return { ok: false, status: 400, json: async () => ({}) } as Response;
      }
      return okJson({ url: "https://smbtutorials.daily.co/smb-s1", name: "smb-s1" });
    }) as unknown as typeof fetch;

    const room = await createSessionRoom("s1", "key", fetchImpl);

    expect(room.name).toBe("smb-s1");
    expect(calls[0]).toContain("POST");
    expect(calls[1]).toContain("/rooms/smb-s1");
  });

  it("still throws when the room genuinely cannot be created", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 401, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    await expect(createSessionRoom("s1", "key", fetchImpl)).rejects.toThrow("401");
  });

  it("throws without an API key", async () => {
    await expect(createSessionRoom("s1", "")).rejects.toThrow("DAILY_API_KEY");
  });
});

describe("createMeetingToken", () => {
  it("requests a token scoped to the room and user", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = init;
      return okJson({ token: "tok_abc" });
    }) as unknown as typeof fetch;

    const token = await createMeetingToken("smb-s1", "Asha", false, "key", fetchImpl, 3600);

    expect(token).toBe("tok_abc");
    const body = JSON.parse(String(captured?.body));
    expect(body.properties.room_name).toBe("smb-s1");
    expect(body.properties.user_name).toBe("Asha");
    expect(body.properties.is_owner).toBe(false);
  });

  it("surfaces a Daily failure", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 401, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    await expect(createMeetingToken("r", "u", false, "key", fetchImpl)).rejects.toThrow("401");
  });
});
