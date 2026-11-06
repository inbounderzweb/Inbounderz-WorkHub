import { Bell, Building2, LayoutDashboard, Settings, UserCircle, Users, type LucideIcon } from "lucide-react";
import type { Permission } from "@/lib/permissions";

export type NavItem = { href: string; label: string; icon: LucideIcon; permission?: Permission };
export type NavSection = { label: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Organization",
    items: [
      { href: "/employees", label: "Employees", icon: Users, permission: "employee:read" },
      { href: "/departments", label: "Departments", icon: Building2, permission: "department:read" },
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
