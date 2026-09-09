import { describe, it, expect, vi, beforeEach } from "vitest";
import { CONSENT_VERSION } from "@/lib/consent";

// POST and DELETE used to authenticate with a bare `supabase.auth.getUser()`
// — no requireUser(), no consent check. This route has no page render in
// front of it at all (a service worker calls it directly), so requireUser()'s
// redirect to /consent could never have protected it. requireConsentedUser()
// is the backstop for POST.
//
// DELETE is deliberately NOT gated on consent (round-2 review): it only ever
// removes the caller's own device row, so a signed-in-but-unconsented account
// must still be able to call it -- SignOutButton fires this on every
// sign-out, including for a teacher a CONSENT_VERSION bump just sent to
// /consent, and a 401 there is swallowed by that button's catch, leaving a
// stale device with an up-to-four-hour availability lease still able to push
// session requests.
const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  consentVersion: null as string | null,
  vettingState: "cleared" as string,
  rpcCalls: [] as { fn: string; args: unknown }[],
  deleteCalls: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: state.user
                  ? {
                      id: state.user.id,
                      role: "teacher",
                      full_name: "Test Teacher",
                      consent_version: state.consentVersion,
                    }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        delete: () => ({
          eq: (col: string, val: unknown) => {
            state.deleteCalls.push({ col, val });
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
    rpc: async (fn: string, args?: unknown) => {
      state.rpcCalls.push({ fn, args });
      if (fn === "my_vetting_state") {
        return { data: state.vettingState, error: null };
      }
      return { data: null, error: null };
    },
  }),
}));

import { POST, DELETE } from "./route";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "test-agent" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.user = { id: "teacher-1" };
  state.consentVersion = CONSENT_VERSION;
  state.vettingState = "cleared";
  state.rpcCalls = [];
  state.deleteCalls = [];
});

describe("POST /api/devices consent gate", () => {
  it("refuses an unconsented account", async () => {
    state.consentVersion = null;
    const res = await POST(jsonRequest({ endpoint: "e", keys: { p256dh: "p", auth: "a" } }));
    expect(res.status).toBe(401);
    // getIdentity() calls my_vetting_state() even for an unconsented account,
    // but the consent gate blocks before reaching register_device.
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].fn).toBe("my_vetting_state");
  });

  it("lets a consented account register a device", async () => {
    const res = await POST(jsonRequest({ endpoint: "e", keys: { p256dh: "p", auth: "a" } }));
    expect(res.status).toBe(200);
    // getIdentity() calls my_vetting_state(), then register_device().
    expect(state.rpcCalls).toHaveLength(2);
    expect(state.rpcCalls[0].fn).toBe("my_vetting_state");
    expect(state.rpcCalls[1].fn).toBe("register_device");
  });
});

describe("DELETE /api/devices auth (not consent) gate", () => {
  it("refuses a signed-out caller", async () => {
    state.user = null;
    const res = await DELETE(jsonRequest({ endpoint: "e" }));
    expect(res.status).toBe(401);
    expect(state.deleteCalls).toHaveLength(0);
  });

  // The behavior round 2 introduced: DELETE must NOT 401 an unconsented
  // account the way POST does. If someone "helpfully" re-gates this for
  // consistency with POST, this is the test that catches it.
  it("lets an unconsented account remove a device", async () => {
    state.consentVersion = null;
    const res = await DELETE(jsonRequest({ endpoint: "e" }));
    expect(res.status).toBe(200);
    expect(state.deleteCalls).toHaveLength(1);
  });

  it("lets a consented account remove a device", async () => {
    const res = await DELETE(jsonRequest({ endpoint: "e" }));
    expect(res.status).toBe(200);
    expect(state.deleteCalls).toHaveLength(1);
  });
});

describe("POST vs DELETE consent asymmetry", () => {
  // Pins the asymmetry itself, in one place, so it reads as deliberate design
  // rather than as two tests that happen to disagree: the same unconsented
  // account is refused by POST (registering a device is a real action) and
  // let through by DELETE (removing your own device is not).
  it("refuses an unconsented account's POST but allows its DELETE", async () => {
    state.consentVersion = null;

    const postRes = await POST(jsonRequest({ endpoint: "e", keys: { p256dh: "p", auth: "a" } }));
    expect(postRes.status).toBe(401);
    // getIdentity() calls my_vetting_state() after reading the profile,
    // even for an unconsented account, so 1 RPC call is expected.
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].fn).toBe("my_vetting_state");

    state.rpcCalls = [];
    const deleteRes = await DELETE(jsonRequest({ endpoint: "e" }));
    expect(deleteRes.status).toBe(200);
    expect(state.deleteCalls).toHaveLength(1);
  });
});
