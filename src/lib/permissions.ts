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
  "ticket:manage": "Review, assign and reassign internal tickets",
  "ticket:monitor": "View the ticket management queue (within scope)",
  "daily-update:submit": "Submit daily work updates",
  "daily-update:review": "Review daily work updates (approve / request changes)",
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
    "ticket:monitor",
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
    "ticket:monitor",
    "daily-update:submit",
    "daily-update:review",
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

/**
 * Permissions a Super Admin may grant or revoke per role (Settings → Users & roles).
 * Structural permissions (employee/department/project/task management, settings)
 * stay fixed in code: changing them could orphan or corrupt workflow records.
 * Every grant is still limited by the scope rules in the service layer.
 */
export const CONFIGURABLE_PERMISSIONS: Permission[] = [
  "employee:read",
  "ticket:create",
  "ticket:monitor",
  "daily-update:submit",
  "daily-update:review",
  "report:company",
  "report:project",
  "report:department",
  "audit:read",
];

export type PermissionOverrides = Partial<Record<RoleKey, { grant?: Permission[]; revoke?: Permission[] }>>;

declare global {
  var __workhubPermissionOverrides: PermissionOverrides | undefined;
}

/** Server: installed by the settings loader on every request (cached briefly). */
export function setPermissionOverrides(overrides: PermissionOverrides): void {
  globalThis.__workhubPermissionOverrides = overrides;
}

/** Base matrix ± configured overrides. Super Admin is never overridden. */
export function effectivePermissions(role: RoleKey, overrides: PermissionOverrides | undefined = globalThis.__workhubPermissionOverrides): Permission[] {
  const base = ROLE_PERMISSIONS[role] ?? [];
  if (role === "SUPER_ADMIN" || !overrides?.[role]) return base;
  const o = overrides[role]!;
  const allowed = (list?: Permission[]) => (list ?? []).filter((p) => CONFIGURABLE_PERMISSIONS.includes(p));
  const revoke = new Set(allowed(o.revoke));
  return [...new Set([...base.filter((p) => !revoke.has(p)), ...allowed(o.grant)])];
}

export function hasPermission(role: RoleKey | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return effectivePermissions(role).includes(permission);
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
