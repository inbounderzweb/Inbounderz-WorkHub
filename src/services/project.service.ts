import "server-only";
import type { Types } from "mongoose";
import type { z } from "zod";
import type { CurrentUser } from "@/lib/auth/current-user";
import { ApiError, conflict, escapeRegex, forbidden, notFound, paginate, unprocessable } from "@/lib/api";
import { diffFields, recordAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { hasPermission } from "@/lib/permissions";
import { getRoleById } from "@/lib/roles";
import {
  OPEN_TASK_STATUSES,
  type ApprovalMode,
  type MilestoneStatus,
  type ProjectMemberRole,
  type ProjectStatus,
  type TaskPriority,
  type TaskStatus,
  type UserStatus,
} from "@/lib/constants";
import type {
  createMilestoneSchema,
  createProjectSchema,
  projectListQuerySchema,
  projectMembersSchema,
  updateMilestoneSchema,
  updateProjectSchema,
} from "@/lib/validations/project";
import { AuditLog, Department, Milestone, nextSequence, Project, ProjectMember, Task, TaskActivity, User } from "@/models";
import type {
  ActivityDTO,
  MilestoneDTO,
  Paginated,
  ProjectDetailDTO,
  ProjectDTO,
  ProjectMemberDTO,
  ProjectOptionDTO,
  TeamMemberOptionDTO,
} from "@/types/dto";
import {
  accessContext,
  canManageProject,
  canViewProject,
  projectVisibilityFilter,
  taskCreationDepartments,
} from "./access";
import { DEPT_REF_FIELDS, iso, toDepartmentRef, toUserRef, USER_REF_FIELDS } from "./mappers";
import { EMPTY_PROGRESS, progressFor } from "./progress.service";
import { oid, type Filter } from "./scope";
import { listAttachments } from "./attachment.service";

/* eslint-disable @typescript-eslint/no-explicit-any */

type CreateInput = z.output<typeof createProjectSchema>;
type UpdateInput = z.output<typeof updateProjectSchema>;
type ListQuery = z.output<typeof projectListQuerySchema>;
type MembersInput = z.output<typeof projectMembersSchema>;

const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const toEndOfDay = (s: string | null | undefined) => (s ? new Date(`${s}T23:59:59.000Z`) : null);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function loadProjectOr404(id: string) {
  const project = await Project.findById(id);
  if (!project) throw notFound("Project not found");
  return project;
}

async function loadVisibleProject(user: CurrentUser, id: string) {
  if (!hasPermission(user.role, "project:read")) throw forbidden();
  const ctx = await accessContext(user);
  const project = await loadProjectOr404(id);
  if (!canViewProject(ctx, project)) throw notFound("Project not found");
  return { ctx, project };
}

async function loadManagedProject(user: CurrentUser, id: string, { allowArchived = false } = {}) {
  const { ctx, project } = await loadVisibleProject(user, id);
  if (!canManageProject(ctx, project._id)) throw forbidden("Only the project's manager can do this");
  if (project.isArchived && !allowArchived) throw unprocessable("This project is archived. Unarchive it to make changes.");
  return { ctx, project };
}

async function generateProjectCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = `PRJ-${String(await nextSequence("projectCode")).padStart(4, "0")}`;
    if (!(await Project.exists({ code }))) return code;
  }
  throw new ApiError(500, "Could not generate a project ID");
}

/**
 * Validates the department allocation: departments must exist and be active,
 * each allocated employee must be active and belong (primary department) to
 * the department they are allocated under, which must be part of the project.
 */
