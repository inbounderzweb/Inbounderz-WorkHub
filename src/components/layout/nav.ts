import { Bell, Building2, CheckSquare, ClipboardCheck, FolderKanban, Gauge, LayoutDashboard, ListChecks, Settings, Ticket, UserCircle, Users, type LucideIcon } from "lucide-react";
import type { Permission } from "@/lib/permissions";

export type NavItem = { href: string; label: string; icon: LucideIcon; permission?: Permission };
export type NavSection = { label: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Work",
    items: [
      { href: "/my-tasks", label: "My Tasks", icon: CheckSquare, permission: "task:read" },
      { href: "/tickets", label: "Tickets", icon: Ticket, permission: "ticket:create" },
      { href: "/tickets/reviews", label: "Review queue", icon: ClipboardCheck, permission: "ticket:create" },
      { href: "/projects", label: "Projects", icon: FolderKanban, permission: "project:read" },
      { href: "/tasks", label: "All Tasks", icon: ListChecks, permission: "task:manage" },
    ],
  },
  {
    label: "Organization",
    items: [
      { href: "/employees", label: "Employees", icon: Users, permission: "employee:read" },
      { href: "/departments", label: "Departments", icon: Building2, permission: "department:read" },
      { href: "/workload", label: "Workload", icon: Gauge, permission: "ticket:manage" },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/profile", label: "My Profile", icon: UserCircle },
      { href: "/settings", label: "Settings", icon: Settings, permission: "settings:manage" },
    ],
  },
];
