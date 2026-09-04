import { describe, it, expect, vi, beforeEach } from "vitest";

const send = vi.fn();
const deleted: string[] = [];
const updated: string[] = [];
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
// Every row written to notification_events. This is the observability road:
// when a teacher asks why their phone was silent, these rows are the answer,
// so the tests assert on them the same way they assert on delivery.
const logged: Record<string, unknown>[] = [];
let logInsertError: { message: string } | null = null;
// What the device SELECT resolves to, and what the query builder was asked to
// do to get there — the cap is a security control, so the test has to see the
// call, not just the rows.
let devices = [
  { id: "d1", endpoint: "e1", p256dh: "k1", auth: "a1" },
  { id: "d2", endpoint: "e2", p256dh: "k2", auth: "a2" },
];
let selectChain: { order?: [string, unknown]; limit?: number } = {};

vi.mock("./index", async () => {
  const actual = await vi.importActual<typeof import("./index")>("./index");
  return { ...actual, getNotificationPort: () => ({ transport: "webpush", send }) };
});

vi.mock("@/lib/supabase/admin", () => ({
  createDispatchClient: () => ({
    from: () => ({
      select: () => ({
        // Thenable at every link so the chain can be awaited wherever it ends,
        // rather than pinning the exact builder shape the implementation uses.
        eq: () => {
          const result = { data: devices, error: null };
          const chain = {
            order: (col: string, opts: unknown) => {
              selectChain.order = [col, opts];
              return chain;
            },
            limit: (n: number) => {
              selectChain.limit = n;
              return chain;
            },
            then: (res: (v: typeof result) => unknown) => res(result),
          };
          return chain;
        },
      }),
      delete: () => ({ in: async (_c: string, ids: string[]) => { deleted.push(...ids); return { error: null }; } }),
      update: () => ({ in: async (_c: string, ids: string[]) => { updated.push(...ids); return { error: null }; } }),
      insert: async (rows: Record<string, unknown>[]) => {
        logged.push(...rows);
        return { error: logInsertError };
      },
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { error: null };
    },
  }),
}));

import { notifyTeacherOfRequest, MAX_DEVICES_PER_TEACHER } from "./dispatch";

beforeEach(() => {
  send.mockReset();
  deleted.length = 0;
  updated.length = 0;
  rpcCalls.length = 0;
  logged.length = 0;
  logInsertError = null;
  selectChain = {};
  devices = [
    { id: "d1", endpoint: "e1", p256dh: "k1", auth: "a1" },
    { id: "d2", endpoint: "e2", p256dh: "k2", auth: "a2" },
  ];
});

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

  // Spec §8. Without this the counter is written in exactly one place in the
  // whole system — reset to 0 on re-registration — so a subscription failing
  // persistently with anything other than 404/410 is never pruned AND never
  // told apart from a healthy one, while available_teachers keeps publishing
  // has_device = true for a phone that cannot be woken.
  it("records the failed device ids so failure_count can be incremented", async () => {
    send
      .mockResolvedValueOnce({ ok: false, gone: false, status: 500, error: "boom" })
      .mockResolvedValueOnce({ ok: true });

    await notifyTeacherOfRequest("t1", "Aditya", "Mathematics");

    // The id must reach the UPDATE, not merely be counted locally.
    expect(updated).toEqual(["d1"]);
    const call = rpcCalls.find((c) => c.fn === "record_device_results");
    expect(call).toBeDefined();
    expect(call!.args).toEqual({ p_ok: ["d2"], p_failed: ["d1"] });
  });

  // A delivery that succeeded clears the streak and stamps last_ok_at, which
  // nothing wrote before.
  it("records the succeeded device ids", async () => {
    send.mockResolvedValue({ ok: true });

    await notifyTeacherOfRequest("t1", "Aditya", "Mathematics");

    const call = rpcCalls.find((c) => c.fn === "record_device_results");
    expect(call!.args).toEqual({ p_ok: ["d1", "d2"], p_failed: [] });
  });

  // A pruned (404/410) device is deleted, so stamping a result on it would
  // be writing to a row that no longer exists.
  it("does not record a result for a device it just pruned", async () => {
    send.mockResolvedValue({ ok: false, gone: true, status: 410, error: "gone" });

    await notifyTeacherOfRequest("t1", "Aditya", "Mathematics");

    expect(deleted).toEqual(["d1", "d2"]);
    expect(rpcCalls).toHaveLength(0);
  });

  // register_device caps nothing, so the row count for one teacher is
  // caller-controlled: a teacher account plus a student account is enough to
  // register N endpoints and make every session request fan out to N outbound
  // HTTPS calls inside after(), which Vercel bills by invocation duration.
  it("caps the fan-out and takes the newest devices", async () => {
    send.mockResolvedValue({ ok: true });

    await notifyTeacherOfRequest("t1", "Aditya", "Mathematics");

    expect(selectChain.limit).toBe(MAX_DEVICES_PER_TEACHER);
    expect(MAX_DEVICES_PER_TEACHER).toBeLessThanOrEqual(50);
    expect(selectChain.order).toEqual(["created_at", { ascending: false }]);
  });

  // Spec §5.1 / §8 observability. Before this, a dispatch that failed left a
  // console.error in a Vercel log nobody watches, and 0012's failure_count
  // was written but never read back — so the likeliest support question in a
  // trial ("it didn't ring") had no answer at all.
  describe("delivery log", () => {
    it("records one row per device, with the outcome of each", async () => {
      send
        .mockResolvedValueOnce({ ok: false, gone: true, status: 410, error: "gone" })
        .mockResolvedValueOnce({ ok: true });

      await notifyTeacherOfRequest("t1", "Aditya", "Mathematics", "sess-1");

      expect(logged).toHaveLength(2);
      expect(logged).toContainEqual(expect.objectContaining({
        session_id: "sess-1", teacher_id: "t1", device_id: "d1",
        outcome: "gone", status_code: 410,
      }));
      expect(logged).toContainEqual(expect.objectContaining({
        device_id: "d2", outcome: "sent",
      }));
    });

    // The distinction that makes the log worth having: "we never tried"
    // must not look like "we tried and it failed".
    it("records no_devices when the teacher has none", async () => {
      devices = [];

      await notifyTeacherOfRequest("t1", "Aditya", "Mathematics", "sess-2");

      expect(logged).toEqual([
        expect.objectContaining({ outcome: "no_devices", device_id: null, session_id: "sess-2" }),
      ]);
      expect(send).not.toHaveBeenCalled();
    });

    // A throw is usually OUR fault — a missing VAPID key throws exactly here —
    // and must be distinguishable from a push service saying no.
    it("records a throw separately from a refusal, keeping the reason", async () => {
      send
        .mockRejectedValueOnce(new Error("VAPID public key is missing"))
        .mockResolvedValueOnce({ ok: false, gone: false, status: 503, error: "unavailable" });

      await notifyTeacherOfRequest("t1", "Aditya", "Mathematics", "sess-3");

      expect(logged).toContainEqual(expect.objectContaining({
        device_id: "d1", outcome: "threw",
        detail: expect.stringContaining("VAPID"),
      }));
      expect(logged).toContainEqual(expect.objectContaining({
        device_id: "d2", outcome: "failed", status_code: 503,
      }));
    });

    // Logging is the observability road, not the delivery road. A failure to
    // write the log must never cost a teacher the notification the log exists
    // to explain.
    it("still delivers when the log write itself fails", async () => {
      logInsertError = { message: "log table missing" };
      send.mockResolvedValue({ ok: true });

      const result = await notifyTeacherOfRequest("t1", "Aditya", "Mathematics", "sess-4");

      expect(result).toEqual({ sent: 2, pruned: 0 });
    });
  });
});
