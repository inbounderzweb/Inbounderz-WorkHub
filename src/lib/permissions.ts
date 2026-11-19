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
  "department:read-all": "See every department, not only your own",
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
  // Clients. Row-level scope and field-level restriction are applied in services/client-access.ts.
  "client:read": "View clients the user is associated with (fields depend on role)",
  "client:create": "Create clients",
  "client:update": "Edit clients the user is authorised for",
  "client:manage": "Override duplicate blocks, reassign owners, archive, resolve duplicate reviews",
  "project:handover": "Create a project from approved client requirements and nominate a Project Manager",
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
    "employee:create",
    "department:read",
    "department:read-all",
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
    "client:read",
    "client:update",
  ],
  SALES_EXECUTIVE: ["department:read", "department:read-all", "project:read", "daily-update:submit", "client:read", "client:create", "client:update", "project:handover"],
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
    "client:read",
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
    "client:read",
  ],
  EMPLOYEE: [
    "department:read",
    "project:read",
    "task:read",
    "task:update-status",
    "ticket:create",
    "daily-update:submit",
    "client:read",
  ],
};

declare global {
  var __rolePerms: Partial<Record<RoleKey, readonly Permission[]>> | undefined;
}

/**
 * Permissions a Super Admin can never hand to another role, nor take from Super Admin. Settings and the
 * audit log stay Super Admin only, and the Super Admin column is fixed so nobody can be locked out.
 */
export const LOCKED_PERMISSIONS: readonly Permission[] = ["settings:manage", "audit:read"];

/** What a role may do right now: the Super Admin's edits (loaded from the database) over the defaults above. */
export function effectivePermissions(role: RoleKey): readonly Permission[] {
  return globalThis.__rolePerms?.[role] ?? ROLE_PERMISSIONS[role] ?? [];
}

/** Installs the effective permissions (server: loaded from MongoDB; browser: the signed-in user's own role). */
export function setRuntimePermissions(map: Partial<Record<RoleKey, readonly Permission[]>>): void {
  globalThis.__rolePerms = { ...globalThis.__rolePerms, ...map };
}

export function hasPermission(role: RoleKey | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return effectivePermissions(role).includes(permission);
}

/**
 * Roles a given role may grant when creating/editing employees.
 * Project Managers can onboard Department Heads, Team Leaders and Employees across departments.
 * Department Heads can only onboard Employees and Team Leaders into their own departments.
 */
export const ASSIGNABLE_ROLES: Record<RoleKey, RoleKey[]> = {
  SUPER_ADMIN: ["SUPER_ADMIN", "PROJECT_MANAGER", "SALES_EXECUTIVE", "DEPARTMENT_HEAD", "TEAM_LEADER", "EMPLOYEE"],
  PROJECT_MANAGER: ["DEPARTMENT_HEAD", "TEAM_LEADER", "EMPLOYEE"],
  SALES_EXECUTIVE: [],
  DEPARTMENT_HEAD: ["TEAM_LEADER", "EMPLOYEE"],
  TEAM_LEADER: [],
  EMPLOYEE: [],
};
