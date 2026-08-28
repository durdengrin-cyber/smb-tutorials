import type { Role } from "@/lib/routes";

export interface NavItem {
  href: string;
  label: string;
}

// Data, not markup: cycles 2 and 3 add surfaces by adding entries here rather
// than by rewriting the shell. Thin today because only two surfaces exist —
// a nav pointing at pages that do not exist is the same defect as marketing
// copy advertising features that do not exist.
export const NAV: Record<Role, NavItem[]> = {
  student: [{ href: "/find", label: "Find a teacher" }],
  teacher: [{ href: "/dashboard", label: "Dashboard" }],
  admin: [{ href: "/admin", label: "Admin" }],
};
