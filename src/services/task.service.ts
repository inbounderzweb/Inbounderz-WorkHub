import "server-only";
import type { Types } from "mongoose";
import type { z } from "zod";
import { utcDayRange } from "@/lib/dates";
import type { CurrentUser } from "@/lib/auth/current-user";
import { escapeRegex, forbidden, notFound, paginate, unprocessable } from "@/lib/api";
import { notify } from "@/lib/notify";
import { recordAudit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import {
  APPROVAL_MODE_LABELS,
  CLOSED_TASK_STATUSES,
  DEPENDENCY_GATED_STATUSES,
  TASK_PRIORITIES,
  humanize,
  type ApprovalMode,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/constants";
import { allowedTransitions, reviewAvailable, type WorkflowContext } from "@/lib/task-workflow";
import type {
  assignTaskSchema,
  createTaskSchema,
  taskListQuerySchema,
  updateTaskSchema,
} from "@/lib/validations/task";
import { Department, Milestone, Project, ProjectMember, Task, TaskActivity, TaskComment, Ticket, User } from "@/models";
import type { TASK_ACTIVITY_ACTIONS } from "@/models/TaskActivity";

type ActivityAction = (typeof TASK_ACTIVITY_ACTIONS)[number];
import type { Paginated, TaskDetailDTO, TaskListItemDTO, TaskRefDTO } from "@/types/dto";
import {
  accessContext,
  canManageTask,
  canReviewTask,
  canViewProject,
  canViewTask,
  isCollaborator,
  isOwner,
  taskCreationDepartments,
  taskVisibilityFilter,
  type AccessContext,
} from "./access";
import { listAttachments } from "./attachment.service";
import { DEPT_REF_FIELDS, iso, isOverdue, toDepartmentRef, toUserRef, USER_REF_FIELDS } from "./mappers";
import { refreshProjectProgress } from "./progress.service";
import { generateTaskNumber } from "./numbering";
import { disabledTaskStatuses } from "@/lib/settings";
import { linkedTaskMovesFor, startWorkFromLinkedTask } from "./ticket.service";
import { oid, type Filter } from "./scope";

/* eslint-disable @typescript-eslint/no-explicit-any */

type CreateInput = z.output<typeof createTaskSchema>;
type UpdateInput = z.output<typeof updateTaskSchema>;
type ListQuery = z.output<typeof taskListQuerySchema>;

const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const toDueDate = (s: string | null | undefined) => (s ? new Date(`${s}T23:59:59.000Z`) : null);
/** Id as string, whether the value is an ObjectId, a string or a populated document. */
const s = (v: unknown): string =>
  !v ? "" : typeof v === "object" && "_id" in (v as object) ? String((v as { _id: unknown })._id) : String(v);
const uniq = (ids: string[]) => [...new Set(ids)];

/* ------------------------------------------------------------------ */
/* Loading & permission helpers                                        */
/* ------------------------------------------------------------------ */

type TaskDoc = NonNullable<Awaited<ReturnType<typeof Task.findById>>>;

async function loadTaskForUser(user: CurrentUser, id: string) {
  if (!hasPermission(user.role, "task:read")) throw forbidden();
  const ctx = await accessContext(user);
  const task = await Task.findById(id);
  if (!task || !canViewTask(ctx, task)) throw notFound("Task not found");
  const project = task.project ? await Project.findById(task.project).select("name code manager departments isArchived status approvalMode").lean() : null;
  return { ctx, task, project };
}

/** Owner/collaborator rights only count while the person is still on the project team. */
function roles(ctx: AccessContext, task: TaskDoc | any) {
  const activeOnProject = !task.project || ctx.memberOf.has(s(task.project)) || ctx.managed.has(s(task.project));
  const manage = canManageTask(ctx, task);
  return {
    manage,
    owner: isOwner(ctx, task) && activeOnProject,
    collaborator: isCollaborator(ctx, task) && activeOnProject,
    review: canReviewTask(ctx, task),
  };
}

function assertWritable(project: { isArchived?: boolean | null } | null) {
  if (project?.isArchived) throw unprocessable("This project is archived. Its tasks are read-only.");
}

const isInternalRequest = (task: any) => task?.sourceType === "internal_ticket" || !!task?.linkedTicket;

/** Internal-request tasks mirror their ticket: these changes must be made on the ticket. */
async function assertNotInternalRequest(task: any, what: string) {
  if (!isInternalRequest(task)) return;
  const ticket = await Ticket.findById(task.linkedTicket).select("ticketNumber").lean();
  throw unprocessable(`This is an internal request. ${what} on ticket ${ticket?.ticketNumber ?? ""}`.trim());
}

function workflowContext(task: any, r: ReturnType<typeof roles>): WorkflowContext {
  return {
    status: task.status as TaskStatus,
    approvalRequired: task.approvalRequired !== false,
    isOwner: r.owner,
    canManage: r.manage,
    canReview: r.review,
  };
}

async function unresolvedDependencies(depIds: Types.ObjectId[]): Promise<TaskRefDTO[]> {
  if (!depIds?.length) return [];
  const deps = await Task.find({ _id: { $in: depIds }, status: { $nin: CLOSED_TASK_STATUSES } })
    .select("taskNumber title status")
    .lean();
  return deps.map((d) => ({ id: d._id.toString(), taskNumber: d.taskNumber, title: d.title, status: d.status as TaskStatus }));
}

/** Validates that a user is an active member of the project (optionally in a department). */
async function assertProjectMember(projectId: Types.ObjectId, userId: string, department: string | null, label: string) {
  const filter: Filter = { project: projectId, user: oid(userId), isActive: true };
  if (department) filter.department = oid(department);
  const [member, user] = await Promise.all([
    ProjectMember.findOne(filter).select("_id").lean(),
    User.findById(userId).select("name status").lean(),
  ]);
  if (!user) throw unprocessable(`${label} not found`);
  if (!member) {
    throw unprocessable(
      department
        ? `${user.name} is not allocated to this project under the selected department`
        : `${user.name} is not an active member of this project team`,
      { [label === "Owner" ? "owner" : "collaborators"]: "Not an eligible project member" }
    );
  }
  if (user.status !== "ACTIVE") throw unprocessable(`${user.name} is inactive`);
  return user;
}

async function validateDependencies(projectId: Types.ObjectId, deps: string[], selfId?: string) {
  if (!deps.length) return;
  if (selfId && deps.includes(selfId)) throw unprocessable("A task can't depend on itself", { dependencies: "Invalid dependency" });
  const rows = await Task.find({ _id: { $in: deps.map(oid) } }).select("project").lean();
  if (rows.length !== deps.length) throw unprocessable("A dependency was not found", { dependencies: "Task not found" });
  if (rows.some((r) => s(r.project) !== s(projectId))) {
    throw unprocessable("Dependencies must be tasks in the same project", { dependencies: "Different project" });
  }
  if (selfId) {
    // Walk the dependency graph from the new dependencies; reaching selfId means a cycle.
    const seen = new Set<string>();
    let frontier = deps;
    for (let depth = 0; frontier.length && depth < 50; depth++) {
      if (frontier.includes(selfId)) throw unprocessable("This would create a circular dependency", { dependencies: "Circular dependency" });
      frontier.forEach((f) => seen.add(f));
      const next = await Task.find({ _id: { $in: frontier.map(oid) } }).select("dependencies").lean();
      frontier = uniq(next.flatMap((n) => (n.dependencies ?? []).map(String))).filter((x) => !seen.has(x));
    }
  }
}

async function validateMilestone(projectId: Types.ObjectId, milestone: string | null | undefined) {
  if (!milestone) return;
  if (!(await Milestone.exists({ _id: oid(milestone), project: projectId }))) {
    throw unprocessable("Milestone not found in this project", { milestone: "Milestone not found" });
  }
}

async function activity(task: { _id: Types.ObjectId; project?: Types.ObjectId | null }, actor: string, action: ActivityAction, message: string, from: unknown = null, to: unknown = null) {
  await TaskActivity.create({ task: task._id, project: task.project ?? null, actor: oid(actor), action, message, from, to });
}

/** People who should review a task, per its approval mode. */
async function reviewersFor(task: any): Promise<string[]> {
  const project = task.project ? await Project.findById(task.project).select("manager").lean() : null;
  const managers = await ProjectMember.find({ project: task.project, projectRole: "MANAGER", isActive: true }).select("user").lean();
  const pm = uniq([s(project?.manager), ...managers.map((m) => s(m.user))].filter(Boolean));
  if (task.approvalMode === "PROJECT_MANAGER") return pm.filter((x) => x !== s(task.owner));
  const dept = task.department ? await Department.findById(task.department).select("head teamLeaders").lean() : null;
  const leads = uniq([s(dept?.head), ...(dept?.teamLeaders ?? []).map(String)].filter(Boolean)).filter((x) => x !== s(task.owner));
  return leads.length ? leads : pm.filter((x) => x !== s(task.owner));
}

async function supervisorsFor(task: any): Promise<string[]> {
  const project = task.project ? await Project.findById(task.project).select("manager").lean() : null;
  const dept = task.department ? await Department.findById(task.department).select("head teamLeaders").lean() : null;
  return uniq([s(project?.manager), s(dept?.head), ...(dept?.teamLeaders ?? []).map(String)].filter(Boolean));
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

type ListExtras = { subtasks: Map<string, number>; blockedByDeps: Set<string>; ticketMoves: Map<string, TaskStatus[]> };

function toListItem(t: any, ctx: AccessContext, extras: ListExtras): TaskListItemDTO {
  const r = roles(ctx, t);
  let allowed = allowedTransitions(workflowContext(t, r));
  if (extras.blockedByDeps.has(t._id.toString())) allowed = allowed.filter((st) => !DEPENDENCY_GATED_STATUSES.includes(st));
  // Statuses switched off in Settings are never offered.
  const off = disabledTaskStatuses();
  if (off.length) allowed = allowed.filter((st) => !off.includes(st));
  // Internal requests: only the moves the ticket workflow allows (e.g. "Start work").
  if (isInternalRequest(t)) allowed = extras.ticketMoves.get(t._id.toString()) ?? [];
  const checklist = t.checklist ?? [];
  return {
    id: t._id.toString(),
    taskNumber: t.taskNumber,
    title: t.title,
    status: t.status as TaskStatus,
    priority: t.priority as TaskPriority,
    project: t.project && typeof t.project === "object" && "name" in t.project ? { id: t.project._id.toString(), name: t.project.name, code: t.project.code } : null,
    department: toDepartmentRef(t.department),
    owner: toUserRef(t.owner),
    assignedBy: toUserRef(t.assignedBy),
    startDate: iso(t.startDate),
    dueDate: iso(t.dueDate),
    isOverdue: isOverdue(t),
    isBlocked: !!t.blocker?.isBlocked,
    parentTask: t.parentTask && typeof t.parentTask === "object" && "taskNumber" in t.parentTask
      ? { id: t.parentTask._id.toString(), taskNumber: t.parentTask.taskNumber, title: t.parentTask.title }
      : null,
    subtaskCount: extras.subtasks.get(t._id.toString()) ?? 0,
    checklist: { total: checklist.length, done: checklist.filter((c: any) => c.done).length },
    approvalRequired: t.approvalRequired !== false,
    allowedStatuses: allowed,
    updatedAt: iso(t.updatedAt)!,
    sourceType: isInternalRequest(t) ? "internal_ticket" : "project",
    linkedTicket:
      t.linkedTicket && typeof t.linkedTicket === "object" && "ticketNumber" in t.linkedTicket
        ? { id: t.linkedTicket._id.toString(), ticketNumber: t.linkedTicket.ticketNumber }
        : null,
  };
}

const LIST_POPULATE = (q: any) =>
  q
    .populate("project", "name code isArchived")
    .populate("department", DEPT_REF_FIELDS)
    .populate("owner", USER_REF_FIELDS)
    .populate("assignedBy", USER_REF_FIELDS)
    .populate("parentTask", "taskNumber title")
    .populate("linkedTicket", "ticketNumber")
    .lean();

async function listExtras(user: CurrentUser, rows: any[]): Promise<ListExtras> {
  const ids = rows.map((r) => r._id);
  const [sub, depRows] = await Promise.all([
    Task.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { parentTask: { $in: ids } } }, { $group: { _id: "$parentTask", n: { $sum: 1 } } }]),
    Task.find({ _id: { $in: rows.flatMap((r) => r.dependencies ?? []) }, status: { $nin: CLOSED_TASK_STATUSES } }).select("_id").lean(),
  ]);
  const openDeps = new Set(depRows.map((d) => d._id.toString()));
  const blockedByDeps = new Set(rows.filter((r) => (r.dependencies ?? []).some((d: any) => openDeps.has(d.toString()))).map((r) => r._id.toString()));
  const ticketMoves = await linkedTaskMovesFor(user, rows.filter(isInternalRequest));
  return { subtasks: new Map(sub.map((x) => [x._id.toString(), x.n])), blockedByDeps, ticketMoves };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function listTasks(user: CurrentUser, query: ListQuery): Promise<Paginated<TaskListItemDTO>> {
  if (!hasPermission(user.role, "task:read")) throw forbidden();
  const ctx = await accessContext(user);
  const self = oid(user.id);
  const and: Filter[] = [
    query.scope === "mine" ? { $or: [{ owner: self }, { collaborators: self }] } : taskVisibilityFilter(ctx),
  ];
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    and.push({ $or: [{ title: rx }, { taskNumber: rx }] });
  }
  if (/^[a-f\d]{24}$/i.test(query.project)) and.push({ project: oid(query.project) });
  if (/^[a-f\d]{24}$/i.test(query.department)) and.push({ department: oid(query.department) });
  if (/^[a-f\d]{24}$/i.test(query.owner)) and.push({ owner: oid(query.owner) });
  if (query.status.length) and.push({ status: { $in: query.status } });
  if (query.priority) and.push({ priority: query.priority });
  if (query.topLevel) and.push({ parentTask: null });
  if (query.source === "internal_ticket") and.push({ sourceType: "internal_ticket" });
  if (query.source === "project") and.push({ sourceType: { $ne: "internal_ticket" } });
  const now = new Date();
  if (query.due === "overdue") and.push({ dueDate: { $lt: now }, status: { $nin: CLOSED_TASK_STATUSES } });
  if (query.due === "today") and.push({ dueDate: utcDayRange(now) });
  if (query.due === "week") and.push({ dueDate: utcDayRange(now, 8) });
  if (query.due === "none") and.push({ dueDate: null });
  if (query.from || query.to) {
    const range: Filter = {};
    if (query.from) range.$gte = toDate(query.from);
    if (query.to) range.$lte = toDueDate(query.to);
    and.push({ dueDate: range });
  }
  const filter = { $and: and };
  const skip = (query.page - 1) * query.pageSize;

  let rows: any[];
  if (query.sort === "priority") {
    const ranked = await Task.aggregate<{ _id: Types.ObjectId }>([
      { $match: filter },
      { $addFields: { _rank: { $indexOfArray: [[...TASK_PRIORITIES].reverse(), "$priority"] } } },
      { $sort: { _rank: 1, dueDate: 1, _id: 1 } },
      { $skip: skip },
      { $limit: query.pageSize },
      { $project: { _id: 1 } },
    ]);
    const order = ranked.map((r) => r._id.toString());
    const found = await LIST_POPULATE(Task.find({ _id: { $in: ranked.map((r) => r._id) } }));
    rows = found.sort((a: any, b: any) => order.indexOf(a._id.toString()) - order.indexOf(b._id.toString()));
  } else {
    const field = query.sort.replace(/^-/, "");
    const dir = query.sort.startsWith("-") ? -1 : 1;
    rows = await LIST_POPULATE(Task.find(filter).sort({ [field]: dir, _id: 1 }).skip(skip).limit(query.pageSize));
  }
  const total = await Task.countDocuments(filter);
  const extras = await listExtras(user, rows);
  return paginate(rows.map((r) => toListItem(r, ctx, extras)), total, query.page, query.pageSize);
}