async function validateAllocation(
  departmentIds: string[],
  members: { user: string; department: string }[]
): Promise<void> {
  const uniqueDepts = [...new Set(departmentIds)];
  const depts = await Department.find({ _id: { $in: uniqueDepts.map(oid) } }).select("name status").lean();
  if (depts.length !== uniqueDepts.length) throw unprocessable("One or more departments were not found", { departments: "Department not found" });
  const archived = depts.find((d) => d.status !== "ACTIVE");
  if (archived) throw unprocessable(`${archived.name} is archived`, { departments: `${archived.name} is archived` });

  const seen = new Set<string>();
  for (const m of members) {
    if (seen.has(m.user)) throw unprocessable("An employee was allocated twice", { members: "Duplicate employee" });
    seen.add(m.user);
    if (!uniqueDepts.includes(m.department)) {
      throw unprocessable("Employees can only be allocated under the project's departments", { members: "Department not selected for this project" });
    }
  }
  if (!members.length) return;
  const users = await User.find({ _id: { $in: members.map((m) => oid(m.user)) } }).select("name status department").lean();
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  for (const m of members) {
    const u = byId.get(m.user);
    if (!u) throw unprocessable("An allocated employee was not found", { members: "Employee not found" });
    if (u.status !== "ACTIVE") throw unprocessable(`${u.name} is inactive`, { members: `${u.name} is inactive` });
    if (u.department?.toString() !== m.department) {
      throw unprocessable(`${u.name} does not belong to the selected department`, { members: `${u.name} is not in that department` });
    }
  }
}

async function resolveManager(user: CurrentUser, requested: string | null | undefined): Promise<Types.ObjectId> {
  if (user.role === "PROJECT_MANAGER") {
    if (requested && requested !== user.id) throw forbidden("Project Managers create projects they manage themselves");
    return oid(user.id);
  }
  if (!requested) throw unprocessable("Select a project manager", { manager: "Select a project manager" });
  const mgr = await User.findById(requested).select("name status role").lean();
  if (!mgr || mgr.status !== "ACTIVE") throw unprocessable("Manager not found or inactive", { manager: "Manager not found or inactive" });
  const role = await getRoleById(mgr.role);
  if (role?.key !== "PROJECT_MANAGER" && role?.key !== "SUPER_ADMIN") {
    throw unprocessable(`${mgr.name} is not a Project Manager`, { manager: "Select a user with the Project Manager role" });
  }
  return mgr._id;
}

/** Keeps exactly one active MANAGER membership in sync with Project.manager. */
async function syncManagerMembership(projectId: Types.ObjectId, managerId: Types.ObjectId, actorId: string) {
  await ProjectMember.updateMany(
    { project: projectId, projectRole: "MANAGER", user: { $ne: managerId }, isActive: true },
    { $set: { isActive: false, leftAt: new Date() } }
  );
  const mgr = await User.findById(managerId).select("department").lean();
  await ProjectMember.updateOne(
    { project: projectId, user: managerId },
    {
      $set: { projectRole: "MANAGER", isActive: true, leftAt: null, department: mgr?.department ?? null },
      $setOnInsert: { joinedAt: new Date(), addedBy: oid(actorId) },
    },
    { upsert: true }
  );
}

function toProjectDTO(p: any, progress = EMPTY_PROGRESS, memberCount = 0): ProjectDTO {
  return {
    id: p._id.toString(),
    code: p.code,
    name: p.name,
    client: p.client ?? "",
    description: p.description ?? "",
    status: p.status as ProjectStatus,
    priority: p.priority as TaskPriority,
    manager: toUserRef(p.manager),
    departments: (p.departments ?? []).map(toDepartmentRef).filter(Boolean),
    startDate: iso(p.startDate),
    endDate: iso(p.endDate),
    budget: p.budget ?? null,
    approvalMode: (p.approvalMode ?? "DEPARTMENT") as ApprovalMode,
    isArchived: !!p.isArchived,
    memberCount,
    progress,
    createdAt: iso(p.createdAt)!,
    updatedAt: iso(p.updatedAt)!,
  };
}

