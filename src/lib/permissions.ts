import type { RoleKey } from "./constants";

/**
 * Capability-based permission matrix.
 *
 * This file is the single source of truth. It is seeded into the `roles` collection
 * (for reporting/visibility) and evaluated on the server for every protected
 * Route Handler and page. The client only uses it to decide what to *show*;
 * the server always re-checks.
 *
 * Scope rules (e.g. "only employees of departments I head") are applied in the
 * service layer on top of these coarse capabilities.
 */
export const PERMISSIONS = {
  // Employees
  "employee:read": "View employee directory and profiles",
  "employee:create": "Create employees",
  "employee:update": "Edit employee details",
  "employee:status": "Activate / deactivate employees",
  "employee:assign-role": "Assign or change roles",
  "employee:reset-password": "Reset employee passwords",
  // Departments
  "department:read": "View departments",
  "department:create": "Create departments",
  "department:update": "Edit departments",
  "department:delete": "Delete departments",
  "department:assign-head": "Assign department heads",
  "department:assign-leaders": "Assign team leaders",
  "department:manage-members": "Add or remove department employees",
  // Projects & tasks (Day 2 features build on these)
  "project:read": "View projects",
  "project:manage": "Create and manage projects and teams",
  "task:read": "View tasks",
  "task:manage": "Create and assign tasks",
  "task:review": "Review and approve tasks",
  "task:update-status": "Update status on own tasks",
  "ticket:create": "Raise internal tickets",
  "ticket:manage": "Manage internal tickets",
  "daily-update:submit": "Submit daily work updates",
  // Reporting & system
  "report:company": "View company-wide reports",
  "report:project": "View project-level reports",
  "report:department": "View department reports",
  "audit:read": "View audit log",
  "settings:manage": "Configure system settings",
} as const;

export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  SUPER_ADMIN: ALL,
  PROJECT_MANAGER: [
    "employee:read",
    "department:read",
    "project:read",
    "project:manage",
    "task:read",
    "task:manage",
    "task:review",
    "task:update-status",
    "ticket:create",
    "ticket:manage",
    "daily-update:submit",
    "report:project",
  ],
  DEPARTMENT_HEAD: [
    "employee:read",
    "employee:create",
    "employee:update",
    "employee:status",
    "department:read",
    "department:assign-leaders",
    "project:read",
    "task:read",
    "task:manage",
    "task:review",
    "task:update-status",
    "ticket:create",
    "daily-update:submit",
    "report:department",
  ],
  TEAM_LEADER: [
    "employee:read",
    "department:read",
    "project:read",
    "task:read",
    "task:manage",
    "task:update-status",
    "ticket:create",
    "daily-update:submit",
  ],
  EMPLOYEE: [
    "department:read",
    "project:read",
    "task:read",
    "task:update-status",
    "ticket:create",
    "daily-update:submit",
  ],
};

export function hasPermission(role: RoleKey | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Roles a given role may grant when creating/editing employees.
 * Department Heads can only onboard Employees and Team Leaders into their own departments.
 */
export const ASSIGNABLE_ROLES: Record<RoleKey, RoleKey[]> = {
  SUPER_ADMIN: ["SUPER_ADMIN", "PROJECT_MANAGER", "DEPARTMENT_HEAD", "TEAM_LEADER", "EMPLOYEE"],
  PROJECT_MANAGER: [],
  DEPARTMENT_HEAD: ["TEAM_LEADER", "EMPLOYEE"],
  TEAM_LEADER: [],
  EMPLOYEE: [],
};