export async function getTask(user: CurrentUser, id: string): Promise<TaskDetailDTO> {
  const { ctx, task, project } = await loadTaskForUser(user, id);
  const t: any = await Task.findById(task._id)
    .populate("project", "name code isArchived")
    .populate("department", DEPT_REF_FIELDS)
    .populate("owner", USER_REF_FIELDS)
    .populate("assignedBy", USER_REF_FIELDS)
    .populate("createdBy", USER_REF_FIELDS)
    .populate("approvedBy", USER_REF_FIELDS)
    .populate("collaborators", USER_REF_FIELDS)
    .populate("parentTask", "taskNumber title")
    .populate("milestone", "title")
    .populate("dependencies", "taskNumber title status")
    .populate("blocker.reportedBy", USER_REF_FIELDS)
    .populate("checklist.doneBy", USER_REF_FIELDS)
    .populate("linkedTicket", "ticketNumber")
    .lean();

  const r = roles(ctx, task);
  const writable = !project?.isArchived;
  const [subtasks, dependents, comments, activityRows, attachments] = await Promise.all([
    Task.find({ parentTask: task._id }).select("taskNumber title status owner dueDate").populate("owner", USER_REF_FIELDS).sort({ createdAt: 1 }).lean(),
    Task.find({ dependencies: task._id }).select("taskNumber title status").lean(),
    TaskComment.find({ task: task._id, isDeleted: false }).sort({ createdAt: 1 }).populate("author", USER_REF_FIELDS).lean(),
    TaskActivity.find({ task: task._id }).sort({ createdAt: -1 }).limit(100).populate("actor", USER_REF_FIELDS).lean(),
    listAttachments(user, "Task", task._id, r.manage),
  ]);
  const unresolved = (t.dependencies ?? []).filter((d: any) => !CLOSED_TASK_STATUSES.includes(d.status)).length;
  const extras: ListExtras = {
    subtasks: new Map([[t._id.toString(), subtasks.length]]),
    blockedByDeps: new Set(unresolved ? [t._id.toString()] : []),
    ticketMoves: await linkedTaskMovesFor(user, isInternalRequest(t) ? [t] : []),
  };
  const base = toListItem(t, ctx, extras);
  if (!writable) base.allowedStatuses = [];
  const workers = r.manage || r.owner || r.collaborator;
  const creationDepts = project && writable && hasPermission(user.role, "task:manage") ? taskCreationDepartments(ctx, project) : [];
  const internal = isInternalRequest(t);

  return {
    ...base,
    description: t.description ?? "",
    collaborators: (t.collaborators ?? []).map(toUserRef).filter(Boolean),
    createdBy: toUserRef(t.createdBy),
    milestone: t.milestone ? { id: t.milestone._id.toString(), title: t.milestone.title } : null,
    estimatedHours: t.estimatedHours ?? null,
    actualHours: t.actualHours ?? null,
    completedAt: iso(t.completedAt),
    approvalMode: (t.approvalMode ?? "DEPARTMENT") as ApprovalMode,
    submittedAt: iso(t.submittedAt),
    approvedBy: toUserRef(t.approvedBy),
    approvedAt: iso(t.approvedAt),
    blocker: {
      isBlocked: !!t.blocker?.isBlocked,
      reason: t.blocker?.reason ?? "",
      reportedBy: toUserRef(t.blocker?.reportedBy),
      reportedAt: iso(t.blocker?.reportedAt),
    },
    checklistItems: (t.checklist ?? []).map((c: any) => ({
      id: c._id.toString(),
      text: c.text,
      done: !!c.done,
      doneBy: toUserRef(c.doneBy),
      doneAt: iso(c.doneAt),
    })),
    dependencies: (t.dependencies ?? []).map((d: any) => ({ id: d._id.toString(), taskNumber: d.taskNumber, title: d.title, status: d.status })),
    dependents: dependents.map((d) => ({ id: d._id.toString(), taskNumber: d.taskNumber, title: d.title, status: d.status as TaskStatus })),
    subtasks: subtasks.map((st) => ({
      id: st._id.toString(),
      taskNumber: st.taskNumber,
      title: st.title,
      status: st.status as TaskStatus,
      owner: toUserRef(st.owner),
      dueDate: iso(st.dueDate),
    })),
    unresolvedDependencies: unresolved,
    openSubtasks: subtasks.filter((st) => !CLOSED_TASK_STATUSES.includes(st.status as TaskStatus)).length,
    attachments,
    comments: comments.map((c) => ({
      id: c._id.toString(),
      body: c.body,
      kind: (c.kind ?? "COMMENT") as "COMMENT" | "REVIEW" | "BLOCKER",
      author: toUserRef(c.author),
      createdAt: iso(c.createdAt)!,
      attachments: [],
    })),
    activity: activityRows.map((a) => ({
      id: a._id.toString(),
      action: a.action,
      message: a.message ?? "",
      from: a.from ?? null,
      to: a.to ?? null,
      actor: toUserRef(a.actor),
      createdAt: iso(a.createdAt)!,
    })),
    can: {
      // Internal requests are edited, reassigned and reviewed on their ticket.
      edit: r.manage && writable && !internal,
      reassign: r.manage && writable && !internal,
      review: writable && !internal && reviewAvailable(workflowContext(task, r)),
      comment: writable && (workers || canViewTask(ctx, task)),
      updateChecklist: writable && workers,
      upload: writable && workers,
      reportBlocker: writable && workers && !CLOSED_TASK_STATUSES.includes(task.status as TaskStatus),
      logHours: writable && (r.manage || r.owner),
      addSubtask: writable && !internal && r.manage && !task.parentTask && creationDepts.length > 0 && !CLOSED_TASK_STATUSES.includes(task.status as TaskStatus),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Create / update / assign                                            */
/* ------------------------------------------------------------------ */

export async function createTask(user: CurrentUser, input: CreateInput): Promise<{ id: string; taskNumber: string }> {
  if (!hasPermission(user.role, "task:manage")) throw forbidden();
  if (disabledTaskStatuses().includes(input.status)) throw unprocessable(`The ${humanize(input.status)} status is switched off. Create the task as To Do.`, { status: "Status not available" });
  const ctx = await accessContext(user);

  // 1. Project: visible, writable, not closed.
  const project = await Project.findById(input.project).select("name code departments isArchived status approvalMode manager").lean();
  if (!project || !canViewProject(ctx, project)) throw notFound("Project not found");
  assertWritable(project);
  if (["COMPLETED", "CANCELLED"].includes(project.status)) {
    throw unprocessable(`This project is ${project.status.toLowerCase()}; new tasks can't be added`);
  }

  // 2. Department: must participate in the project and be one the actor may assign in.
  if (!project.departments.some((d) => d.toString() === input.department)) {
    throw unprocessable("This department is not participating in the project", { department: "Not a project department" });
  }
  if (!taskCreationDepartments(ctx, project).includes(input.department)) {
    throw forbidden("You can't assign tasks in this department");
  }

  // 3. Owner: allocated to this project under this department. 4. Collaborators: on the project team.
  const owner = await assertProjectMember(project._id, input.owner, input.department, "Owner");
  const collaborators = uniq(input.collaborators).filter((c) => c !== input.owner);
  for (const c of collaborators) await assertProjectMember(project._id, c, null, "Collaborator");

  // 5. Parent, dependencies, milestone.
  let parent: any = null;
  if (input.parentTask) {
    parent = await Task.findById(input.parentTask).select("project parentTask taskNumber title owner department status").lean();
    if (!parent || s(parent.project) !== s(project._id)) throw unprocessable("Parent task not found in this project", { parentTask: "Invalid parent" });
    if (parent.parentTask) throw unprocessable("Subtasks can't have their own subtasks", { parentTask: "Choose a top-level task" });
    if (CLOSED_TASK_STATUSES.includes(parent.status)) throw unprocessable("The parent task is already closed");
  }
  await validateDependencies(project._id, uniq(input.dependencies));
  await validateMilestone(project._id, input.milestone);

  const task = await Task.create({
    taskNumber: await generateTaskNumber(),
    title: input.title,
    description: input.description,
    project: project._id,
    department: oid(input.department),
    parentTask: parent?._id ?? null,
    milestone: input.milestone ? oid(input.milestone) : null,
    status: input.status,
    priority: input.priority,
    owner: owner._id,
    assignedBy: oid(user.id),
    collaborators: collaborators.map(oid),
    dependencies: uniq(input.dependencies).map(oid),
    checklist: input.checklist.map((text) => ({ text })),
    startDate: toDate(input.startDate),
    dueDate: toDueDate(input.dueDate),
    estimatedHours: input.estimatedHours,
    approvalRequired: input.approvalRequired,
    approvalMode: input.approvalMode ?? project.approvalMode ?? "DEPARTMENT",
    createdBy: oid(user.id),
  });

  await activity(task, user.id, "CREATED", `Created ${task.taskNumber} "${task.title}"`);
  await activity(task, user.id, "ASSIGNED", `Assigned to ${owner.name}`, null, owner.name);
  if (parent) await activity({ _id: parent._id, project: project._id }, user.id, "SUBTASK_ADDED", `Added subtask ${task.taskNumber} "${task.title}"`);

  await notify({
    recipients: [owner._id],
    actorId: user.id,
    type: "TASK",
    title: "New task assigned to you",
    message: `${task.taskNumber} · ${task.title} (${project.name})`,
    link: `/tasks/${task._id}`,
    entityType: "Task",
    entityId: task._id,
  });
  await notify({
    recipients: collaborators,
    actorId: user.id,
    type: "TASK",
    title: "Added as a collaborator", pref: "task_activity",
    message: `${task.taskNumber} · ${task.title} (${project.name})`,
    link: `/tasks/${task._id}`,
    entityType: "Task",
    entityId: task._id,
  });
  await recordAudit({
    actorId: user.id,
    action: "task.create",
    entityType: "Task",
    entityId: task._id,
    summary: `Created ${task.taskNumber} "${task.title}" assigned to ${owner.name}`,
  });
  await refreshProjectProgress(project._id);
  return { id: task._id.toString(), taskNumber: task.taskNumber };
}

export async function updateTask(user: CurrentUser, id: string, input: UpdateInput): Promise<void> {
  const { ctx, task, project } = await loadTaskForUser(user, id);
  assertWritable(project);
  const r = roles(ctx, task);

  const touched = (Object.keys(input) as (keyof UpdateInput)[]).filter((k) => input[k] !== undefined);
  if (isInternalRequest(task)) {
    // Title, priority, deadline and owner come from the ticket; only hours can be logged here.
    if (touched.some((k) => k !== "actualHours")) await assertNotInternalRequest(task, "Edit it");
    if (!r.owner && !r.manage) throw forbidden("You can only log hours on this task");
  } else if (!r.manage) {
    const disallowed = touched.filter((k) => k !== "actualHours");
    if (disallowed.length || !r.owner) throw forbidden("You can only log hours on this task");
  }

  const update: Record<string, unknown> = {};
  const messages: { action: ActivityAction; message: string; from?: unknown; to?: unknown }[] = [];

  for (const f of ["title", "description", "priority", "estimatedHours", "approvalRequired", "approvalMode"] as const) {
    if (input[f] !== undefined && input[f] !== (task as any)[f]) {
      update[f] = input[f];
      messages.push({
        action: "UPDATED",
        message: f === "approvalMode"
          ? `Approval set to ${APPROVAL_MODE_LABELS[input[f] as ApprovalMode]}`
          : f === "approvalRequired"
            ? input[f] ? "Approval is now required" : "Approval is no longer required"
            : `Changed ${f === "estimatedHours" ? "estimate" : f}`,
        from: f === "description" ? null : (task as any)[f],
        to: f === "description" ? null : input[f],
      });
    }
  }
  if (input.startDate !== undefined) update.startDate = toDate(input.startDate);
  if (input.dueDate !== undefined) {
    update.dueDate = toDueDate(input.dueDate);
    if (s(task.dueDate?.toISOString().slice(0, 10)) !== s(input.dueDate)) {
      messages.push({ action: "UPDATED", message: input.dueDate ? `Due date set to ${input.dueDate}` : "Due date removed" });
    }
  }
  if (input.actualHours !== undefined && input.actualHours !== task.actualHours) {
    update.actualHours = input.actualHours;
    messages.push({ action: "HOURS_LOGGED", message: `Actual hours set to ${input.actualHours ?? 0}`, from: task.actualHours, to: input.actualHours });
  }
  if (input.milestone !== undefined) {
    await validateMilestone(task.project!, input.milestone);
    update.milestone = input.milestone ? oid(input.milestone) : null;
  }

  let addedCollaborators: string[] = [];
  if (input.collaborators !== undefined) {
    const next = uniq(input.collaborators).filter((c) => c !== s(task.owner));
    const current = (task.collaborators ?? []).map(String);
    addedCollaborators = next.filter((c) => !current.includes(c));
    const removed = current.filter((c) => !next.includes(c));
    for (const c of addedCollaborators) await assertProjectMember(task.project!, c, null, "Collaborator");
    if (addedCollaborators.length || removed.length) {
      update.collaborators = next.map(oid);
      const names = await User.find({ _id: { $in: [...addedCollaborators, ...removed].map(oid) } }).select("name").lean();
      const nameOf = (x: string) => names.find((n) => n._id.toString() === x)?.name ?? "someone";
      addedCollaborators.forEach((c) => messages.push({ action: "COLLABORATOR_ADDED", message: `Added collaborator ${nameOf(c)}` }));
      removed.forEach((c) => messages.push({ action: "COLLABORATOR_REMOVED", message: `Removed collaborator ${nameOf(c)}` }));
    }
  }

  if (input.dependencies !== undefined) {
    const next = uniq(input.dependencies);
    const current = (task.dependencies ?? []).map(String);
    const added = next.filter((d) => !current.includes(d));
    const removed = current.filter((d) => !next.includes(d));
    await validateDependencies(task.project!, added, task._id.toString());
    if (added.length || removed.length) {
      update.dependencies = next.map(oid);
      const refs = await Task.find({ _id: { $in: [...added, ...removed].map(oid) } }).select("taskNumber").lean();
      const numOf = (x: string) => refs.find((n) => n._id.toString() === x)?.taskNumber ?? "a task";
      added.forEach((d) => messages.push({ action: "DEPENDENCY_ADDED", message: `Now depends on ${numOf(d)}` }));
      removed.forEach((d) => messages.push({ action: "DEPENDENCY_REMOVED", message: `No longer depends on ${numOf(d)}` }));
    }
  }

  if (!Object.keys(update).length) return;
  await Task.updateOne({ _id: task._id }, { $set: update }, { runValidators: true });
  for (const m of messages) await activity(task, user.id, m.action, m.message, m.from ?? null, m.to ?? null);
  if (addedCollaborators.length) {
    await notify({
      recipients: addedCollaborators,
      actorId: user.id,
      type: "TASK",
      title: "Added as a collaborator", pref: "task_activity",
      message: `${task.taskNumber} · ${update.title ?? task.title}`,
      link: `/tasks/${task._id}`,
      entityType: "Task",
      entityId: task._id,
    });
  }
}

export async function assignTask(user: CurrentUser, id: string, input: z.output<typeof assignTaskSchema>): Promise<void> {
  const { ctx, task, project } = await loadTaskForUser(user, id);
  assertWritable(project);
  await assertNotInternalRequest(task, "Reassign it");
  if (!canManageTask(ctx, task) || !project) throw forbidden("You can't reassign this task");
  if (CLOSED_TASK_STATUSES.includes(task.status as TaskStatus)) throw unprocessable("Reopen the task before reassigning it");
  if (!project.departments.some((d) => d.toString() === input.department)) {
    throw unprocessable("This department is not participating in the project", { department: "Not a project department" });
  }
  if (!taskCreationDepartments(ctx, project).includes(input.department)) throw forbidden("You can't assign tasks in this department");
  if (input.owner === s(task.owner) && input.department === s(task.department)) return;

  const newOwner = await assertProjectMember(project._id, input.owner, input.department, "Owner");
  const previousOwner = task.owner ? await User.findById(task.owner).select("name").lean() : null;

  await Task.updateOne(
    { _id: task._id },
    {
      $set: { owner: newOwner._id, department: oid(input.department), assignedBy: oid(user.id) },
      $pull: { collaborators: newOwner._id },
    }
  );
  await activity(task, user.id, "ASSIGNED", `Reassigned from ${previousOwner?.name ?? "nobody"} to ${newOwner.name}`, previousOwner?.name ?? null, newOwner.name);
  await recordAudit({
    actorId: user.id,
    action: "task.assign",
    entityType: "Task",
    entityId: task._id,
    summary: `Reassigned ${task.taskNumber} from ${previousOwner?.name ?? "nobody"} to ${newOwner.name}`,
    changes: { owner: { from: previousOwner?.name ?? null, to: newOwner.name }, department: { from: s(task.department), to: input.department } },
  });
  await notify({
    recipients: [newOwner._id],
    actorId: user.id,
    type: "TASK",
    title: "Task assigned to you",
    message: `${task.taskNumber} · ${task.title} (${project.name})`,
    link: `/tasks/${task._id}`,
    entityType: "Task",
    entityId: task._id,
  });
  if (previousOwner && s(previousOwner._id) !== s(newOwner._id)) {
    await notify({
      recipients: [previousOwner._id],
      actorId: user.id,
      type: "TASK",
      title: "Task reassigned", pref: "task_activity",
      message: `${task.taskNumber} · ${task.title} is now assigned to ${newOwner.name}.`,
      link: `/tasks/${task._id}`,
      entityType: "Task",
      entityId: task._id,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Workflow                                                            */
/* ------------------------------------------------------------------ */

export async function changeTaskStatus(user: CurrentUser, id: string, status: TaskStatus, note: string): Promise<void> {
  const { ctx, task, project } = await loadTaskForUser(user, id);
  assertWritable(project);
  const r = roles(ctx, task);
  const from = task.status as TaskStatus;
  if (from === status) return;
  if (isInternalRequest(task)) {
    // The ticket owns the status: route the move through the ticket workflow.
    if (status === "IN_PROGRESS" && ["TODO", "CHANGES_REQUESTED"].includes(from)) return startWorkFromLinkedTask(user, task);
    await assertNotInternalRequest(task, from === "IN_PROGRESS" && status === "IN_REVIEW" ? "Upload the deliverable and submit it as resolved" : "Update its status");
  }

  const off = disabledTaskStatuses();
  const allowed = allowedTransitions(workflowContext(task, r)).filter((st) => !off.includes(st));
  if (!allowed.includes(status)) {
    if (status === "COMPLETED" && task.approvalRequired !== false) {
      throw unprocessable("This task requires approval. Submit it for review instead of completing it.");
    }
    if (status === "CHANGES_REQUESTED") throw unprocessable("Use the review action to request changes.");
    throw unprocessable(`You can't move this task from ${humanize(from)} to ${humanize(status)}.`);
  }
  if (DEPENDENCY_GATED_STATUSES.includes(status)) {
    const open = await unresolvedDependencies(task.dependencies ?? []);
    if (open.length) {
      throw unprocessable(`Blocked by unfinished dependencies: ${open.map((d) => d.taskNumber).join(", ")}`);
    }
  }
  if (status === "COMPLETED") {
    const openSubs = await Task.countDocuments({ parentTask: task._id, status: { $nin: CLOSED_TASK_STATUSES } });
    if (openSubs) throw unprocessable(`Close the ${openSubs} open subtask(s) first.`);
  }

  const set: Record<string, unknown> = { status };
  if (status === "IN_REVIEW") set.submittedAt = new Date();
  if (status === "COMPLETED") set.completedAt = new Date();
  if (from === "COMPLETED") Object.assign(set, { completedAt: null, approvedBy: null, approvedAt: null });
  await Task.updateOne({ _id: task._id }, { $set: set });

  const action: ActivityAction = status === "IN_REVIEW" ? "SUBMITTED_FOR_REVIEW" : from === "COMPLETED" || from === "CANCELLED" ? "REOPENED" : "STATUS_CHANGED";
  await activity(task, user.id, action, `${humanize(from)} → ${humanize(status)}${note ? `: ${note}` : ""}`, from, status);
  if (note) await TaskComment.create({ task: task._id, author: oid(user.id), body: note, kind: "COMMENT" });

  if (status === "IN_REVIEW") {
    await notify({
      recipients: await reviewersFor(task),
      actorId: user.id,
      type: "REVIEW",
      title: "Task submitted for review", pref: "task_review",
      message: `${task.taskNumber} · ${task.title}`,
      link: `/tasks/${task._id}`,
      entityType: "Task",
      entityId: task._id,
    });
  } else if (s(task.owner) !== user.id) {
    await notify({
      recipients: [task.owner],
      actorId: user.id,
      type: "TASK",
      pref: "task_activity",
      title: `Task moved to ${humanize(status)}`,
      message: `${task.taskNumber} · ${task.title}`,
      link: `/tasks/${task._id}`,
      entityType: "Task",
      entityId: task._id,
    });
  }
  if (status !== "IN_REVIEW" && s(task.owner) === user.id && task.assignedBy && s(task.assignedBy) !== user.id) {
    await notify({
      recipients: [task.assignedBy],
      actorId: user.id,
      type: "TASK",
      pref: "task_activity",
      title: "Task status changed",
      message: `${task.taskNumber} · ${task.title}: ${humanize(from)} → ${humanize(status)}`,
      link: `/tasks/${task._id}`,
      entityType: "Task",
      entityId: task._id,
    });
  }
  await recordAudit({
    actorId: user.id,
    action: "task.status",
    entityType: "Task",
    entityId: task._id,
    summary: `${task.taskNumber}: ${humanize(from)} → ${humanize(status)}`,
    changes: { status: { from, to: status } },
  });
  await refreshProjectProgress(task.project);
}

export async function reviewTask(user: CurrentUser, id: string, decision: "APPROVE" | "REQUEST_CHANGES", comment: string): Promise<void> {
  const { ctx, task, project } = await loadTaskForUser(user, id);
  assertWritable(project);
  await assertNotInternalRequest(task, "The requester confirms completion or requests changes");
  const r = roles(ctx, task);
  if (task.status !== "IN_REVIEW") throw unprocessable("Only tasks in review can be approved or sent back");
  if (!reviewAvailable(workflowContext(task, r))) {
    throw forbidden(
      isOwner(ctx, task)
        ? "You can't review your own task"
        : `This task must be reviewed by: ${APPROVAL_MODE_LABELS[(task.approvalMode ?? "DEPARTMENT") as ApprovalMode]}`
    );
  }

  if (decision === "APPROVE") {
    const [openSubs, openDeps] = await Promise.all([
      Task.countDocuments({ parentTask: task._id, status: { $nin: CLOSED_TASK_STATUSES } }),
      unresolvedDependencies(task.dependencies ?? []),
    ]);
    if (openSubs) throw unprocessable(`Can't approve: ${openSubs} subtask(s) are still open.`);
    if (openDeps.length) throw unprocessable(`Can't approve: waiting on ${openDeps.map((d) => d.taskNumber).join(", ")}.`);
    const now = new Date();
    await Task.updateOne(
      { _id: task._id },
      { $set: { status: "COMPLETED", completedAt: now, approvedBy: oid(user.id), approvedAt: now, "blocker.isBlocked": false } }
    );
    if (comment) await TaskComment.create({ task: task._id, author: oid(user.id), body: comment, kind: "REVIEW" });
    await activity(task, user.id, "APPROVED", `Approved and completed${comment ? `: ${comment}` : ""}`, "IN_REVIEW", "COMPLETED");
    await recordAudit({ actorId: user.id, action: "task.approve", entityType: "Task", entityId: task._id, summary: `Approved ${task.taskNumber}`, changes: { status: { from: "IN_REVIEW", to: "COMPLETED" } } });
    await notify({
      recipients: [task.owner, ...(task.collaborators ?? [])],
      actorId: user.id,
      type: "REVIEW",
      title: "Task approved",
      message: `${task.taskNumber} · ${task.title} was approved and completed.`,
      link: `/tasks/${task._id}`,
      entityType: "Task",
      entityId: task._id,
    });
  } else {
    await Task.updateOne({ _id: task._id }, { $set: { status: "CHANGES_REQUESTED" } });
    await TaskComment.create({ task: task._id, author: oid(user.id), body: comment, kind: "REVIEW" });
    await activity(task, user.id, "CHANGES_REQUESTED", `Requested changes: ${comment}`, "IN_REVIEW", "CHANGES_REQUESTED");
    await recordAudit({ actorId: user.id, action: "task.changes_requested", entityType: "Task", entityId: task._id, summary: `Requested changes on ${task.taskNumber}`, changes: { status: { from: "IN_REVIEW", to: "CHANGES_REQUESTED" } } });
    await notify({
      recipients: [task.owner],
      actorId: user.id,
      type: "REVIEW",
      title: "Changes requested",
      message: `${task.taskNumber} · ${task.title}: ${comment.slice(0, 140)}`,
      link: `/tasks/${task._id}`,
      entityType: "Task",
      entityId: task._id,
    });
  }
  await refreshProjectProgress(task.project);
}

export async function setBlocker(user: CurrentUser, id: string, action: "REPORT" | "CLEAR", reason: string): Promise<void> {
  const { ctx, task, project } = await loadTaskForUser(user, id);
  assertWritable(project);
  const r = roles(ctx, task);
  if (!(r.manage || r.owner || r.collaborator)) throw forbidden("Only people working on this task can report blockers");

  if (action === "REPORT") {
    if (CLOSED_TASK_STATUSES.includes(task.status as TaskStatus)) throw unprocessable("This task is already closed");
    await Task.updateOne(
      { _id: task._id },
      { $set: { blocker: { isBlocked: true, reason, reportedBy: oid(user.id), reportedAt: new Date() } } }
    );
    await TaskComment.create({ task: task._id, author: oid(user.id), body: reason, kind: "BLOCKER" });
    await activity(task, user.id, "BLOCKER_REPORTED", `Reported a blocker: ${reason}`);
    await notify({
      recipients: await supervisorsFor(task),
      actorId: user.id,
      type: "TASK",
      title: "Blocker reported", pref: "task_activity",
      message: `${task.taskNumber} · ${task.title}: ${reason.slice(0, 140)}`,
      link: `/tasks/${task._id}`,
      entityType: "Task",
      entityId: task._id,
    });
  } else {
    if (!task.blocker?.isBlocked) return;
    await Task.updateOne({ _id: task._id }, { $set: { "blocker.isBlocked": false } });
    await activity(task, user.id, "BLOCKER_CLEARED", "Cleared the blocker");
  }
}

/* ------------------------------------------------------------------ */
/* Comments & checklist                                                */
/* ------------------------------------------------------------------ */

export async function addComment(user: CurrentUser, id: string, body: string): Promise<void> {
  const { task, project } = await loadTaskForUser(user, id);
  assertWritable(project);
  await TaskComment.create({ task: task._id, author: oid(user.id), body });
  await activity(task, user.id, "COMMENTED", `Commented: ${body.slice(0, 120)}`);
  await notify({
    recipients: [task.owner, task.assignedBy, ...(task.collaborators ?? [])],
    actorId: user.id,
    type: "TASK",
    title: `New comment on ${task.taskNumber}`,
    pref: "comments",
    message: body.slice(0, 160),
    link: `/tasks/${task._id}`,
    entityType: "Task",
    entityId: task._id,
  });
}

async function loadForChecklist(user: CurrentUser, id: string) {
  const { ctx, task, project } = await loadTaskForUser(user, id);
  assertWritable(project);
  const r = roles(ctx, task);
  if (!(r.manage || r.owner || r.collaborator)) throw forbidden("Only people working on this task can update its checklist");
  return task;
}

export async function addChecklistItem(user: CurrentUser, id: string, text: string): Promise<void> {
  const task = await loadForChecklist(user, id);
  if ((task.checklist?.length ?? 0) >= 50) throw unprocessable("A checklist can have at most 50 items");
  await Task.updateOne({ _id: task._id }, { $push: { checklist: { text } } });
  await activity(task, user.id, "CHECKLIST_UPDATED", `Added checklist item "${text}"`);
}

export async function updateChecklistItem(user: CurrentUser, id: string, itemId: string, patch: { text?: string; done?: boolean }): Promise<void> {
  const task = await loadForChecklist(user, id);
  const item = task.checklist?.find((c: any) => c._id.toString() === itemId);
  if (!item) throw notFound("Checklist item not found");
  const set: Record<string, unknown> = {};
  if (patch.text !== undefined) set["checklist.$.text"] = patch.text;
  if (patch.done !== undefined && patch.done !== item.done) {
    set["checklist.$.done"] = patch.done;
    set["checklist.$.doneBy"] = patch.done ? oid(user.id) : null;
    set["checklist.$.doneAt"] = patch.done ? new Date() : null;
  }
  if (!Object.keys(set).length) return;
  await Task.updateOne({ _id: task._id, "checklist._id": oid(itemId) }, { $set: set });
  await activity(
    task,
    user.id,
    "CHECKLIST_UPDATED",
    patch.done === undefined ? `Edited checklist item "${patch.text}"` : `${patch.done ? "Checked" : "Unchecked"} "${patch.text ?? item.text}"`
  );
}

export async function deleteChecklistItem(user: CurrentUser, id: string, itemId: string): Promise<void> {
  const task = await loadForChecklist(user, id);
  const item = task.checklist?.find((c: any) => c._id.toString() === itemId);
  if (!item) throw notFound("Checklist item not found");
  await Task.updateOne({ _id: task._id }, { $pull: { checklist: { _id: oid(itemId) } } });
  await activity(task, user.id, "CHECKLIST_UPDATED", `Removed checklist item "${item.text}"`);
}