async function memberCounts(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  const rows = await ProjectMember.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { project: { $in: ids }, isActive: true } },
    { $group: { _id: "$project", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.n]));
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function listProjects(
  user: CurrentUser,
  query: ListQuery
): Promise<Paginated<ProjectDTO> | ProjectOptionDTO[]> {
  if (!hasPermission(user.role, "project:read")) throw forbidden();
  const ctx = await accessContext(user);
  const and: Filter[] = [projectVisibilityFilter(ctx)];
  if (query.archived === "only") and.push({ isArchived: true });
  else if (query.archived !== "include") and.push({ isArchived: { $ne: true } });
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    and.push({ $or: [{ name: rx }, { code: rx }, { client: rx }] });
  }
  if (query.status) and.push({ status: query.status });
  if (query.priority) and.push({ priority: query.priority });
  if (/^[a-f\d]{24}$/i.test(query.department)) and.push({ departments: oid(query.department) });
  const filter = { $and: and };

  if (query.minimal) {
    const rows = await Project.find(filter).sort({ name: 1 }).limit(300).populate("departments", DEPT_REF_FIELDS).lean();
    return rows.map((p) => ({
      id: p._id.toString(),
      code: p.code,
      name: p.name,
      status: p.status as ProjectStatus,
      isArchived: !!p.isArchived,
      departments: (p.departments as any[]).map(toDepartmentRef).filter(Boolean) as ProjectOptionDTO["departments"],
      approvalMode: (p.approvalMode ?? "DEPARTMENT") as ApprovalMode,
      taskDepartments:
        p.isArchived || ["COMPLETED", "CANCELLED"].includes(p.status) || !hasPermission(user.role, "task:manage")
          ? []
          : taskCreationDepartments(ctx, { _id: p._id, departments: (p.departments as any[]).map((d) => d._id) }),
    }));
  }

  const sortField = query.sort.replace(/^-/, "");
  const [rows, total] = await Promise.all([
    Project.find(filter)
      .sort({ [sortField]: query.sort.startsWith("-") ? -1 : 1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .populate("manager", USER_REF_FIELDS)
      .populate("departments", DEPT_REF_FIELDS)
      .lean(),
    Project.countDocuments(filter),
  ]);
  const ids = rows.map((r) => r._id);
  const [progress, counts] = await Promise.all([progressFor(ids), memberCounts(ids)]);
  return paginate(
    rows.map((p) => toProjectDTO(p, progress.get(p._id.toString()), counts.get(p._id.toString()))),
    total,
    query.page,
    query.pageSize
  );
}

function toMemberDTO(m: any, openTasks: Map<string, number>): ProjectMemberDTO {
  return {
    id: m._id.toString(),
    user: {
      ...toUserRef(m.user)!,
      status: (m.user?.status ?? "ACTIVE") as UserStatus,
      employeeId: m.user?.employeeId ?? "",
    },
    department: toDepartmentRef(m.department),
    projectRole: m.projectRole as ProjectMemberRole,
    allocationPercent: m.allocationPercent ?? 100,
    isActive: !!m.isActive,
    joinedAt: iso(m.joinedAt)!,
    leftAt: iso(m.leftAt),
    openTasks: openTasks.get(m.user?._id?.toString()) ?? 0,
  };
}

export async function getProject(user: CurrentUser, id: string): Promise<ProjectDetailDTO> {
  const { ctx, project } = await loadVisibleProject(user, id);
  const p = await Project.findById(project._id)
    .populate("manager", USER_REF_FIELDS)
    .populate("departments", DEPT_REF_FIELDS)
    .lean();

  const [members, progress, milestones, milestoneCounts, openByOwner, timeline, documents] = await Promise.all([
    ProjectMember.find({ project: project._id })
      .populate("user", `${USER_REF_FIELDS} status employeeId`)
      .populate("department", DEPT_REF_FIELDS)
      .sort({ isActive: -1, projectRole: 1, joinedAt: 1 })
      .lean(),
    progressFor([project._id]),
    Milestone.find({ project: project._id }).sort({ dueDate: 1, order: 1 }).lean(),
    Task.aggregate<{ _id: Types.ObjectId; total: number; done: number }>([
      { $match: { project: project._id, milestone: { $ne: null } } },
      { $group: { _id: "$milestone", total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } } } },
    ]),
    Task.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { project: project._id, status: { $in: OPEN_TASK_STATUSES } } },
      { $group: { _id: "$owner", n: { $sum: 1 } } },
    ]),
    Task.find({ project: project._id, parentTask: null, $or: [{ startDate: { $ne: null } }, { dueDate: { $ne: null } }] })
      .select("taskNumber title status startDate dueDate owner")
      .populate("owner", "name")
      .sort({ startDate: 1, dueDate: 1 })
      .limit(60)
      .lean(),
    listAttachments(user, "Project", project._id, canManageProject(ctx, project._id)),
  ]);

  const openMap = new Map(openByOwner.filter((r) => r._id).map((r) => [r._id.toString(), r.n]));
  const mcount = new Map(milestoneCounts.map((m) => [m._id.toString(), m]));
  const manage = canManageProject(ctx, project._id);
  const writable = manage && !project.isArchived;
  const taskDepartments =
    project.isArchived || ["COMPLETED", "CANCELLED"].includes(project.status) || !hasPermission(user.role, "task:manage")
      ? []
      : taskCreationDepartments(ctx, project);

  return {
    ...toProjectDTO(p, progress.get(id), members.filter((m) => m.isActive).length),
    notes: p?.notes ?? "",
    members: members.filter((m) => m.isActive).map((m) => toMemberDTO(m, openMap)),
    formerMembers: members.filter((m) => !m.isActive).map((m) => toMemberDTO(m, openMap)),
    milestones: milestones.map(
      (m): MilestoneDTO => ({
        id: m._id.toString(),
        title: m.title,
        description: m.description ?? "",
        dueDate: iso(m.dueDate),
        status: m.status as MilestoneStatus,
        completedAt: iso(m.completedAt),
        taskCount: mcount.get(m._id.toString())?.total ?? 0,
        completedTaskCount: mcount.get(m._id.toString())?.done ?? 0,
      })
    ),
    documents,
    timeline: timeline.map((t) => ({
      id: t._id.toString(),
      taskNumber: t.taskNumber,
      title: t.title,
      status: t.status as TaskStatus,
      startDate: iso(t.startDate),
      dueDate: iso(t.dueDate),
      owner: (t.owner as any)?.name ?? null,
    })),
    can: {
      edit: writable,
      manageTeam: writable,
      archive: manage,
      createTask: taskDepartments.length > 0,
      taskDepartments,
    },
  };
}

