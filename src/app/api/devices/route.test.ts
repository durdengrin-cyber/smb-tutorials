import { describe, it, expect, vi, beforeEach } from "vitest";
import { CONSENT_VERSION } from "@/lib/consent";

// POST and DELETE used to authenticate with a bare `supabase.auth.getUser()`
// — no requireUser(), no consent check. This route has no page render in
// front of it at all (a service worker calls it directly), so requireUser()'s
// redirect to /consent could never have protected it. requireConsentedUser()
// is the backstop; these tests are what would have caught its absence.
const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  consentVersion: null as string | null,
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
    rpc: async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args });
      return { error: null };
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
  state.rpcCalls = [];
  state.deleteCalls = [];
});

describe("POST /api/devices consent gate", () => {
  it("refuses an unconsented account", async () => {
    state.consentVersion = null;
    const res = await POST(jsonRequest({ endpoint: "e", keys: { p256dh: "p", auth: "a" } }));
    expect(res.status).toBe(401);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("lets a consented account register a device", async () => {
    const res = await POST(jsonRequest({ endpoint: "e", keys: { p256dh: "p", auth: "a" } }));
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(1);
  });
});

describe("DELETE /api/devices consent gate", () => {
  it("refuses an unconsented account", async () => {
    state.consentVersion = null;
    const res = await DELETE(jsonRequest({ endpoint: "e" }));
    expect(res.status).toBe(401);
    expect(state.deleteCalls).toHaveLength(0);
  });

  it("lets a consented account remove a device", async () => {
    const res = await DELETE(jsonRequest({ endpoint: "e" }));
    expect(res.status).toBe(200);
    expect(state.deleteCalls).toHaveLength(1);
  });
});
