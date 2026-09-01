import { describe, it, expect, vi, beforeEach } from "vitest";

const send = vi.fn();
const deleted: string[] = [];

vi.mock("./index", async () => {
  const actual = await vi.importActual<typeof import("./index")>("./index");
  return { ...actual, getNotificationPort: () => ({ transport: "webpush", send }) };
});

vi.mock("@/lib/supabase/admin", () => ({
  createDispatchClient: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({
          data: [
            { id: "d1", endpoint: "e1", p256dh: "k1", auth: "a1" },
            { id: "d2", endpoint: "e2", p256dh: "k2", auth: "a2" },
          ],
          error: null,
        }),
      }),
      delete: () => ({ in: async (_c: string, ids: string[]) => { deleted.push(...ids); return { error: null }; } }),
      update: () => ({ in: async () => ({ error: null }) }),
    }),
  }),
}));

import { notifyTeacherOfRequest } from "./dispatch";

beforeEach(() => { send.mockReset(); deleted.length = 0; });

describe("notifyTeacherOfRequest", () => {
  it("sends to every registered device", async () => {
    send.mockResolvedValue({ ok: true });
    const result = await notifyTeacherOfRequest("t1", "Aditya", "Mathematics");
    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 2, pruned: 0 });
  });

  it("prunes only the devices the service says are gone", async () => {
    send
      .mockResolvedValueOnce({ ok: false, gone: true, status: 410, error: "gone" })
      .mockResolvedValueOnce({ ok: false, gone: false, status: 500, error: "boom" });
    const result = await notifyTeacherOfRequest("t1", "Aditya", "Mathematics");
    expect(deleted).toEqual(["d1"]);
    expect(result).toEqual({ sent: 0, pruned: 1 });
  });

  // One dead device must not stop a live one from ringing. The roads are
  // independent by design and so are the devices on one road.
  it("keeps sending after one device throws", async () => {
    send
      .mockRejectedValueOnce(new Error("unexpected"))
      .mockResolvedValueOnce({ ok: true });
    const result = await notifyTeacherOfRequest("t1", "Aditya", "Mathematics");
    expect(result.sent).toBe(1);
  });
});
