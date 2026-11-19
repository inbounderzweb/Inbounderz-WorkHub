import "server-only";
import { Types } from "mongoose";
import type { CurrentUser } from "@/lib/auth/current-user";
import { Department } from "@/models";
import { hasPermission } from "@/lib/permissions";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Filter = Record<string, any>;

export const oid = (id: string | Types.ObjectId) =>
  typeof id === "string" ? new Types.ObjectId(id) : id;

/** Departments where the user is the Department Head. */
export async function headedDepartmentIds(userId: string): Promise<Types.ObjectId[]> {
  const rows = await Department.find({ head: oid(userId) }).select("_id").lean();
  return rows.map((r) => r._id);
}

/** Departments where the user is a Team Leader. */
export async function ledDepartmentIds(userId: string): Promise<Types.ObjectId[]> {
  const rows = await Department.find({ teamLeaders: oid(userId) }).select("_id").lean();
  return rows.map((r) => r._id);
}

/**
 * Departments whose data the user may see in management views.
 * `null` means "all departments".
 */
export async function visibleDepartmentIds(user: CurrentUser): Promise<Types.ObjectId[] | null> {
  // "See every department" is a permission (editable in Settings), so granting it to any role widens the list.
  if (hasPermission(user.role, "department:read-all")) return null;
  switch (user.role) {
    case "DEPARTMENT_HEAD": {
      const ids = await headedDepartmentIds(user.id);
      if (user.departmentId) ids.push(oid(user.departmentId));
      return dedupe(ids);
    }
    case "TEAM_LEADER": {
      const ids = await ledDepartmentIds(user.id);
      if (user.departmentId) ids.push(oid(user.departmentId));
      return dedupe(ids);
    }
    default:
      return user.departmentId ? [oid(user.departmentId)] : [];
  }
}

/** Department scope for employee mutations, checked after the action's permission. */
export async function managedDepartmentIds(user: CurrentUser): Promise<Types.ObjectId[] | null> {
  if (user.role === "SUPER_ADMIN" || user.role === "PROJECT_MANAGER") return null;
  if (user.role === "DEPARTMENT_HEAD") return headedDepartmentIds(user.id);
  return [];
}

/** Mongo filter restricting which employees the user can see. */
export async function employeeVisibilityFilter(user: CurrentUser): Promise<Filter> {
  const self = oid(user.id);
  switch (user.role) {
    case "SUPER_ADMIN":
    case "PROJECT_MANAGER": // company directory, needed to staff projects
      return {};
    case "DEPARTMENT_HEAD": {
      const depts = await headedDepartmentIds(user.id);
      return { $or: [{ department: { $in: depts } }, { reportingManager: self }, { _id: self }] };
    }
    case "TEAM_LEADER": {
      const depts = await ledDepartmentIds(user.id);
      return { $or: [{ department: { $in: depts } }, { reportingManager: self }, { _id: self }] };
    }
    default:
      return { _id: self };
  }
}

export function dedupe(ids: Types.ObjectId[]): Types.ObjectId[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    const k = id.toString();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function includesId(ids: Types.ObjectId[] | null, id: unknown): boolean {
  if (ids === null) return true;
  if (!id) return false;
  const s = String(id);
  return ids.some((x) => x.toString() === s);
}
