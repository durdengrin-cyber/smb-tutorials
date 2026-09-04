import { describe, it, expect, vi, beforeEach } from "vitest";

// signIn's own redirect target depends on safeNext actually being called on
// the form's "next" field. safeNext has thorough unit tests, but nothing
// before this asserted the wiring — a regression that reverted signIn to an
// unconditional redirect would pass every other test in the suite.
const state = vi.hoisted(() => ({
  signUpCalls: [] as { email: string; options?: { data?: Record<string, unknown> } }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () => ({ error: null }),
      signUp: async (args: { email: string; options?: { data?: Record<string, unknown> } }) => {
        state.signUpCalls.push(args);
        return { data: { user: { id: "new-student-id" } }, error: null };
      },
    },
  }),
}));

import { signIn, signUpStudent } from "./actions";
import { CONSENT_VERSION } from "@/lib/consent";

beforeEach(() => {
  state.signUpCalls = [];
});

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

describe("signUpStudent — learner fields reach signup metadata", () => {
  it("passes the learner fields into signup metadata", async () => {
    const fd = new FormData();
    fd.set("fullName", "Asha Rao");
    fd.set("email", "asha@example.com");
    fd.set("password", "password123");
    fd.set("confirmPassword", "password123");
    fd.set("consent", "yes");
    fd.set("learnerFirstName", "Ravi");
    fd.set("learnerGrade", "9th");

    await expect(signUpStudent(null, fd)).rejects.toThrow("NEXT_REDIRECT");

    const meta = state.signUpCalls[0].options?.data ?? {};
    expect(meta.learner_first_name).toBe("Ravi");
    expect(meta.learner_grade).toBe("9th");
    expect(meta.consent_version).toBe(CONSENT_VERSION);
  });
});
