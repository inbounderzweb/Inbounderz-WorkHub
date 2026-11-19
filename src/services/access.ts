import "server-only";
import type { Types } from "mongoose";
import type { CurrentUser } from "@/lib/auth/current-user";
import { Client, PMAssignment, Project, ProjectMember } from "@/models";
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
  /** Department represented by each active project membership. */
  memberDepartments: Map<string, string>;
  headed: Set<string>;
  led: Set<string>;
  /**
   * Read-only sight of projects that have no manager yet or that this user only supports:
   * a PM (or coordinator) whose handover response is pending, and a Sales Executive's own clients' projects.
   */
  handover: Set<string>;
};

const ids = (list: { toString(): string }[]) => new Set(list.map((x) => x.toString()));

/** Every project of the clients a Sales Executive owns. */
async function salesProjectIds(self: Types.ObjectId): Promise<Types.ObjectId[]> {
  const clients = await Client.find({ salesOwner: self }).select("_id").lean();
  if (!clients.length) return [];
  const projects = await Project.find({ clientRef: { $in: clients.map((c) => c._id) } }).select("_id").lean();
  return projects.map((p) => p._id as Types.ObjectId);
}

export async function accessContext(user: CurrentUser): Promise<AccessContext> {
  const self = oid(user.id);
  const [managedProjects, memberships, headed, led, nominated, salesProjects] = await Promise.all([
    Project.find({ manager: self }).select("_id").lean(),
    ProjectMember.find({ user: self, isActive: true }).select("project projectRole department").lean(),
    user.role === "DEPARTMENT_HEAD" || user.role === "SUPER_ADMIN" ? headedDepartmentIds(user.id) : Promise.resolve([]),
    user.role === "TEAM_LEADER" ? ledDepartmentIds(user.id) : Promise.resolve([]),
    PMAssignment.find({ isCurrent: true, status: { $in: ["PENDING", "ACCEPTED"] }, $or: [{ primaryPm: self }, { supportingPms: self }, { coordinator: self }] }).select("project").lean(),
    user.role === "SALES_EXECUTIVE" ? salesProjectIds(self) : Promise.resolve([] as Types.ObjectId[]),
  ]);
  const managed = ids(managedProjects.map((p) => p._id));
  for (const m of memberships) if (m.projectRole === "MANAGER") managed.add(m.project.toString());
  return {
    user,
    isAdmin: user.role === "SUPER_ADMIN",
    managed,
    memberOf: ids(memberships.map((m) => m.project)),
    memberDepartments: new Map(memberships.filter((m) => m.department).map((m) => [m.project.toString(), m.department!.toString()])),
    headed: ids(headed),
    led: ids(led),
    handover: ids([...nominated.map((n) => n.project), ...salesProjects]),
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
      { _id: { $in: toOids(new Set([...ctx.managed, ...ctx.memberOf, ...ctx.handover])) } },
      ...(depts.length ? [{ departments: { $in: depts } }] : []),
    ],
  };
}

export function canViewProject(ctx: AccessContext, project: { _id: Types.ObjectId; departments?: Types.ObjectId[] }): boolean {
  if (ctx.isAdmin) return true;
  const id = project._id.toString();
  if (ctx.managed.has(id) || ctx.memberOf.has(id) || ctx.handover.has(id)) return true;
  return (project.departments ?? []).some((d) => ctx.headed.has(d.toString()) || ctx.led.has(d.toString()));
}

export function canManageProject(ctx: AccessContext, projectId: unknown): boolean {
  return ctx.isAdmin || ctx.managed.has(s(projectId));
}

/** A department leader allocated to a project can lead that department's work there. */
function leadsProjectDepartment(ctx: AccessContext, projectId: unknown, department: string): boolean {
  return ["DEPARTMENT_HEAD", "TEAM_LEADER"].includes(ctx.user.role) && ctx.memberDepartments.get(s(projectId)) === department;
}

/** Departments of this project in which the user may create/assign tasks. */
export function taskCreationDepartments(
  ctx: AccessContext,
  project: { _id: Types.ObjectId; departments: Types.ObjectId[] }
): string[] {
  const depts = project.departments.map((d) => d.toString());
  if (canManageProject(ctx, project._id)) return depts;
  return depts.filter((d) => ctx.headed.has(d) || ctx.led.has(d) || leadsProjectDepartment(ctx, project._id, d));
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
  if (["DEPARTMENT_HEAD", "TEAM_LEADER"].includes(ctx.user.role)) {
    for (const [project, department] of ctx.memberDepartments) or.push({ project: oid(project), department: oid(department) });
  }
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
  return !!dept && (ctx.headed.has(dept) || ctx.led.has(dept) || leadsProjectDepartment(ctx, task.project, dept));
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
