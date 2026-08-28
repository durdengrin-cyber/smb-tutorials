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

// `next` reaches us from a query string, so it is attacker-controlled. Anything
// that is not a single-slash same-origin path is discarded rather than
// sanitised — there is no legitimate reason for an off-site value here, and a
// redirect we build from user input is an open redirect.
//
// "//evil.example" is protocol-relative and would leave the site; some browsers
// also normalise a backslash to a slash, so "/\evil.example" smuggles the same
// attack past a naive startsWith("//") check.
export function safeNext(
  next: string | null | undefined,
  fallback: string
): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
