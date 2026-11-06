import "server-only";
import type { Types } from "mongoose";
import type { z } from "zod";
import type { CurrentUser } from "@/lib/auth/current-user";
import { conflict, escapeRegex, forbidden, notFound, paginate, unprocessable } from "@/lib/api";
import { diffFields, recordAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { getRoleByKey } from "@/lib/roles";
import { hasPermission } from "@/lib/permissions";
import {
  CLOSED_TASK_STATUSES,
  OPEN_PROJECT_STATUSES,
  OPEN_TASK_STATUSES,
  TASK_STATUSES,
  type DepartmentStatus,
  type ProjectStatus,
  type TaskStatus,
} from "@/lib/constants";
import type {
  createDepartmentSchema,
  departmentListQuerySchema,
  departmentMembersSchema,
  updateDepartmentSchema,
} from "@/lib/validations/department";
import { Department, Project, Task, User } from "@/models";
import type { DepartmentDetailDTO, DepartmentDTO, DepartmentOptionDTO, Paginated } from "@/types/dto";
import { headedDepartmentIds, includesId, oid, visibleDepartmentIds, type Filter } from "./scope";
import { iso, toTaskSummary, toUserRef, USER_REF_FIELDS } from "./mappers";

/* eslint-disable @typescript-eslint/no-explicit-any */

type CreateInput = z.output<typeof createDepartmentSchema>;
type UpdateInput = z.output<typeof updateDepartmentSchema>;
type ListQuery = z.output<typeof departmentListQuerySchema>;
type MembersInput = z.output<typeof departmentMembersSchema>;

type Counts = { employees: Map<string, number>; projects: Map<string, number>; tasks: Map<string, number> };

async function countsFor(ids: Types.ObjectId[]): Promise<Counts> {
  const [emp, proj, tasks] = await Promise.all([
    User.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { department: { $in: ids } } },
      { $group: { _id: "$department", n: { $sum: 1 } } },
    ]),
    Project.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { departments: { $in: ids }, status: { $in: OPEN_PROJECT_STATUSES } } },
      { $unwind: "$departments" },
      { $match: { departments: { $in: ids } } },
      { $group: { _id: "$departments", n: { $sum: 1 } } },
    ]),
    Task.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { department: { $in: ids }, status: { $in: OPEN_TASK_STATUSES } } },
      { $group: { _id: "$department", n: { $sum: 1 } } },
    ]),
  ]);
  const toMap = (rows: { _id: Types.ObjectId; n: number }[]) => new Map(rows.map((r) => [r._id.toString(), r.n]));
  return { employees: toMap(emp), projects: toMap(proj), tasks: toMap(tasks) };
}

function toDepartmentDTO(d: any, counts: Counts): DepartmentDTO {
  const id = d._id.toString();
  return {
    id,
    name: d.name,
    code: d.code,
    description: d.description ?? "",
    color: d.color ?? "#16a34a",
    status: d.status as DepartmentStatus,
    head: toUserRef(d.head),
    teamLeaders: (d.teamLeaders ?? []).map(toUserRef).filter(Boolean),
    employeeCount: counts.employees.get(id) ?? 0,
    activeProjects: counts.projects.get(id) ?? 0,
    openTasks: counts.tasks.get(id) ?? 0,
    createdAt: iso(d.createdAt)!,
    updatedAt: iso(d.updatedAt)!,
  };
}

async function assertVisible(actor: CurrentUser, id: string) {
  if (!hasPermission(actor.role, "department:read")) throw forbidden();
  const visible = await visibleDepartmentIds(actor);
  if (!includesId(visible, id)) throw notFound("Department not found");
}

/**
 * Leadership rules:
 *  - The head must be an active user with the Department Head role.
 *  - Team leaders must be active Team Leaders whose primary department is this
 *    one (or unassigned — they are then moved into it).
 */
