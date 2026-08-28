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
