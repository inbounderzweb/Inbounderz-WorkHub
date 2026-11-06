import "server-only";
import { Types } from "mongoose";
import type { CurrentUser } from "@/lib/auth/current-user";
import { Department, Project, ProjectMember } from "@/models";

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
  switch (user.role) {
    case "SUPER_ADMIN":
    case "PROJECT_MANAGER":
      return null;
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

/** Departments the user may *manage* employees in (create/edit/activate). */
export async function managedDepartmentIds(user: CurrentUser): Promise<Types.ObjectId[] | null> {
  if (user.role === "SUPER_ADMIN") return null;
  if (user.role === "DEPARTMENT_HEAD") return headedDepartmentIds(user.id);
  return [];
}

/** Mongo filter restricting which employees the user can see. */
export async function employeeVisibilityFilter(user: CurrentUser): Promise<Filter> {
  const self = oid(user.id);
  switch (user.role) {
    case "SUPER_ADMIN":
    case "PROJECT_MANAGER": // read-only company directory, needed to staff projects
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

/** Projects visible to the user. `null` means all. */
export async function visibleProjectIds(user: CurrentUser): Promise<Types.ObjectId[] | null> {
  if (user.role === "SUPER_ADMIN") return null;
  const self = oid(user.id);
  const [managed, memberships] = await Promise.all([
    Project.find({ manager: self }).select("_id").lean(),
    ProjectMember.find({ user: self, isActive: true }).select("project").lean(),
  ]);
  const ids = [...managed.map((p) => p._id), ...memberships.map((m) => m.project)];
  if (user.role === "DEPARTMENT_HEAD") {
    const depts = await headedDepartmentIds(user.id);
    const deptProjects = await Project.find({ departments: { $in: depts } }).select("_id").lean();
    ids.push(...deptProjects.map((p) => p._id));
  }
  return dedupe(ids);
}

/** Projects the user manages (as Project.manager or a MANAGER project member). */
export async function managedProjectIds(user: CurrentUser): Promise<Types.ObjectId[] | null> {
  if (user.role === "SUPER_ADMIN") return null;
  const self = oid(user.id);
  const [managed, memberships] = await Promise.all([
    Project.find({ manager: self }).select("_id").lean(),
    ProjectMember.find({ user: self, isActive: true, projectRole: "MANAGER" }).select("project").lean(),
  ]);
  return dedupe([...managed.map((p) => p._id), ...memberships.map((m) => m.project)]);
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
