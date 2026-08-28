import { describe, it, expect, vi } from "vitest";

// signIn's own redirect target depends on safeNext actually being called on
// the form's "next" field. safeNext has thorough unit tests, but nothing
// before this asserted the wiring — a regression that reverted signIn to an
// unconditional redirect would pass every other test in the suite.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () => ({ error: null }),
    },
  }),
}));

import { signIn } from "./actions";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

// next/navigation's redirect() works by throwing; the thrown error's `digest`
// carries the target as "NEXT_REDIRECT;<type>;<url>;<status>".
async function redirectTarget(fd: FormData): Promise<string> {
  try {
    await signIn(null, fd);
    throw new Error("signIn did not redirect");
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    const url = digest.split(";")[2];
    if (!url) throw new Error(`no redirect digest on thrown error: ${String(e)}`);
    return url;
  }
}

describe("signIn redirect target", () => {
  it("honours a legitimate next", async () => {
    const target = await redirectTarget(
      formData({ email: "a@b.com", password: "x", next: "/dashboard" })
    );
    expect(target).toBe("/dashboard");
  });

  it("falls back to /home for a blocked next", async () => {
    const target = await redirectTarget(
      formData({ email: "a@b.com", password: "x", next: "//evil.example" })
    );
    expect(target).toBe("/home");
  });

  it("falls back to /home when next is absent", async () => {
    const target = await redirectTarget(formData({ email: "a@b.com", password: "x" }));
    expect(target).toBe("/home");
  });
});