async function validateLeadership(
  input: { head?: string | null; teamLeaders?: string[] },
  departmentId: string | null
) {
  const fieldErrors: Record<string, string> = {};

  if (input.head) {
    const dhRole = await getRoleByKey("DEPARTMENT_HEAD");
    const head = await User.findById(input.head).select("name role status").lean();
    if (!head) fieldErrors.head = "User not found";
    else if (head.status !== "ACTIVE") fieldErrors.head = `${head.name} is inactive`;
    else if (head.role.toString() !== dhRole.id) fieldErrors.head = `${head.name} does not have the Department Head role`;
  }

  if (input.teamLeaders?.length) {
    const tlRole = await getRoleByKey("TEAM_LEADER");
    const ids = [...new Set(input.teamLeaders)];
    const users = await User.find({ _id: { $in: ids.map(oid) } }).select("name role status department").lean();
    if (users.length !== ids.length) fieldErrors.teamLeaders = "One or more selected users were not found";
    for (const u of users) {
      if (u.status !== "ACTIVE") fieldErrors.teamLeaders = `${u.name} is inactive`;
      else if (u.role.toString() !== tlRole.id) fieldErrors.teamLeaders = `${u.name} does not have the Team Leader role`;
      else if (u.department && u.department.toString() !== departmentId) {
        fieldErrors.teamLeaders = `${u.name} belongs to another department`;
      }
    }
  }

  if (Object.keys(fieldErrors).length) throw unprocessable(Object.values(fieldErrors)[0], fieldErrors);
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function listDepartments(
  actor: CurrentUser,
  query: ListQuery
): Promise<Paginated<DepartmentDTO> | DepartmentOptionDTO[]> {
  if (!hasPermission(actor.role, "department:read")) throw forbidden();
  const visible = await visibleDepartmentIds(actor);
  const and: Filter[] = [];
  if (visible) and.push({ _id: { $in: visible } });
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    and.push({ $or: [{ name: rx }, { code: rx }, { description: rx }] });
  }
  if (query.status) and.push({ status: query.status });
  const filter = and.length ? { $and: and } : {};

  if (query.all) {
    const rows = await Department.find(filter).select("name code color status").sort({ name: 1 }).lean();
    return rows.map((d) => ({
      id: d._id.toString(),
      name: d.name,
      code: d.code,
      color: d.color ?? "#16a34a",
      status: d.status as DepartmentStatus,
    }));
  }

  const [rows, total] = await Promise.all([
    Department.find(filter)
      .sort({ name: 1 })
      .collation({ locale: "en", strength: 2 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .populate("head", USER_REF_FIELDS)
      .populate("teamLeaders", USER_REF_FIELDS)
      .lean(),
    Department.countDocuments(filter),
  ]);
  const counts = await countsFor(rows.map((r) => r._id));
  return paginate(rows.map((r) => toDepartmentDTO(r, counts)), total, query.page, query.pageSize);
}

async function permissionsFor(actor: CurrentUser, departmentId: string) {
  const isSA = actor.role === "SUPER_ADMIN";
  const isHead =
    actor.role === "DEPARTMENT_HEAD" && includesId(await headedDepartmentIds(actor.id), departmentId);
  return {
    edit: isSA,
    assignHead: isSA,
    assignLeaders: isSA || (isHead && hasPermission(actor.role, "department:assign-leaders")),
    manageMembers: isSA,
    delete: isSA,
  };
}

export async function getDepartment(actor: CurrentUser, id: string): Promise<DepartmentDetailDTO> {
  await assertVisible(actor, id);
  const dept = await Department.findById(id)
    .populate("head", USER_REF_FIELDS)
    .populate("teamLeaders", USER_REF_FIELDS)
    .lean();
  if (!dept) throw notFound("Department not found");

  const _id = dept._id;
  const now = new Date();
  const [counts, employees, activeEmployees, byStatus, overdueTasks, recent, projects] = await Promise.all([
    countsFor([_id]),
    User.countDocuments({ department: _id }),
    User.countDocuments({ department: _id, status: "ACTIVE" }),
    Task.aggregate<{ _id: TaskStatus; n: number }>([
      { $match: { department: _id } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    Task.countDocuments({ department: _id, status: { $nin: CLOSED_TASK_STATUSES }, dueDate: { $lt: now } }),
    Task.find({ department: _id, status: { $in: OPEN_TASK_STATUSES } })
      .sort({ dueDate: 1, updatedAt: -1 })
      .limit(10)
      .populate("owner", USER_REF_FIELDS)
      .populate("project", "name code")
      .lean(),
    Project.find({ departments: _id }).sort({ status: 1, updatedAt: -1 }).limit(10).select("name code status progress").lean(),
  ]);

  const statusMap = new Map(byStatus.map((r) => [r._id, r.n]));
  const base = toDepartmentDTO(dept, counts);

  return {
    ...base,
    stats: {
      employees,
      activeEmployees,
      activeProjects: base.activeProjects,
      openTasks: base.openTasks,
      overdueTasks,
      inReview: statusMap.get("IN_REVIEW") ?? 0,
      completedTasks: statusMap.get("COMPLETED") ?? 0,
    },
    tasksByStatus: TASK_STATUSES.map((status) => ({ status, count: statusMap.get(status) ?? 0 })),
    recentTasks: recent.map(toTaskSummary),
    projects: projects.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      code: p.code,
      status: p.status as ProjectStatus,
      progress: p.progress ?? 0,
    })),
    can: await permissionsFor(actor, id),
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

async function assertUniqueNameCode(name: string | undefined, code: string | undefined, excludeId?: Types.ObjectId) {
  const fieldErrors: Record<string, string> = {};
  const not = excludeId ? { _id: { $ne: excludeId } } : {};
  if (name && (await Department.findOne({ name, ...not }).collation({ locale: "en", strength: 2 }).select("_id").lean())) {
    fieldErrors.name = "A department with this name already exists";
  }
  if (code && (await Department.exists({ code, ...not }))) fieldErrors.code = "This code is already in use";
  if (Object.keys(fieldErrors).length) throw conflict(Object.values(fieldErrors)[0], fieldErrors);
}

export async function createDepartment(actor: CurrentUser, input: CreateInput): Promise<DepartmentDTO> {
  if (!hasPermission(actor.role, "department:create")) throw forbidden();
  await assertUniqueNameCode(input.name, input.code);
  await validateLeadership({ head: input.head || null, teamLeaders: input.teamLeaders }, null);

  const teamLeaders = [...new Set(input.teamLeaders ?? [])].map(oid);
  const dept = await Department.create({
    name: input.name,
    code: input.code,
    description: input.description ?? "",
    color: input.color,
    status: input.status,
    head: input.head ? oid(input.head) : null,
    teamLeaders,
    createdBy: oid(actor.id),
  });

  // Unassigned team leaders join the department they lead.
  if (teamLeaders.length) {
    await User.updateMany({ _id: { $in: teamLeaders }, department: null }, { $set: { department: dept._id } });
  }

  await recordAudit({
    actorId: actor.id,
    action: "department.create",
    entityType: "Department",
    entityId: dept._id,
    summary: `Created department ${dept.name} (${dept.code})`,
  });
  await notify({
    recipients: [dept.head],
    actorId: actor.id,
    type: "DEPARTMENT",
    title: "You are now a Department Head",
    message: `You have been assigned as head of ${dept.name}.`,
    link: `/departments/${dept._id}`,
    entityType: "Department",
    entityId: dept._id,
  });
  await notify({
    recipients: teamLeaders,
    actorId: actor.id,
    type: "DEPARTMENT",
    title: "Team Leader assignment",
    message: `You have been assigned as a Team Leader in ${dept.name}.`,
    link: `/departments/${dept._id}`,
    entityType: "Department",
    entityId: dept._id,
  });

  const fresh = await Department.findById(dept._id).populate("head", USER_REF_FIELDS).populate("teamLeaders", USER_REF_FIELDS).lean();
  return toDepartmentDTO(fresh, await countsFor([dept._id]));
}

export async function updateDepartment(actor: CurrentUser, id: string, input: UpdateInput): Promise<DepartmentDTO> {
  await assertVisible(actor, id);
  const dept = await Department.findById(id);
  if (!dept) throw notFound("Department not found");
  const can = await permissionsFor(actor, id);

  const update: Record<string, unknown> = {};
  const generalFields = ["name", "code", "description", "color", "status"] as const;
  for (const f of generalFields) {
    if (input[f] !== undefined && input[f] !== (dept as any)[f]) {
      if (!can.edit) throw forbidden("You can only manage team leaders for this department");
      update[f] = input[f];
    }
  }
  if (update.name || update.code) {
    await assertUniqueNameCode(update.name as string | undefined, update.code as string | undefined, dept._id);
  }

  const currentHead = dept.head ? dept.head.toString() : null;
  const newHead = input.head === undefined ? currentHead : input.head || null;
  if (newHead !== currentHead) {
    if (!can.assignHead) throw forbidden("You cannot change the department head");
    update.head = newHead ? oid(newHead) : null;
  }

  const currentLeaders = (dept.teamLeaders ?? []).map((t) => t.toString()).sort();
  const newLeaders = input.teamLeaders === undefined ? currentLeaders : [...new Set(input.teamLeaders)].sort();
  const leadersChanged = JSON.stringify(currentLeaders) !== JSON.stringify(newLeaders);
  if (leadersChanged) {
    if (!can.assignLeaders) throw forbidden("You cannot change team leaders for this department");
    update.teamLeaders = newLeaders.map(oid);
  }

  if (update.status === "ARCHIVED") {
    const openProjects = await Project.countDocuments({ departments: dept._id, status: { $in: OPEN_PROJECT_STATUSES } });
    if (openProjects) throw conflict(`Cannot archive: ${openProjects} active project(s) still include this department`);
  }

  await validateLeadership(
    {
      head: update.head !== undefined ? newHead : undefined,
      teamLeaders: leadersChanged ? newLeaders.filter((l) => !currentLeaders.includes(l)) : undefined,
    },
    id
  );

  if (!Object.keys(update).length) {
    const same = await Department.findById(id).populate("head", USER_REF_FIELDS).populate("teamLeaders", USER_REF_FIELDS).lean();
    return toDepartmentDTO(same, await countsFor([dept._id]));
  }

  const before = dept.toObject() as Record<string, unknown>;
  await Department.updateOne({ _id: dept._id }, { $set: update }, { runValidators: true });

  if (leadersChanged) {
    await User.updateMany({ _id: { $in: newLeaders.map(oid) }, department: null }, { $set: { department: dept._id } });
  }

  const changes = diffFields(before, update, [...generalFields, "head", "teamLeaders"]);
  await recordAudit({
    actorId: actor.id,
    action: update.head !== undefined ? "department.assign_head" : leadersChanged ? "department.assign_leaders" : "department.update",
    entityType: "Department",
    entityId: dept._id,
    summary: `Updated ${dept.name}: ${Object.keys(changes).join(", ")}`,
    changes,
  });

  const name = (update.name as string) ?? dept.name;
  if (update.head) {
    await notify({
      recipients: [update.head as Types.ObjectId],
      actorId: actor.id,
      type: "DEPARTMENT",
      title: "You are now a Department Head",
      message: `You have been assigned as head of ${name}.`,
      link: `/departments/${dept._id}`,
      entityType: "Department",
      entityId: dept._id,
    });
  }
  if (leadersChanged) {
    const added = newLeaders.filter((l) => !currentLeaders.includes(l));
    await notify({
      recipients: added,
      actorId: actor.id,
      type: "DEPARTMENT",
      title: "Team Leader assignment",
      message: `You have been assigned as a Team Leader in ${name}.`,
      link: `/departments/${dept._id}`,
      entityType: "Department",
      entityId: dept._id,
    });
  }

  const fresh = await Department.findById(id).populate("head", USER_REF_FIELDS).populate("teamLeaders", USER_REF_FIELDS).lean();
  return toDepartmentDTO(fresh, await countsFor([dept._id]));
}

export async function manageDepartmentMembers(
  actor: CurrentUser,
  id: string,
  input: MembersInput
): Promise<{ added: number; removed: number }> {
  if (!hasPermission(actor.role, "department:manage-members")) throw forbidden();
  const dept = await Department.findById(id).select("name status");
  if (!dept) throw notFound("Department not found");

  const addIds = [...new Set(input.add)].map(oid);
  const removeIds = [...new Set(input.remove)].map(oid);

  let added = 0;
  if (addIds.length) {
    if (dept.status !== "ACTIVE") throw unprocessable("Cannot add employees to an archived department");
    const users = await User.find({ _id: { $in: addIds } }).select("_id department").lean();
    if (users.length !== addIds.length) throw unprocessable("One or more employees were not found");
    const moving = users.filter((u) => u.department?.toString() !== id).map((u) => u._id);
    if (moving.length) {
      // A team leader leaving their old department stops leading it.
      await Department.updateMany(
        { _id: { $ne: dept._id }, teamLeaders: { $in: moving } },
        { $pull: { teamLeaders: { $in: moving } } }
      );
      const res = await User.updateMany({ _id: { $in: moving } }, { $set: { department: dept._id } });
      added = res.modifiedCount;
      await notify({
        recipients: moving,
        actorId: actor.id,
        type: "DEPARTMENT",
        title: "Department assignment",
        message: `You have been added to ${dept.name}.`,
        link: `/departments/${dept._id}`,
        entityType: "Department",
        entityId: dept._id,
      });
    }
  }

  let removed = 0;
  if (removeIds.length) {
    const res = await User.updateMany({ _id: { $in: removeIds }, department: dept._id }, { $set: { department: null } });
    removed = res.modifiedCount;
    await Department.updateOne({ _id: dept._id }, { $pull: { teamLeaders: { $in: removeIds } } });
  }

  if (added || removed) {
    await recordAudit({
      actorId: actor.id,
      action: "department.members",
      entityType: "Department",
      entityId: dept._id,
      summary: `${dept.name}: added ${added}, removed ${removed} employee(s)`,
      changes: {
        added: { from: null, to: addIds.map(String) },
        removed: { from: removeIds.map(String), to: null },
      },
    });
  }
  return { added, removed };
}

export async function deleteDepartment(actor: CurrentUser, id: string): Promise<void> {
  if (!hasPermission(actor.role, "department:delete")) throw forbidden();
  const dept = await Department.findById(id).select("name code");
  if (!dept) throw notFound("Department not found");

  const [employees, projects, tasks] = await Promise.all([
    User.countDocuments({ department: dept._id }),
    Project.countDocuments({ departments: dept._id, status: { $in: OPEN_PROJECT_STATUSES } }),
    Task.countDocuments({ department: dept._id, status: { $in: OPEN_TASK_STATUSES } }),
  ]);
  const blockers: string[] = [];
  if (employees) blockers.push(`${employees} employee(s)`);
  if (projects) blockers.push(`${projects} active project(s)`);
  if (tasks) blockers.push(`${tasks} open task(s)`);
  if (blockers.length) {
    throw conflict(`Cannot delete ${dept.name}: it still has ${blockers.join(", ")}. Reassign them or archive the department instead.`);
  }

  await Department.deleteOne({ _id: dept._id });
  // Detach historical references so nothing points to a missing department.
  await Promise.all([
    Project.updateMany({ departments: dept._id }, { $pull: { departments: dept._id } }),
    Task.updateMany({ department: dept._id }, { $set: { department: null } }),
  ]);
  await recordAudit({
    actorId: actor.id,
    action: "department.delete",
    entityType: "Department",
    entityId: dept._id,
    summary: `Deleted department ${dept.name} (${dept.code})`,
  });
}
