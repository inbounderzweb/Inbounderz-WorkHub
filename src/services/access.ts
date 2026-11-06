import "server-only";
import type { Types } from "mongoose";
import type { CurrentUser } from "@/lib/auth/current-user";
import { Project, ProjectMember } from "@/models";
import { headedDepartmentIds, ledDepartmentIds, oid, type Filter } from "./scope";

/**
 * Everything needed to answer "may this user see / manage / review X?" for
 * projects and tasks, computed once per request.
 */
export type AccessContext = {
  user: CurrentUser;
  isAdmin: boolean;
  /** Projects the user manages (Project.manager or an active MANAGER membership). */
  managed: Set<string>;
  /** Projects where the user is an active team member (any project role). */
  memberOf: Set<string>;
  headed: Set<string>;
  led: Set<string>;
};

const ids = (list: { toString(): string }[]) => new Set(list.map((x) => x.toString()));

export async function accessContext(user: CurrentUser): Promise<AccessContext> {
  const self = oid(user.id);
  const [managedProjects, memberships, headed, led] = await Promise.all([
    Project.find({ manager: self }).select("_id").lean(),
    ProjectMember.find({ user: self, isActive: true }).select("project projectRole").lean(),
    user.role === "DEPARTMENT_HEAD" || user.role === "SUPER_ADMIN" ? headedDepartmentIds(user.id) : Promise.resolve([]),
    user.role === "TEAM_LEADER" ? ledDepartmentIds(user.id) : Promise.resolve([]),
  ]);
  const managed = ids(managedProjects.map((p) => p._id));
  for (const m of memberships) if (m.projectRole === "MANAGER") managed.add(m.project.toString());
  return {
    user,
    isAdmin: user.role === "SUPER_ADMIN",
    managed,
    memberOf: ids(memberships.map((m) => m.project)),
    headed: ids(headed),
    led: ids(led),
  };
}

/** Id as string, whether the value is an ObjectId, a string or a populated document. */
const s = (v: unknown): string =>
  !v ? "" : typeof v === "object" && "_id" in (v as object) ? String((v as { _id: unknown })._id) : String(v);
const toOids = (set: Set<string>) => [...set].map((x) => oid(x));

/* ------------------------------- Projects ------------------------------- */

export function projectVisibilityFilter(ctx: AccessContext): Filter {
  if (ctx.isAdmin) return {};
  const depts = toOids(new Set([...ctx.headed, ...ctx.led]));
  return {
    $or: [
      { _id: { $in: toOids(new Set([...ctx.managed, ...ctx.memberOf])) } },
      ...(depts.length ? [{ departments: { $in: depts } }] : []),
    ],
  };
}

export function canViewProject(ctx: AccessContext, project: { _id: Types.ObjectId; departments?: Types.ObjectId[] }): boolean {
  if (ctx.isAdmin) return true;
  const id = project._id.toString();
  if (ctx.managed.has(id) || ctx.memberOf.has(id)) return true;
  return (project.departments ?? []).some((d) => ctx.headed.has(d.toString()) || ctx.led.has(d.toString()));
}

export function canManageProject(ctx: AccessContext, projectId: unknown): boolean {
  return ctx.isAdmin || ctx.managed.has(s(projectId));
}

/** Departments of this project in which the user may create/assign tasks. */
export function taskCreationDepartments(
  ctx: AccessContext,
  project: { _id: Types.ObjectId; departments: Types.ObjectId[] }
): string[] {
  const depts = project.departments.map((d) => d.toString());
  if (canManageProject(ctx, project._id)) return depts;
  return depts.filter((d) => ctx.headed.has(d) || ctx.led.has(d));
}

/* --------------------------------- Tasks -------------------------------- */

type TaskLike = {
  owner?: Types.ObjectId | null;
  collaborators?: Types.ObjectId[];
  project?: Types.ObjectId | null;
  department?: Types.ObjectId | null;
  createdBy?: Types.ObjectId | null;
  approvalMode?: string | null;
};

/** Mongo filter for tasks the user may see. Employees see only their own work. */
export function taskVisibilityFilter(ctx: AccessContext): Filter {
  if (ctx.isAdmin) return {};
  const self = oid(ctx.user.id);
  const or: Filter[] = [{ owner: self }, { collaborators: self }, { createdBy: self }];
  if (ctx.managed.size) or.push({ project: { $in: toOids(ctx.managed) } });
  const depts = toOids(new Set([...ctx.headed, ...ctx.led]));
  if (depts.length) or.push({ department: { $in: depts } });
  return { $or: or };
}

export function isOwner(ctx: AccessContext, task: TaskLike): boolean {
  return s(task.owner) === ctx.user.id;
}

export function isCollaborator(ctx: AccessContext, task: TaskLike): boolean {
  return (task.collaborators ?? []).some((c) => s(c) === ctx.user.id);
}

export function canManageTask(ctx: AccessContext, task: TaskLike): boolean {
  if (ctx.isAdmin) return true;
  if (ctx.managed.has(s(task.project))) return true;
  const dept = s(task.department);
  return !!dept && (ctx.headed.has(dept) || ctx.led.has(dept));
}

export function canViewTask(ctx: AccessContext, task: TaskLike): boolean {
  return (
    canManageTask(ctx, task) || isOwner(ctx, task) || isCollaborator(ctx, task) || s(task.createdBy) === ctx.user.id
  );
}

/**
 * Who may approve or request changes. Nobody reviews their own task.
 *  - Project Manager mode: the project's manager(s) (and Super Admin).
 *  - Department mode: the department head or a team leader of the task's
 *    department; project managers may also review.
 */
export function canReviewTask(ctx: AccessContext, task: TaskLike): boolean {
  if (isOwner(ctx, task)) return false;
  if (ctx.isAdmin || ctx.managed.has(s(task.project))) return true;
  if (task.approvalMode === "PROJECT_MANAGER") return false;
  const dept = s(task.department);
  return !!dept && (ctx.headed.has(dept) || ctx.led.has(dept));
}
