import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendNotification } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification },
}));

import { webPushPort } from "./webpush";
import { requestPayload } from "./payload";

const sub = { endpoint: "https://push.example/1", p256dh: "k", auth: "a" };
const payload = requestPayload("Aditya", "Mathematics");

beforeEach(() => sendNotification.mockReset());

describe("webPushPort.send", () => {
  it("reports success", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const port = webPushPort("pub", "priv", "mailto:ops@smbtutorials.in");
    expect(await port.send(sub, payload)).toEqual({ ok: true });
  });

  // The single most consequential mapping in the adapter. 404/410 is the ONLY
  // death signal a subscription has, so a wrong verdict here either deletes a
  // live device on a transient blip or keeps a dead one forever.
  it.each([404, 410])("treats %i as gone", async (statusCode) => {
    sendNotification.mockImplementationOnce(async () => { throw { statusCode }; });
    const port = webPushPort("pub", "priv", "mailto:ops@smbtutorials.in");
    const result = await port.send(sub, payload);
    expect(result).toMatchObject({ ok: false, gone: true, status: statusCode });
  });

  it.each([429, 500, 502])("treats %i as transient, not gone", async (statusCode) => {
    sendNotification.mockImplementationOnce(async () => { throw { statusCode }; });
    const port = webPushPort("pub", "priv", "mailto:ops@smbtutorials.in");
    const result = await port.send(sub, payload);
    expect(result).toMatchObject({ ok: false, gone: false, status: statusCode });
  });

  it("treats a network throw as transient", async () => {
    sendNotification.mockImplementationOnce(async () => { throw new Error("ECONNRESET"); });
    const port = webPushPort("pub", "priv", "mailto:ops@smbtutorials.in");
    const result = await port.send(sub, payload);
    expect(result).toMatchObject({ ok: false, gone: false });
  });

  // razorpayPort refuses to start without its webhook secret rather than
  // failing at the first charge. Same rule here.
  it("refuses to construct without a key", () => {
    expect(() => webPushPort("", "priv", "mailto:ops@smbtutorials.in")).toThrow();
    expect(() => webPushPort("pub", "", "mailto:ops@smbtutorials.in")).toThrow();
  });
});

describe("requestPayload", () => {
  it("names the student and the subject, and uses a replacing tag", () => {
    const p = requestPayload("Aditya", "Mathematics");
    expect(p.body).toContain("Aditya");
    expect(p.body).toContain("Mathematics");
    expect(p.url).toBe("/dashboard");
    // A fixed tag so a second request REPLACES the first rather than
    // stacking two notifications the teacher must dismiss separately.
    expect(p.tag).toBe("session-request");
  });
});