/** Active team members of a project, optionally limited to one department. */
export async function getProjectTeam(user: CurrentUser, id: string, department?: string): Promise<TeamMemberOptionDTO[]> {
  const { project } = await loadVisibleProject(user, id);
  const filter: Filter = { project: project._id, isActive: true };
  if (department) filter.department = oid(department);
  const rows = await ProjectMember.find(filter).populate("user", "name email employeeId designation status department").lean();
  return rows
    .filter((m: any) => m.user && m.user.status === "ACTIVE")
    .map((m: any) => ({
      id: m.user._id.toString(),
      name: m.user.name,
      email: m.user.email,
      employeeId: m.user.employeeId,
      designation: m.user.designation ?? "",
      departmentId: m.department ? m.department.toString() : null,
      projectRole: m.projectRole as ProjectMemberRole,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export async function createProject(user: CurrentUser, input: CreateInput): Promise<ProjectDTO> {
  if (!hasPermission(user.role, "project:manage")) throw forbidden();
  const managerId = await resolveManager(user, input.manager);
  const members = input.members.filter((m) => m.user !== managerId.toString());
  await validateAllocation(input.departments, members);

  const project = await Project.create({
    code: await generateProjectCode(),
    name: input.name,
    client: input.client,
    description: input.description,
    notes: input.notes,
    status: input.status,
    priority: input.priority,
    budget: input.budget,
    approvalMode: input.approvalMode,
    departments: [...new Set(input.departments)].map(oid),
    manager: managerId,
    startDate: toDate(input.startDate),
    endDate: toEndOfDay(input.endDate),
    createdBy: oid(user.id),
  });

  await syncManagerMembership(project._id, managerId, user.id);
  if (members.length) {
    await ProjectMember.insertMany(
      members.map((m) => ({
        project: project._id,
        user: oid(m.user),
        department: oid(m.department),
        projectRole: m.projectRole,
        addedBy: oid(user.id),
      }))
    );
  }

  await recordAudit({
    actorId: user.id,
    action: "project.create",
    entityType: "Project",
    entityId: project._id,
    summary: `Created project ${project.name} (${project.code}) with ${members.length} allocated employee(s)`,
  });
  await notify({
    recipients: [managerId],
    actorId: user.id,
    type: "PROJECT",
    title: "You are managing a new project",
    message: `${project.name} (${project.code}) was assigned to you.`,
    link: `/projects/${project._id}`,
    entityType: "Project",
    entityId: project._id,
  });
  await notify({
    recipients: members.map((m) => m.user),
    actorId: user.id,
    type: "PROJECT",
    title: "Added to a project", pref: "project",
    message: `You have been allocated to ${project.name} (${project.code}).`,
    link: `/projects/${project._id}`,
    entityType: "Project",
    entityId: project._id,
  });

  const fresh = await Project.findById(project._id).populate("manager", USER_REF_FIELDS).populate("departments", DEPT_REF_FIELDS).lean();
  return toProjectDTO(fresh, EMPTY_PROGRESS, members.length + 1);
}

export async function updateProject(user: CurrentUser, id: string, input: UpdateInput): Promise<ProjectDTO> {
  const { project } = await loadManagedProject(user, id);
  const update: Record<string, unknown> = {};

  for (const f of ["name", "client", "description", "notes", "priority", "status", "budget", "approvalMode"] as const) {
    if (input[f] !== undefined && input[f] !== (project as any)[f]) update[f] = input[f];
  }
  if (input.startDate !== undefined) update.startDate = toDate(input.startDate);
  if (input.endDate !== undefined) update.endDate = toEndOfDay(input.endDate);

  // Manager changes: Super Admin only.
  if (input.manager !== undefined && input.manager && input.manager !== project.manager.toString()) {
    if (user.role !== "SUPER_ADMIN") throw forbidden("Only a Super Admin can change the project manager");
    update.manager = await resolveManager(user, input.manager);
  }

  if (update.status === "COMPLETED") {
    const open = await Task.countDocuments({ project: project._id, status: { $in: OPEN_TASK_STATUSES } });
    if (open) throw conflict(`Cannot complete the project: ${open} task(s) are still open`);
  }

  // Department changes
  let removedDepts: string[] = [];
  if (input.departments) {
    const current = project.departments.map((d) => d.toString());
    const next = [...new Set(input.departments)];
    const added = next.filter((d) => !current.includes(d));
    removedDepts = current.filter((d) => !next.includes(d));
    if (added.length) await validateAllocation(added, []);
    for (const d of removedDepts) {
      const open = await Task.countDocuments({ project: project._id, department: oid(d), status: { $in: OPEN_TASK_STATUSES } });
      if (open) {
        const dept = await Department.findById(d).select("name").lean();
        throw conflict(`${dept?.name ?? "A department"} still has ${open} open task(s) in this project. Reassign or close them first.`);
      }
    }
    if (added.length || removedDepts.length) update.departments = next.map(oid);
  }

  if (!Object.keys(update).length) {
    const same = await Project.findById(id).populate("manager", USER_REF_FIELDS).populate("departments", DEPT_REF_FIELDS).lean();
    return toProjectDTO(same, (await progressFor([project._id])).get(id));
  }

  const before = project.toObject() as Record<string, unknown>;
  await Project.updateOne({ _id: project._id }, { $set: update }, { runValidators: true });

  if (removedDepts.length) {
    // Members of removed departments leave the project; their history stays.
    await ProjectMember.updateMany(
      { project: project._id, department: { $in: removedDepts.map(oid) }, isActive: true, projectRole: { $ne: "MANAGER" } },
      { $set: { isActive: false, leftAt: new Date() } }
    );
  }
  if (update.manager) await syncManagerMembership(project._id, update.manager as Types.ObjectId, user.id);

  const changes = diffFields(before, update, [
    "name", "client", "description", "notes", "priority", "status", "budget", "approvalMode", "startDate", "endDate", "manager", "departments",
  ]);
  await recordAudit({
    actorId: user.id,
    action: "project.update",
    entityType: "Project",
    entityId: project._id,
    summary: `Updated ${project.name}: ${Object.keys(changes).join(", ")}`,
    changes,
  });
  if (update.manager) {
    await notify({
      recipients: [update.manager as Types.ObjectId],
      actorId: user.id,
      type: "PROJECT",
      title: "You are managing a project",
      message: `You are now the manager of ${project.name}.`,
      link: `/projects/${project._id}`,
    });
  }

  const fresh = await Project.findById(id).populate("manager", USER_REF_FIELDS).populate("departments", DEPT_REF_FIELDS).lean();
  return toProjectDTO(fresh, (await progressFor([project._id])).get(id));
}

export async function setProjectArchived(user: CurrentUser, id: string, archived: boolean): Promise<void> {
  const { project } = await loadManagedProject(user, id, { allowArchived: true });
  if (!!project.isArchived === archived) return;
  await Project.updateOne(
    { _id: project._id },
    { $set: { isArchived: archived, archivedAt: archived ? new Date() : null, archivedBy: archived ? oid(user.id) : null } }
  );
  await recordAudit({
    actorId: user.id,
    action: archived ? "project.archive" : "project.unarchive",
    entityType: "Project",
    entityId: project._id,
    summary: `${archived ? "Archived" : "Unarchived"} project ${project.name}`,
  });
}

export async function updateProjectMembers(
  user: CurrentUser,
  id: string,
  input: MembersInput
): Promise<{ added: number; removed: number; updated: number; openTasksOfRemoved: number }> {
  const { project } = await loadManagedProject(user, id);
  const projectDepts = project.departments.map((d) => d.toString());
  const managerId = project.manager.toString();

  if (input.add.some((m) => m.user === managerId) || input.remove.includes(managerId)) {
    throw unprocessable("The project manager's membership is managed through the project's manager field");
  }
  await validateAllocation(projectDepts, input.add);

  let added = 0;
  for (const m of input.add) {
    const res = await ProjectMember.updateOne(
      { project: project._id, user: oid(m.user) },
      {
        $set: { department: oid(m.department), projectRole: m.projectRole, isActive: true, leftAt: null },
        $setOnInsert: { joinedAt: new Date(), addedBy: oid(user.id) },
      },
      { upsert: true }
    );
    if (res.upsertedCount || res.modifiedCount) added++;
  }

  let removed = 0;
  let openTasksOfRemoved = 0;
  if (input.remove.length) {
    const removeIds = input.remove.map(oid);
    const res = await ProjectMember.updateMany(
      { project: project._id, user: { $in: removeIds }, isActive: true },
      { $set: { isActive: false, leftAt: new Date() } }
    );
    removed = res.modifiedCount;
    openTasksOfRemoved = await Task.countDocuments({ project: project._id, owner: { $in: removeIds }, status: { $in: OPEN_TASK_STATUSES } });
  }

  let updated = 0;
  for (const u of input.update) {
    if (u.user === managerId) continue;
    const res = await ProjectMember.updateOne(
      { project: project._id, user: oid(u.user), isActive: true },
      { $set: { projectRole: u.projectRole } }
    );
    updated += res.modifiedCount;
  }

  if (added || removed || updated) {
    await recordAudit({
      actorId: user.id,
      action: "project.members",
      entityType: "Project",
      entityId: project._id,
      summary: `${project.name}: allocated ${added}, removed ${removed}, updated ${updated} member(s)`,
      changes: {
        added: { from: null, to: input.add.map((m) => m.user) },
        removed: { from: input.remove, to: null },
      },
    });
    await notify({
      recipients: input.add.map((m) => m.user),
      actorId: user.id,
      type: "PROJECT",
      title: "Added to a project", pref: "project",
      message: `You have been allocated to ${project.name} (${project.code}).`,
      link: `/projects/${project._id}`,
      entityType: "Project",
      entityId: project._id,
    });
    await notify({
      recipients: input.remove,
      actorId: user.id,
      type: "PROJECT",
      title: "Removed from a project", pref: "project",
      message: `You are no longer allocated to ${project.name} (${project.code}).`,
      entityType: "Project",
      entityId: project._id,
    });
  }
  return { added, removed, updated, openTasksOfRemoved };
}

/* ------------------------------------------------------------------ */
/* Milestones                                                          */
/* ------------------------------------------------------------------ */

export async function createMilestone(user: CurrentUser, projectId: string, input: z.output<typeof createMilestoneSchema>) {
  const { project } = await loadManagedProject(user, projectId);
  const count = await Milestone.countDocuments({ project: project._id });
  const m = await Milestone.create({
    project: project._id,
    title: input.title,
    description: input.description,
    dueDate: toEndOfDay(input.dueDate),
    status: input.status,
    completedAt: input.status === "COMPLETED" ? new Date() : null,
    order: count + 1,
    createdBy: oid(user.id),
  });
  await recordAudit({
    actorId: user.id,
    action: "project.milestone_create",
    entityType: "Project",
    entityId: project._id,
    summary: `Added milestone "${m.title}" to ${project.name}`,
  });
  return { id: m._id.toString() };
}

export async function updateMilestone(
  user: CurrentUser,
  projectId: string,
  milestoneId: string,
  input: z.output<typeof updateMilestoneSchema>
) {
  const { project } = await loadManagedProject(user, projectId);
  const m = await Milestone.findOne({ _id: oid(milestoneId), project: project._id });
  if (!m) throw notFound("Milestone not found");
  const update: Record<string, unknown> = {};
  if (input.title !== undefined) update.title = input.title;
  if (input.description !== undefined) update.description = input.description;
  if (input.dueDate !== undefined) update.dueDate = toEndOfDay(input.dueDate);
  if (input.status !== undefined && input.status !== m.status) {
    update.status = input.status;
    update.completedAt = input.status === "COMPLETED" ? new Date() : null;
  }
  await Milestone.updateOne({ _id: m._id }, { $set: update });
  await recordAudit({
    actorId: user.id,
    action: "project.milestone_update",
    entityType: "Project",
    entityId: project._id,
    summary: `Updated milestone "${(update.title as string) ?? m.title}"${update.status ? ` → ${String(update.status).toLowerCase()}` : ""}`,
  });
}

export async function deleteMilestone(user: CurrentUser, projectId: string, milestoneId: string) {
  const { project } = await loadManagedProject(user, projectId);
  const m = await Milestone.findOneAndDelete({ _id: oid(milestoneId), project: project._id });
  if (!m) throw notFound("Milestone not found");
  await Task.updateMany({ milestone: m._id }, { $set: { milestone: null } });
  await recordAudit({
    actorId: user.id,
    action: "project.milestone_delete",
    entityType: "Project",
    entityId: project._id,
    summary: `Deleted milestone "${m.title}" from ${project.name}`,
  });
}

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

/** Project history = project audit entries + task activity, newest first. */
export async function getProjectActivity(
  user: CurrentUser,
  id: string,
  page: number,
  pageSize: number
): Promise<Paginated<ActivityDTO>> {
  const { project } = await loadVisibleProject(user, id);
  const take = page * pageSize;
  const auditFilter = { entityType: "Project", entityId: project._id };
  const taskFilter = { project: project._id };
  const [audits, tasks, auditTotal, taskTotal] = await Promise.all([
    AuditLog.find(auditFilter).sort({ createdAt: -1 }).limit(take).populate("actor", USER_REF_FIELDS).lean(),
    TaskActivity.find(taskFilter).sort({ createdAt: -1 }).limit(take).populate("actor", USER_REF_FIELDS).populate("task", "taskNumber title").lean(),
    AuditLog.countDocuments(auditFilter),
    TaskActivity.countDocuments(taskFilter),
  ]);
  const merged: ActivityDTO[] = [
    ...audits.map((a) => ({
      id: a._id.toString(),
      action: a.action,
      entityType: "Project",
      entityId: project._id.toString(),
      summary: a.summary ?? "",
      actor: toUserRef(a.actor),
      createdAt: iso(a.createdAt)!,
    })),
    ...tasks.map((t: any) => ({
      id: t._id.toString(),
      action: `task.${String(t.action).toLowerCase()}`,
      entityType: "Task",
      entityId: t.task?._id?.toString() ?? null,
      summary: `${t.task?.taskNumber ? `${t.task.taskNumber} · ` : ""}${t.message || t.action}`,
      actor: toUserRef(t.actor),
      createdAt: iso(t.createdAt)!,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return paginate(merged.slice((page - 1) * pageSize, take), auditTotal + taskTotal, page, pageSize);
}

