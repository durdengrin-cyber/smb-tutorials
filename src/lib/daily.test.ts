import { describe, it, expect, vi } from "vitest";
import { getOrCreateRoom } from "@/lib/daily";

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

  it("throws when the api key is missing", async () => {
    await expect(
      getOrCreateRoom("x", "", vi.fn() as unknown as typeof fetch)
    ).rejects.toThrow("DAILY_API_KEY is not set");
  });
});
