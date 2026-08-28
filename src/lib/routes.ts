export type Role = "student" | "teacher" | "admin";

// One place decides where a signed-in person belongs. Cycle 2 replaces the
// student branch with a real dashboard and nothing else changes.
export function resolveHome(role: Role): string {
  switch (role) {
    case "teacher":
      return "/dashboard";
    case "admin":
      return "/admin";
    default:
      return "/find";
  }
}

export function signInRedirect(pathname: string): string {
  if (pathname === "/signin") return "/signin";
  return `/signin?next=${encodeURIComponent(pathname)}`;
}

// `next` reaches us from a query string, so it is attacker-controlled, and a
// redirect built from user input is an open redirect.
//
// Do NOT hand-roll this with prefix checks. An earlier version tested for "//"
// and "/\\" and was defeated four ways, because the WHATWG URL parser strips
// ASCII tab/CR/LF from ANYWHERE in the input before parsing, and then
// normalises backslashes to slashes. "/\t/evil.example" becomes
// "//evil.example" — protocol-relative, off-site — and "/\t\\evil.example"
// gets there by both routes at once. Enumerating bad characters is a losing
// game against a parser that rewrites its input.
//
// Instead resolve against a placeholder origin using the same parser the
// browser will use, and reject anything that escapes it. Returning the parsed
// components rather than the raw input also guarantees that no control
// character survives into a Location header.
const SAFE_NEXT_BASE = "https://smb.invalid";

// `next` is typed `unknown` rather than `string | null` on purpose:
// `FormData.get()` returns `FormDataEntryValue | null`, which can be a `File`.
// A raw POST naming `next` as a file part would otherwise reach `.startsWith`
// and throw a 500. The `typeof` guard closes that at the root, so no call
// site needs a cast.
export function safeNext(next: unknown, fallback: string): string {
  if (typeof next !== "string" || !next) return fallback;
  if (!next.startsWith("/")) return fallback;
  try {
    const url = new URL(next, SAFE_NEXT_BASE);
    if (url.origin !== SAFE_NEXT_BASE) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

// Google sends no role, so handle_new_user() creates every OAuth account as a
// student (migration 0001). A brand-new account that arrived with teacher
// intent may complete teacher onboarding; an account with history may not —
// changing the role of an account that has already been used is an admin
// action, and admin is cycle 3. Spec §5.1.
export function canBecomeTeacher(account: {
  role: Role;
  sessionCount: number;
  subjectCount: number;
}): boolean {
  return account.role === "student" && account.sessionCount === 0 && account.subjectCount === 0;
}
