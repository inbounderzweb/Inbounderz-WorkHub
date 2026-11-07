import { BarChart3, Bell, Building2, CalendarDays, CheckSquare, ClipboardList, FolderKanban, History, Inbox, LayoutDashboard, ListChecks, Settings, Ticket, UserCircle, Users, type LucideIcon } from "lucide-react";
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
      { href: "/projects", label: "Projects", icon: FolderKanban, permission: "project:read" },
      { href: "/tasks", label: "All Tasks", icon: ListChecks, permission: "task:manage" },
      { href: "/daily-updates", label: "Daily Updates", icon: ClipboardList, permission: "daily-update:submit" },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    label: "Requests",
    items: [
      { href: "/my-tickets", label: "My Tickets", icon: Ticket, permission: "ticket:create" },
      { href: "/tickets", label: "Ticket Management", icon: Inbox, permission: "ticket:monitor" },
    ],
  },
  {
    label: "Organization",
    items: [
      { href: "/employees", label: "Employees", icon: Users, permission: "employee:read" },
      { href: "/departments", label: "Departments", icon: Building2, permission: "department:read" },
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/audit-log", label: "Audit Log", icon: History, permission: "audit:read" },
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
