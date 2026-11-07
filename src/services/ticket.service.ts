import "server-only";
import type { Types } from "mongoose";
import type { z } from "zod";
import type { CurrentUser } from "@/lib/auth/current-user";
import { conflict, escapeRegex, forbidden, notFound, paginate, unprocessable } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { utcDayRange } from "@/lib/dates";
import { notify } from "@/lib/notify";
import type { NotificationPref } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import { getRoleById, getRoleByKey } from "@/lib/roles";
import {
  CLOSED_TASK_STATUSES,
  FINAL_TICKET_STATUSES,
  NOT_OVERDUE_TICKET_STATUSES,
  TASK_PRIORITIES,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  humanize,
  type TaskPriority,
  type TaskStatus,
  type TicketStatus,
} from "@/lib/constants";
import {
  actionValidFrom,
  availableActions,
  canPerform,
  linkedTaskMoves,
  linkedTaskStatus,
  nextStatus,
  TICKET_ACTION_LABELS,
  type TicketAction,
} from "@/lib/ticket-workflow";
import type {
  assignTicketSchema,
  createTicketSchema,
  ticketActionSchema,
  ticketListQuerySchema,
  updateTicketSchema,
} from "@/lib/validations/ticket";
import {
  Attachment,
  Department,
  Project,
  ProjectMember,
  Task,
  TaskActivity,
  Ticket,
  TicketActivity,
  TicketCategory,
  TicketComment,
  User,
} from "@/models";
import type { TicketActivityAction } from "@/models/TicketActivity";
import type { TicketCommentKind } from "@/models/TicketComment";
import type {
  AttachmentDTO,
  DepartmentRef,
  EligibleAssigneeDTO,
  Paginated,
  TicketDetailDTO,
  TicketListItemDTO,
  TicketSummaryDTO,
} from "@/types/dto";
import { accessContext, canViewProject } from "./access";
import { toAttachmentDTO } from "./attachment.service";
import { DEPT_REF_FIELDS, iso, toDepartmentRef, toUserRef, USER_REF_FIELDS } from "./mappers";
import { generateTaskNumber, generateTicketNumber } from "./numbering";
import { oid, type Filter } from "./scope";
import { ensureDefaultTicketCategories } from "./ticket-category.service";
import {
  canManageTicket,
  canMonitorTicket,
  canViewTicket,
  isTicketRequester,
  manageScopeFilter,
  sid,
  ticketAccessContext,
  ticketWorkflowContext,
  type TicketAccessContext,
} from "./ticket-access";

/* eslint-disable @typescript-eslint/no-explicit-any */

type CreateInput = z.output<typeof createTicketSchema>;
type UpdateInput = z.output<typeof updateTicketSchema>;
type AssignInput = z.output<typeof assignTicketSchema>;
type ActionInput = z.output<typeof ticketActionSchema>;
type ListQuery = z.output<typeof ticketListQuerySchema>;

const isObjectId = (v: string) => /^[a-f\d]{24}$/i.test(v);
const toDueDate = (s: string) => new Date(`${s}T23:59:59.000Z`);
const toStartDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const uniq = (ids: string[]) => [...new Set(ids.filter(Boolean))];
const link = (t: { _id: unknown }) => `/tickets/${t._id}`;
const label = (s: string) => TICKET_STATUS_LABELS[s as TicketStatus] ?? humanize(s);

/** Accepts today in any timezone (the server runs in UTC; users may be ahead of it). */
function assertDueDateNotPast(day: string) {
  const earliest = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (day < earliest) throw unprocessable("The required completion date can't be in the past", { dueDate: "Choose today or a later date" });
}

const overdueFilter = (): Filter => ({ dueDate: { $lt: new Date() }, status: { $nin: NOT_OVERDUE_TICKET_STATUSES } });

export function isTicketOverdue(t: { status: string; dueDate?: Date | null }): boolean {
  return !!t.dueDate && t.dueDate.getTime() < Date.now() && !NOT_OVERDUE_TICKET_STATUSES.includes(t.status as TicketStatus);
}

/* ------------------------------------------------------------------ */
/* History, comments, recipients                                       */
/* ------------------------------------------------------------------ */

async function log(
  ticketId: Types.ObjectId,
  actor: string,
  action: TicketActivityAction,
  message: string,
  extra: { from?: unknown; to?: unknown; meta?: Record<string, unknown> } = {}
) {
  await TicketActivity.create({
    ticket: ticketId,
    actor: oid(actor),
    action,
    message: message.slice(0, 1000),
    from: extra.from ?? null,
    to: extra.to ?? null,
    meta: extra.meta ?? null,
  });
}

async function logStatus(ticketId: Types.ObjectId, actor: string, from: string, to: string) {
  if (from === to) return;
  await log(ticketId, actor, "STATUS_CHANGED", `${label(from)} → ${label(to)}`, { from, to });
}

async function addThreadEntry(ticketId: Types.ObjectId, author: string, body: string, kind: TicketCommentKind) {
  if (!body.trim()) return;
  await TicketComment.create({ ticket: ticketId, author: oid(author), body: body.trim(), kind });
}

/** People who manage this ticket: the related project's managers, otherwise every active Project Manager. */
async function ticketManagers(ticket: { project?: Types.ObjectId | null }): Promise<string[]> {
  if (ticket.project) {
    const [project, members] = await Promise.all([
      Project.findById(ticket.project).select("manager").lean(),
      ProjectMember.find({ project: ticket.project, projectRole: "MANAGER", isActive: true }).select("user").lean(),
    ]);
    const ids = uniq([sid(project?.manager), ...members.map((m) => sid(m.user))]);
    if (ids.length) return ids;
  }
  const role = await getRoleByKey("PROJECT_MANAGER");
  const pms = await User.find({ role: oid(role.id), status: "ACTIVE" }).select("_id").lean();
  return pms.map((p) => p._id.toString());
}

function notifyTicket(
  ticket: { _id: Types.ObjectId; ticketNumber: string; title: string },
  recipients: (string | Types.ObjectId | null | undefined)[],
  actorId: string,
  title: string,
  message?: string,
  pref?: NotificationPref
) {
  return notify({
    recipients,
    actorId,
    type: "TICKET",
    pref,
    title,
    message: message ?? `${ticket.ticketNumber} · ${ticket.title}`,
    link: link(ticket),
    entityType: "Ticket",
    entityId: ticket._id,
  });
}

/* ------------------------------------------------------------------ */
/* Loading & guards                                                    */
/* ------------------------------------------------------------------ */

async function loadTicket(user: CurrentUser, id: string) {
  const ctx = await ticketAccessContext(user);
  const ticket = await Ticket.findById(id).lean();
  if (!ticket || !canViewTicket(ctx, ticket)) throw notFound("Ticket not found");
  return { ctx, ticket };
}

type TicketLean = Awaited<ReturnType<typeof loadTicket>>["ticket"];

function assertAction(ctx: TicketAccessContext, ticket: TicketLean, action: TicketAction) {
  const wf = ticketWorkflowContext(ctx, ticket);
  if (canPerform(wf, action)) return;
  const verb = TICKET_ACTION_LABELS[action].toLowerCase();
  if (!actionValidFrom(action, ticket.status as TicketStatus)) {
    throw unprocessable(`You can't ${verb} while the ticket is ${label(ticket.status)}.`);
  }
  if (action === "REOPEN" && wf.isRequester && !wf.withinReopenWindow) {
    throw forbidden("This ticket was closed too long ago to reopen. Raise a new ticket or ask a Project Manager.");
  }
  if ((action === "ACCEPT" || action === "REQUEST_CHANGES") && wf.isAssignee) {
    throw forbidden("You can't review your own work. The requester confirms completion.");
  }
  throw forbidden(`You don't have permission to ${verb} this ticket.`);
}

/**
 * Optimistic concurrency: the write only applies if nobody changed the ticket
 * since it was loaded, so two people can't push it in different directions.
 */
async function guardedUpdate(ticket: TicketLean, update: Record<string, unknown>) {
  const res = await Ticket.updateOne({ _id: ticket._id, updatedAt: ticket.updatedAt }, update, { runValidators: true });
  if (!res.matchedCount) throw conflict("This ticket was just updated by someone else. Refresh to see the latest version.");
}

/* ------------------------------------------------------------------ */
/* Ticket ⇄ task synchronisation                                      */
/* ------------------------------------------------------------------ */

const TASK_ACTIVITY_FOR: Partial<Record<TaskStatus, "SUBMITTED_FOR_REVIEW" | "APPROVED" | "CHANGES_REQUESTED">> = {
  IN_REVIEW: "SUBMITTED_FOR_REVIEW",
  COMPLETED: "APPROVED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
};

/**
 * Brings the linked task in line with the ticket. This is the ONLY place that
 * writes an internal-request task's status/owner/deadline/priority, so the two
 * records can never disagree. Creates the task on first assignment (and reuses
 * it afterwards — the unique index on Task.linkedTicket forbids duplicates).
 * Idempotent: safe to call after every ticket change and on read as a repair.
 */
export async function syncLinkedTask(ticketId: Types.ObjectId | string, actorId: string): Promise<void> {
  const t = await Ticket.findById(ticketId).lean();
  if (!t) return;

  let task: any = t.linkedTask ? await Task.findById(t.linkedTask).lean() : await Task.findOne({ linkedTicket: t._id }).lean();
  if (!task) {
    if (!t.assignee) return; // nothing to do until someone is assigned
    try {
      const created = await Task.create({
        taskNumber: await generateTaskNumber(),
        title: t.title,
        description: t.description,
        project: null,
        department: t.targetDepartment,
        status: linkedTaskStatus(t.status as TicketStatus, true),
        priority: t.priority,
        owner: t.assignee,
        assignedBy: t.assignedBy ?? oid(actorId),
        startDate: toStartDate(new Date().toISOString().slice(0, 10)),
        dueDate: t.dueDate,
        approvalRequired: true,
        tags: ["internal-request"],
        createdBy: oid(actorId),
        sourceType: "internal_ticket",
        linkedTicket: t._id,
      });
      task = created.toObject();
      const owner = await User.findById(t.assignee).select("name").lean();
      await TaskActivity.create({
        task: task._id,
        project: null,
        actor: oid(actorId),
        action: "CREATED",
        message: `Created from internal request ${t.ticketNumber}`,
      });
      await TaskActivity.create({
        task: task._id,
        project: null,
        actor: oid(actorId),
        action: "ASSIGNED",
        message: `Assigned to ${owner?.name ?? "employee"}`,
        to: owner?.name ?? null,
      });
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      task = await Task.findOne({ linkedTicket: t._id }).lean(); // created concurrently
      if (!task) throw err;
    }
  }
  if (!t.linkedTask || t.linkedTask.toString() !== task._id.toString()) {
    // Don't bump updatedAt: this pointer write must not invalidate a concurrent user's view.
    await Ticket.collection.updateOne({ _id: t._id }, { $set: { linkedTask: task._id } });
  }

  const status = linkedTaskStatus(t.status as TicketStatus, !!t.assignee);
  const closedAt = t.closure?.closedAt ?? null;
  const set: Record<string, unknown> = {
    status,
    title: t.title,
    description: t.description,
    priority: t.priority,
    dueDate: t.dueDate,
    department: t.targetDepartment,
    sourceType: "internal_ticket",
    linkedTicket: t._id,
    submittedAt: status === "IN_REVIEW" ? t.resolvedAt ?? new Date() : task.submittedAt ?? null,
    completedAt: status === "COMPLETED" ? task.completedAt ?? closedAt ?? new Date() : null,
    approvedBy: status === "COMPLETED" ? t.closure?.closedBy ?? null : null,
    approvedAt: status === "COMPLETED" ? closedAt : null,
  };
  // The last assignee stays the owner after a rejection, so the history still makes sense.
  if (t.assignee) {
    set.owner = t.assignee;
    set.assignedBy = t.assignedBy ?? task.assignedBy;
  }

  const ownerChanged = !!t.assignee && sid(task.owner) !== sid(t.assignee);
  const statusChanged = task.status !== status;
  const fieldsChanged =
    ownerChanged ||
    statusChanged ||
    task.priority !== t.priority ||
    task.title !== t.title ||
    task.description !== t.description ||
    sid(task.department) !== sid(t.targetDepartment) ||
    task.dueDate?.getTime?.() !== t.dueDate?.getTime?.() ||
    task.sourceType !== "internal_ticket" ||
    sid(task.linkedTicket) !== sid(t._id) ||
    (status === "COMPLETED") !== !!task.completedAt;
  if (!fieldsChanged) return;

  await Task.updateOne({ _id: task._id }, { $set: set, ...(t.assignee ? { $pull: { collaborators: t.assignee } } : {}) });

  if (ownerChanged) {
    const names = await User.find({ _id: { $in: [task.owner, t.assignee].filter(Boolean) } }).select("name").lean();
    const nameOf = (id: unknown) => names.find((n) => n._id.toString() === sid(id))?.name ?? "nobody";
    await TaskActivity.create({
      task: task._id,
      project: null,
      actor: oid(actorId),
      action: "ASSIGNED",
      message: `Reassigned from ${nameOf(task.owner)} to ${nameOf(t.assignee)} (ticket ${t.ticketNumber})`,
      from: nameOf(task.owner),
      to: nameOf(t.assignee),
    });
  }
  if (statusChanged) {
    const reopened = CLOSED_TASK_STATUSES.includes(task.status) && !CLOSED_TASK_STATUSES.includes(status);
    await TaskActivity.create({
      task: task._id,
      project: null,
      actor: oid(actorId),
      action: reopened ? "REOPENED" : TASK_ACTIVITY_FOR[status] ?? "STATUS_CHANGED",
      message: `${humanize(task.status)} → ${humanize(status)} (ticket ${t.ticketNumber} is ${label(t.status)})`,
      from: task.status,
      to: status,
    });
  }
}

/** Starts work on a ticket from its linked task (My Tasks board / status menu). */
export async function startWorkFromLinkedTask(user: CurrentUser, task: { _id: Types.ObjectId; linkedTicket?: Types.ObjectId | null }): Promise<void> {
  if (!task.linkedTicket) throw unprocessable("This task is not linked to a ticket");
  await performTicketAction(user, task.linkedTicket.toString(), { action: "START_WORK" });
}

/** Task-board moves the viewer may make on internal-request tasks, keyed by task id. */
export async function linkedTaskMovesFor(user: CurrentUser, tasks: { _id: Types.ObjectId; linkedTicket?: unknown }[]): Promise<Map<string, TaskStatus[]>> {
  const out = new Map<string, TaskStatus[]>();
  const ids = tasks.map((t) => sid(t.linkedTicket)).filter(Boolean);
  if (!ids.length) return out;
  const ctx = await ticketAccessContext(user);
  const tickets = await Ticket.find({ _id: { $in: ids.map((x) => oid(x)) } })
    .select("status requester assignee project targetDepartment requestingDepartment closure")
    .lean();
  const byId = new Map(tickets.map((t) => [t._id.toString(), t]));
  for (const t of tasks) {
    const ticket = byId.get(sid(t.linkedTicket));
    out.set(t._id.toString(), ticket ? linkedTaskMoves(ticketWorkflowContext(ctx, ticket)) : []);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

const LIST_POPULATE = (q: any) =>
  q
    .populate("requester", USER_REF_FIELDS)
    .populate("assignee", USER_REF_FIELDS)
    .populate("requestingDepartment", DEPT_REF_FIELDS)
    .populate("targetDepartment", DEPT_REF_FIELDS)
    .populate("project", "name code")
    .populate("linkedTask", "taskNumber status")
    .lean();

function awaitingViewer(ctx: TicketAccessContext, t: any): boolean {
  const wf = ticketWorkflowContext(ctx, t);
  if (wf.isRequester && ["RESOLVED", "WAITING_FOR_INFO"].includes(t.status)) return true;
  if (wf.isAssignee && ["ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(t.status)) return true;
  return wf.canManage && ["NEW", "UNDER_REVIEW"].includes(t.status);
}

function toListItem(t: any, ctx: TicketAccessContext): TicketListItemDTO {
  return {
    id: t._id.toString(),
    ticketNumber: t.ticketNumber,
    title: t.title,
    status: t.status as TicketStatus,
    priority: t.priority as TaskPriority,
    category: { id: sid(t.category), name: t.categoryName },
    requester: toUserRef(t.requester),
    requestingDepartment: toDepartmentRef(t.requestingDepartment),
    targetDepartment: toDepartmentRef(t.targetDepartment),
    project: t.project && typeof t.project === "object" && "name" in t.project ? { id: t.project._id.toString(), name: t.project.name, code: t.project.code } : null,
    assignee: toUserRef(t.assignee),
    dueDate: iso(t.dueDate)!,
    isOverdue: isTicketOverdue(t),
    linkedTask: t.linkedTask && typeof t.linkedTask === "object" && "taskNumber" in t.linkedTask ? { id: t.linkedTask._id.toString(), taskNumber: t.linkedTask.taskNumber } : null,
    awaitingMe: awaitingViewer(ctx, t),
    createdAt: iso(t.createdAt)!,
    updatedAt: iso(t.updatedAt)!,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

function assertCanUseManageScope(ctx: TicketAccessContext) {
  if (!ctx.isAdmin && !ctx.canManageTickets && !ctx.canMonitorTickets) throw forbidden();
}

function scopeFilter(ctx: TicketAccessContext, scope: "mine" | "manage"): Filter {
  if (scope === "manage") {
    assertCanUseManageScope(ctx);
    return manageScopeFilter(ctx);
  }
  // My Tickets: only tickets the employee raised.
  return { requester: oid(ctx.user.id) };
}

export async function listTickets(user: CurrentUser, query: ListQuery): Promise<Paginated<TicketListItemDTO>> {
  const ctx = await ticketAccessContext(user);
  const and: Filter[] = [scopeFilter(ctx, query.scope)];
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    and.push({ $or: [{ title: rx }, { ticketNumber: rx }, { categoryName: rx }] });
  }
  if (query.status.length) and.push({ status: { $in: query.status } });
  if (isObjectId(query.department)) {
    const d = oid(query.department);
    and.push({ $or: [{ targetDepartment: d }, { requestingDepartment: d }] });
  }
  if (isObjectId(query.requester)) and.push({ requester: oid(query.requester) });
  if (query.assignee === "none") and.push({ assignee: null });
  else if (isObjectId(query.assignee)) and.push({ assignee: oid(query.assignee) });
  if (query.priority) and.push({ priority: query.priority });
  const now = new Date();
  if (query.due === "overdue") and.push(overdueFilter());
  if (query.due === "today") and.push({ dueDate: utcDayRange(now) });
  if (query.due === "week") and.push({ dueDate: utcDayRange(now, 8) });
  if (query.from || query.to) {
    const range: Filter = {};
    if (query.from) range.$gte = toStartDate(query.from);
    if (query.to) range.$lte = toDueDate(query.to);
    and.push({ dueDate: range });
  }
  const filter = { $and: and };
  const skip = (query.page - 1) * query.pageSize;

  let rows: any[];
  if (query.sort === "priority") {
    const ranked = await Ticket.aggregate<{ _id: Types.ObjectId }>([
      { $match: filter },
      { $addFields: { _rank: { $indexOfArray: [[...TASK_PRIORITIES].reverse(), "$priority"] } } },
      { $sort: { _rank: 1, dueDate: 1, _id: 1 } },
      { $skip: skip },
      { $limit: query.pageSize },
      { $project: { _id: 1 } },
    ]);
    const order = ranked.map((r) => r._id.toString());
    const found = await LIST_POPULATE(Ticket.find({ _id: { $in: ranked.map((r) => r._id) } }));
    rows = found.sort((a: any, b: any) => order.indexOf(a._id.toString()) - order.indexOf(b._id.toString()));
  } else {
    const field = query.sort.replace(/^-/, "");
    const dir = query.sort.startsWith("-") ? -1 : 1;
    rows = await LIST_POPULATE(Ticket.find(filter).sort({ [field]: dir, _id: -1 }).skip(skip).limit(query.pageSize));
  }
  const total = await Ticket.countDocuments(filter);
  return paginate(rows.map((r) => toListItem(r, ctx)), total, query.page, query.pageSize);
}

export async function ticketSummary(user: CurrentUser, scope: "mine" | "manage"): Promise<TicketSummaryDTO> {
  const ctx = await ticketAccessContext(user);
  const base = scopeFilter(ctx, scope);
  const awaitingFilter: Filter =
    scope === "mine"
      ? { status: { $in: ["RESOLVED", "WAITING_FOR_INFO"] } }
      : ctx.isAdmin || ctx.canManageTickets
        ? { status: { $in: ["NEW", "UNDER_REVIEW"] } }
        : { _id: null };
  const [byStatus, overdue, awaitingMe, people] = await Promise.all([
    Ticket.aggregate<{ _id: TicketStatus; n: number }>([{ $match: base }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Ticket.countDocuments({ $and: [base, overdueFilter()] }),
    // Managers only "own" the NEW/UNDER_REVIEW tickets inside their manage scope (not those they merely monitor).
    Ticket.countDocuments({ $and: [scope === "manage" && !ctx.isAdmin ? manageScopeFilterForManagers(ctx) : base, awaitingFilter] }),
    scope === "manage"
      ? Ticket.aggregate<{ requesters: Types.ObjectId[]; assignees: Types.ObjectId[] }>([
          { $match: base },
          { $group: { _id: null, requesters: { $addToSet: "$requester" }, assignees: { $addToSet: "$assignee" } } },
        ])
      : Promise.resolve([]),
  ]);
  const counts = Object.fromEntries(TICKET_STATUSES.map((s) => [s, 0])) as Record<TicketStatus, number>;
  for (const r of byStatus) counts[r._id] = r.n;
  const ids = people[0] ? uniq([...people[0].requesters, ...people[0].assignees].map((x) => sid(x))) : [];
  const users = ids.length ? await User.find({ _id: { $in: ids.map((x) => oid(x)) } }).select(USER_REF_FIELDS).sort({ name: 1 }).lean() : [];
  const ref = (list: Types.ObjectId[] = []) => {
    const set = new Set(list.filter(Boolean).map((x) => x.toString()));
    return users.filter((u) => set.has(u._id.toString())).map((u) => toUserRef(u)!);
  };
  return {
    counts,
    overdue,
    open: TICKET_STATUSES.filter((s) => !FINAL_TICKET_STATUSES.includes(s)).reduce((n, s) => n + counts[s], 0),
    awaitingMe,
    requesters: ref(people[0]?.requesters),
    assignees: ref(people[0]?.assignees),
  };
}

/** Tickets the viewer can act on as a manager (not just monitor). */
function manageScopeFilterForManagers(ctx: TicketAccessContext): Filter {
  if (!ctx.canManageTickets) return { _id: null };
  return { $or: [{ project: null }, { project: { $in: [...ctx.managed].map((x) => oid(x)) } }] };
}

export async function getTicket(user: CurrentUser, id: string): Promise<TicketDetailDTO> {
  const loaded = await loadTicket(user, id);
  const { ctx } = loaded;
  let ticket = loaded.ticket;

  // Self-healing: if a previous request died between the ticket write and the task sync, finish it now.
  if (ticket.assignee || ticket.linkedTask) {
    const task = ticket.linkedTask ? await Task.findById(ticket.linkedTask).select("status owner").lean() : null;
    const expected = linkedTaskStatus(ticket.status as TicketStatus, !!ticket.assignee);
    if (!task || task.status !== expected || (ticket.assignee && sid(task.owner) !== sid(ticket.assignee))) {
      await syncLinkedTask(ticket._id, sid(ticket.assignedBy) || user.id);
      ticket = (await Ticket.findById(ticket._id).lean())!;
    }
  }

  const [t, comments, activity, files, linkedTask] = await Promise.all([
    LIST_POPULATE(
      Ticket.findById(ticket._id)
        .populate("assignedBy", USER_REF_FIELDS)
        .populate("reviewedBy", USER_REF_FIELDS)
        .populate("assignments.employee", USER_REF_FIELDS)
        .populate("assignments.department", DEPT_REF_FIELDS)
        .populate("assignments.assignedBy", USER_REF_FIELDS)
        .populate("infoRequest.requestedBy", USER_REF_FIELDS)
        .populate("resolutions.submittedBy", USER_REF_FIELDS)
        .populate("resolutions.reviewedBy", USER_REF_FIELDS)
        .populate("closure.closedBy", USER_REF_FIELDS)
        .populate("rejection.rejectedBy", USER_REF_FIELDS)
    ) as Promise<any>,
    TicketComment.find({ ticket: ticket._id }).sort({ createdAt: 1 }).populate("author", USER_REF_FIELDS).lean(),
    TicketActivity.find({ ticket: ticket._id }).sort({ createdAt: -1, _id: -1 }).limit(200).populate("actor", USER_REF_FIELDS).lean(),
    Attachment.find({ entityType: "Ticket", entityId: ticket._id }).sort({ createdAt: 1 }).populate("uploadedBy", USER_REF_FIELDS).lean(),
    ticket.linkedTask ? Task.findById(ticket.linkedTask).select("status").lean() : Promise.resolve(null),
  ]);

  const wf = ticketWorkflowContext(ctx, ticket);
  const manage = canManageTicket(ctx, ticket);
  const monitor = canMonitorTicket(ctx, ticket);
  const final = FINAL_TICKET_STATUSES.includes(ticket.status as TicketStatus);
  const submitted = new Set((ticket.resolutions ?? []).flatMap((r: any) => (r.deliverables ?? []).map(String)));
  const participant = wf.isRequester || wf.isAssignee || monitor;

  const mapFile = (a: any): AttachmentDTO => {
    const dto = toAttachmentDTO(a, user.id, manage);
    dto.canDelete = dto.canDelete && !final && !submitted.has(a._id.toString());
    return dto;
  };
  const byId = new Map(files.map((f) => [f._id.toString(), f]));

  return {
    ...toListItem(t, ctx),
    description: t.description,
    referenceLinks: t.referenceLinks ?? [],
    assignedBy: toUserRef(t.assignedBy),
    assignedAt: iso(t.assignedAt),
    reviewedBy: toUserRef(t.reviewedBy),
    reviewedAt: iso(t.reviewedAt),
    startedAt: iso(t.startedAt),
    resolvedAt: iso(t.resolvedAt),
    reopenCount: t.reopenCount ?? 0,
    assignments: (t.assignments ?? [])
      .map((a: any) => ({
        id: a._id.toString(),
        employee: toUserRef(a.employee),
        department: toDepartmentRef(a.department),
        assignedBy: toUserRef(a.assignedBy),
        assignedAt: iso(a.assignedAt)!,
        note: a.note ?? "",
        endedAt: iso(a.endedAt),
        endReason: a.endReason ?? null,
      }))
      .reverse(),
    infoRequest:
      t.status === "WAITING_FOR_INFO" && t.infoRequest?.requestedAt
        ? { requestedBy: toUserRef(t.infoRequest.requestedBy), requestedAt: iso(t.infoRequest.requestedAt), message: t.infoRequest.message ?? "" }
        : null,
    resolutions: (t.resolutions ?? [])
      .map((r: any) => ({
        id: r._id.toString(),
        round: r.round,
        note: r.note ?? "",
        deliverables: (r.deliverables ?? []).map((d: any) => byId.get(String(d))).filter(Boolean).map(mapFile),
        submittedBy: toUserRef(r.submittedBy),
        submittedAt: iso(r.submittedAt)!,
        outcome: r.outcome,
        reviewedBy: toUserRef(r.reviewedBy),
        reviewedAt: iso(r.reviewedAt),
        feedback: r.feedback ?? "",
      }))
      .reverse(),
    draftDeliverables: files.filter((f: any) => f.kind === "DELIVERABLE" && !submitted.has(f._id.toString())).map(mapFile),
    attachments: files.filter((f: any) => f.kind !== "DELIVERABLE").map(mapFile),
    comments: comments.map((c) => ({
      id: c._id.toString(),
      body: c.body,
      kind: (c.kind ?? "COMMENT") as TicketDetailDTO["comments"][number]["kind"],
      author: toUserRef(c.author),
      createdAt: iso(c.createdAt)!,
    })),
    activity: activity.map((a) => ({
      id: a._id.toString(),
      action: a.action,
      message: a.message ?? "",
      from: a.from ?? null,
      to: a.to ?? null,
      actor: toUserRef(a.actor),
      createdAt: iso(a.createdAt)!,
    })),
    closure: t.closure?.closedAt
      ? { closedBy: toUserRef(t.closure.closedBy), closedAt: iso(t.closure.closedAt), note: t.closure.note ?? "", byManager: !!t.closure.byManager }
      : null,
    rejection:
      t.status === "REJECTED" && t.rejection?.rejectedAt
        ? { rejectedBy: toUserRef(t.rejection.rejectedBy), rejectedAt: iso(t.rejection.rejectedAt), reason: t.rejection.reason ?? "" }
        : null,
    linkedTaskStatus: (linkedTask?.status as TaskStatus) ?? null,
    actions: availableActions(wf),
    viewer: { isRequester: wf.isRequester, isAssignee: wf.isAssignee, canManage: manage, canMonitor: monitor },
    can: {
      comment: !final && (participant || manage),
      upload: !final && (participant || manage),
      uploadDeliverable: wf.isAssignee && ["IN_PROGRESS", "CHANGES_REQUESTED"].includes(ticket.status),
      edit: manage && !final,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Create & edit                                                       */
/* ------------------------------------------------------------------ */

async function activeCategory(id: string) {
  await ensureDefaultTicketCategories();
  const category = await TicketCategory.findById(id).lean();
  if (!category || category.isActive === false) throw unprocessable("Choose an active category", { category: "Category not available" });
  return category;
}

async function activeDepartment(id: string, field: string) {
  const dept = await Department.findById(id).select("name status head").lean();
  if (!dept) throw unprocessable("Department not found", { [field]: "Department not found" });
  if (dept.status !== "ACTIVE") throw unprocessable(`${dept.name} is archived and can't receive requests`, { [field]: "Department is archived" });
  return dept;
}

export async function createTicket(user: CurrentUser, input: CreateInput): Promise<{ id: string; ticketNumber: string }> {
  if (!hasPermission(user.role, "ticket:create")) throw forbidden();
  // The requesting department always comes from the employee profile, never from the client.
  if (!user.departmentId) {
    throw unprocessable("Your profile has no department, so a ticket can't be raised. Ask an administrator to set your department.");
  }
  const requestingDept = await Department.findById(user.departmentId).select("name").lean();
  if (!requestingDept) throw unprocessable("Your department no longer exists. Ask an administrator to update your profile.");
  const [target, category] = await Promise.all([activeDepartment(input.targetDepartment, "targetDepartment"), activeCategory(input.category)]);
  assertDueDateNotPast(input.dueDate);

  let projectId: Types.ObjectId | null = null;
  if (input.project) {
    const ctx = await accessContext(user);
    const project = await Project.findById(input.project).select("departments isArchived name").lean();
    if (!project || !canViewProject(ctx, project)) throw unprocessable("Project not found", { project: "Choose a project you're part of" });
    if (project.isArchived) throw unprocessable("This project is archived", { project: "Project is archived" });
    projectId = project._id;
  }

  const ticket = await Ticket.create({
    ticketNumber: await generateTicketNumber(),
    title: input.title,
    description: input.description,
    requester: oid(user.id),
    requestingDepartment: requestingDept._id,
    targetDepartment: target._id,
    project: projectId,
    category: category._id,
    categoryName: category.name,
    priority: input.priority,
    dueDate: toDueDate(input.dueDate),
    referenceLinks: uniq(input.referenceLinks),
    status: "NEW",
  });

  await log(ticket._id, user.id, "CREATED", `Raised ${ticket.ticketNumber} for ${target.name} (${category.name})`, {
    to: "NEW",
    meta: { requestingDepartment: requestingDept._id, targetDepartment: target._id, category: category._id, priority: input.priority },
  });
  await recordAudit({ actorId: user.id, action: "ticket.create", entityType: "Ticket", entityId: ticket._id, summary: `Raised ${ticket.ticketNumber} "${ticket.title}"` });

  await notifyTicket(
    ticket,
    await ticketManagers(ticket),
    user.id,
    "New internal ticket",
    `${ticket.ticketNumber} · ${ticket.title} — ${user.name} (${requestingDept.name}) → ${target.name}`
  );
  await notifyTicket(ticket, [target.head], user.id, `New request for ${target.name}`, `${ticket.ticketNumber} · ${ticket.title} — from ${user.name} (${requestingDept.name})`, "ticket_updates");
  return { id: ticket._id.toString(), ticketNumber: ticket.ticketNumber };
}

export async function updateTicket(user: CurrentUser, id: string, input: UpdateInput): Promise<void> {
  const { ctx, ticket } = await loadTicket(user, id);
  if (!canManageTicket(ctx, ticket)) throw forbidden("Only the managing Project Manager can edit this ticket");
  if (FINAL_TICKET_STATUSES.includes(ticket.status as TicketStatus)) throw unprocessable("Reopen the ticket before editing it");

  const set: Record<string, unknown> = {};
  const changes: string[] = [];
  if (input.priority && input.priority !== ticket.priority) {
    set.priority = input.priority;
    changes.push(`Priority ${humanize(ticket.priority)} → ${humanize(input.priority)}`);
  }
  if (input.dueDate && input.dueDate !== ticket.dueDate.toISOString().slice(0, 10)) {
    assertDueDateNotPast(input.dueDate);
    set.dueDate = toDueDate(input.dueDate);
    changes.push(`Required date ${ticket.dueDate.toISOString().slice(0, 10)} → ${input.dueDate}`);
  }
  if (input.category && input.category !== sid(ticket.category)) {
    const category = await activeCategory(input.category);
    Object.assign(set, { category: category._id, categoryName: category.name });
    changes.push(`Category ${ticket.categoryName} → ${category.name}`);
  }
  if (input.targetDepartment && input.targetDepartment !== sid(ticket.targetDepartment)) {
    if (ticket.assignee) throw unprocessable("Reassign the ticket to change its department", { targetDepartment: "Use Reassign" });
    const dept = await activeDepartment(input.targetDepartment, "targetDepartment");
    const prev = await Department.findById(ticket.targetDepartment).select("name").lean();
    set.targetDepartment = dept._id;
    changes.push(`Target department ${prev?.name ?? "—"} → ${dept.name}`);
  }
  if (!changes.length) return;
  await guardedUpdate(ticket, { $set: set });
  await log(ticket._id, user.id, "UPDATED", changes.join("; "));
  await syncLinkedTask(ticket._id, user.id);
  if (ticket.assignee) await notifyTicket(ticket, [ticket.assignee], user.id, `Ticket ${ticket.ticketNumber} updated`, changes.join("; "), "ticket_updates");
}

/* ------------------------------------------------------------------ */
/* Assignment                                                          */
/* ------------------------------------------------------------------ */

/** Active employees of a department who can take the ticket, with their current workload. */
export async function eligibleAssignees(user: CurrentUser, id: string, departmentId: string): Promise<EligibleAssigneeDTO[]> {
  const { ctx, ticket } = await loadTicket(user, id);
  if (!canManageTicket(ctx, ticket)) throw forbidden("Only the managing Project Manager can assign this ticket");
  const dept = await activeDepartment(departmentId, "department");
  const users = await User.find({ department: dept._id, status: "ACTIVE", _id: { $ne: ticket.requester } })
    .select("name email employeeId designation role")
    .sort({ name: 1 })
    .lean();
  const load = await Task.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { owner: { $in: users.map((u) => u._id) }, status: { $nin: CLOSED_TASK_STATUSES } } },
    { $group: { _id: "$owner", n: { $sum: 1 } } },
  ]);
  const loadMap = new Map(load.map((l) => [l._id.toString(), l.n]));
  return Promise.all(
    users.map(async (u) => ({
      id: u._id.toString(),
      name: u.name,
      email: u.email,
      employeeId: u.employeeId,
      designation: u.designation ?? "",
      role: (await getRoleById(u.role))?.key ?? null,
      openTasks: loadMap.get(u._id.toString()) ?? 0,
    }))
  );
}

/**
 * Assigns (or reassigns) the ticket to an employee of the selected department,
 * then creates/updates the linked task in that employee's My Tasks.
 */
export async function assignTicket(user: CurrentUser, id: string, input: AssignInput): Promise<void> {
  const { ctx, ticket } = await loadTicket(user, id);
  const action: TicketAction = ticket.assignee ? "REASSIGN" : "ASSIGN";
  assertAction(ctx, ticket, action);

  const dept = await activeDepartment(input.department, "department");
  const employee = await User.findById(input.employee).select("name status department").lean();
  if (!employee) throw unprocessable("Employee not found", { employee: "Employee not found" });
  if (employee.status !== "ACTIVE") throw unprocessable(`${employee.name} is inactive`, { employee: "Employee is inactive" });
  if (sid(employee.department) !== dept._id.toString()) {
    throw unprocessable(`${employee.name} doesn't belong to ${dept.name}`, { employee: "Not in the selected department" });
  }
  if (employee._id.toString() === sid(ticket.requester)) {
    throw unprocessable("The requester can't be assigned their own request", { employee: "Choose someone else" });
  }
  if (action === "REASSIGN" && employee._id.toString() === sid(ticket.assignee)) {
    throw unprocessable(`${employee.name} is already assigned to this ticket`, { employee: "Already assigned" });
  }
  if (input.dueDate) assertDueDateNotPast(input.dueDate);

  const now = new Date();
  const from = ticket.status as TicketStatus;
  const to = nextStatus(action, from);
  const previous = ticket.assignee ? await User.findById(ticket.assignee).select("name").lean() : null;
  const prevDept = await Department.findById(ticket.targetDepartment).select("name").lean();

  const assignments = (ticket.assignments ?? []).map((a: any) => (a.endedAt ? a : { ...a, endedAt: now, endReason: "REASSIGNED" }));
  assignments.push({ employee: employee._id, department: dept._id, assignedBy: oid(user.id), assignedAt: now, note: input.note, endedAt: null, endReason: null } as any);

  const set: Record<string, unknown> = {
    status: to,
    assignee: employee._id,
    assignedBy: oid(user.id),
    assignedAt: now,
    targetDepartment: dept._id,
    assignments,
  };
  if (!ticket.reviewedAt) Object.assign(set, { reviewedBy: oid(user.id), reviewedAt: now });
  if (input.priority && input.priority !== ticket.priority) set.priority = input.priority;
  if (input.dueDate) set.dueDate = toDueDate(input.dueDate);
  // A new assignee hasn't started: if the ticket is waiting for info, resume at Assigned rather than In Progress.
  if (from === "WAITING_FOR_INFO" && ticket.infoRequest?.resumeStatus === "IN_PROGRESS") set["infoRequest.resumeStatus"] = "ASSIGNED";
  await guardedUpdate(ticket, { $set: set });

  if (from === "NEW") await log(ticket._id, user.id, "REVIEW_STARTED", "Reviewed the request");
  await log(
    ticket._id,
    user.id,
    "DEPARTMENT_ASSIGNED",
    sid(prevDept?._id) === dept._id.toString() ? `Department assigned: ${dept.name}` : `Department changed from ${prevDept?.name ?? "—"} to ${dept.name}`,
    { from: prevDept?.name ?? null, to: dept.name, meta: { department: dept._id } }
  );
  if (action === "ASSIGN") {
    await log(ticket._id, user.id, "ASSIGNED", `Assigned to ${employee.name}${input.note ? ` — ${input.note}` : ""}`, {
      to: employee.name,
      meta: { employee: employee._id, department: dept._id },
    });
  } else {
    await log(ticket._id, user.id, "REASSIGNED", `Reassigned from ${previous?.name ?? "—"} to ${employee.name}${input.note ? ` — ${input.note}` : ""}`, {
      from: previous?.name ?? null,
      to: employee.name,
      meta: { employee: employee._id, previous: ticket.assignee, department: dept._id },
    });
  }
  const tweaks: string[] = [];
  if (set.priority) tweaks.push(`Priority ${humanize(ticket.priority)} → ${humanize(input.priority!)}`);
  if (input.dueDate && input.dueDate !== ticket.dueDate.toISOString().slice(0, 10)) tweaks.push(`Required date set to ${input.dueDate}`);
  if (tweaks.length) await log(ticket._id, user.id, "UPDATED", tweaks.join("; "));
  await logStatus(ticket._id, user.id, from, to);
  if (input.note) await addThreadEntry(ticket._id, user.id, input.note, "ASSIGNMENT");

  await syncLinkedTask(ticket._id, user.id);
  await recordAudit({
    actorId: user.id,
    action: action === "ASSIGN" ? "ticket.assign" : "ticket.reassign",
    entityType: "Ticket",
    entityId: ticket._id,
    summary: `${action === "ASSIGN" ? "Assigned" : "Reassigned"} ${ticket.ticketNumber} to ${employee.name} (${dept.name})`,
  });

  const fresh = (await Ticket.findById(ticket._id).populate("requester", "name").populate("requestingDepartment", "name").lean()) as any;
  const origin = `${fresh.requester?.name ?? "a colleague"}${fresh.requestingDepartment?.name ? ` · ${fresh.requestingDepartment.name}` : ""}`;
  await notifyTicket(ticket, [employee._id], user.id, "New internal request assigned to you", `${ticket.ticketNumber} · ${ticket.title} (from ${origin})`);
  if (previous) {
    await notifyTicket(ticket, [previous._id], user.id, "Internal request reassigned", `${ticket.ticketNumber} · ${ticket.title} is now assigned to ${employee.name}.`, "ticket_updates");
  }
  await notifyTicket(
    ticket,
    [ticket.requester],
    user.id,
    action === "ASSIGN" ? "Your ticket has been assigned" : "Your ticket has been reassigned",
    `${ticket.ticketNumber} · ${employee.name} (${dept.name}) is working on your request.`,
    "ticket_updates"
  );
}

/* ------------------------------------------------------------------ */
/* Workflow actions                                                    */
/* ------------------------------------------------------------------ */

export async function performTicketAction(user: CurrentUser, id: string, input: ActionInput): Promise<void> {
  const before = await Ticket.findById(id).select("status").lean();
  await performTicketActionInner(user, id, input);
  // REJECT / ACCEPT / REOPEN write their own, more specific audit entries.
  if (!["REJECT", "ACCEPT", "REOPEN"].includes(input.action)) {
    const t = await Ticket.findById(id).select("ticketNumber status").lean();
    await recordAudit({
      actorId: user.id,
      action: `ticket.${input.action.toLowerCase()}`,
      entityType: "Ticket",
      entityId: oid(id),
      summary: `${t?.ticketNumber}: ${TICKET_ACTION_LABELS[input.action]} → ${label(t?.status ?? "")}`,
      changes: { status: { from: before?.status ?? null, to: t?.status ?? null } },
    });
  }
}

async function performTicketActionInner(user: CurrentUser, id: string, input: ActionInput): Promise<void> {
  const { ctx, ticket } = await loadTicket(user, id);
  assertAction(ctx, ticket, input.action);
  const now = new Date();
  const from = ticket.status as TicketStatus;
  const actorIsRequester = isTicketRequester(ctx, ticket);

  switch (input.action) {
    case "START_REVIEW": {
      await guardedUpdate(ticket, { $set: { status: "UNDER_REVIEW", reviewedBy: oid(user.id), reviewedAt: now } });
      await log(ticket._id, user.id, "REVIEW_STARTED", input.note ? `Started reviewing — ${input.note}` : "Started reviewing the request");
      await logStatus(ticket._id, user.id, from, "UNDER_REVIEW");
      if (input.note) await addThreadEntry(ticket._id, user.id, input.note, "COMMENT");
      await notifyTicket(ticket, [ticket.requester], user.id, "Your ticket is under review", undefined, "ticket_updates");
      break;
    }

    case "REJECT": {
      const set: Record<string, unknown> = {
        status: "REJECTED",
        rejection: { rejectedBy: oid(user.id), rejectedAt: now, reason: input.reason },
        infoRequest: { requestedBy: null, requestedAt: null, message: "", resumeStatus: null },
      };
      if (ticket.assignee) {
        set.assignments = (ticket.assignments ?? []).map((a: any) => (a.endedAt ? a : { ...a, endedAt: now, endReason: "REJECTED" }));
        set.assignee = null;
      }
      await guardedUpdate(ticket, { $set: set });
      await addThreadEntry(ticket._id, user.id, input.reason, "REJECTION");
      await log(ticket._id, user.id, "REJECTED", `Rejected: ${input.reason}`, { from, to: "REJECTED" });
      await syncLinkedTask(ticket._id, user.id);
      await recordAudit({ actorId: user.id, action: "ticket.reject", entityType: "Ticket", entityId: ticket._id, summary: `Rejected ${ticket.ticketNumber}` });
      await notifyTicket(ticket, [ticket.requester, ticket.assignee], user.id, "Ticket rejected", `${ticket.ticketNumber} · ${input.reason.slice(0, 160)}`, "ticket_updates");
      break;
    }

    case "REQUEST_INFO": {
      await guardedUpdate(ticket, {
        $set: { status: "WAITING_FOR_INFO", infoRequest: { requestedBy: oid(user.id), requestedAt: now, message: input.message, resumeStatus: from } },
      });
      await addThreadEntry(ticket._id, user.id, input.message, "INFO_REQUEST");
      await log(ticket._id, user.id, "INFO_REQUESTED", `Requested more information: ${input.message}`, { from, to: "WAITING_FOR_INFO" });
      await syncLinkedTask(ticket._id, user.id);
      await notifyTicket(ticket, [ticket.requester], user.id, "More information needed for your ticket", `${ticket.ticketNumber} · ${input.message.slice(0, 160)}`);
      break;
    }

    case "PROVIDE_INFO": {
      const to = nextStatus("PROVIDE_INFO", from, (ticket.infoRequest?.resumeStatus as TicketStatus) ?? (ticket.assignee ? "ASSIGNED" : "UNDER_REVIEW"));
      await guardedUpdate(ticket, { $set: { status: to, infoRequest: { requestedBy: null, requestedAt: null, message: "", resumeStatus: null } } });
      await addThreadEntry(ticket._id, user.id, input.message, "INFO_RESPONSE");
      await log(ticket._id, user.id, "INFO_PROVIDED", `${actorIsRequester ? "Provided" : "Provided on the requester's behalf"}: ${input.message}`, { from, to });
      await syncLinkedTask(ticket._id, user.id);
      await notifyTicket(
        ticket,
        [ticket.infoRequest?.requestedBy, ticket.assignee],
        user.id,
        "Requested information provided",
        `${ticket.ticketNumber} · ${input.message.slice(0, 160)}`,
        "ticket_updates"
      );
      break;
    }

    case "START_WORK": {
      await guardedUpdate(ticket, { $set: { status: "IN_PROGRESS", ...(ticket.startedAt ? {} : { startedAt: now }) } });
      await log(ticket._id, user.id, "STATUS_CHANGED", from === "CHANGES_REQUESTED" ? "Started working on the requested changes" : "Started work", { from, to: "IN_PROGRESS" });
      await syncLinkedTask(ticket._id, user.id);
      await notifyTicket(ticket, [ticket.requester], user.id, "Work started on your ticket", undefined, "ticket_updates");
      break;
    }

    case "RESOLVE": {
      const submitted = new Set((ticket.resolutions ?? []).flatMap((r: any) => (r.deliverables ?? []).map(String)));
      const drafts = await Attachment.find({ entityType: "Ticket", entityId: ticket._id, kind: "DELIVERABLE" }).select("_id fileName").sort({ createdAt: 1 }).lean();
      const fresh = drafts.filter((d) => !submitted.has(d._id.toString()));
      if (!fresh.length && !input.note) {
        throw unprocessable("Upload the deliverable or add a resolution note before submitting", { note: "Add a note or upload a deliverable" });
      }
      const round = (ticket.resolutions?.length ?? 0) + 1;
      await guardedUpdate(ticket, {
        $set: { status: "RESOLVED", resolvedAt: now },
        $push: {
          resolutions: {
            round,
            note: input.note,
            deliverables: fresh.map((d) => d._id),
            submittedBy: oid(user.id),
            submittedAt: now,
            outcome: "PENDING",
          },
        },
      });
      const files = fresh.map((d) => d.fileName).join(", ");
      await addThreadEntry(ticket._id, user.id, input.note || `Submitted ${fresh.length} deliverable(s): ${files}`, "RESOLUTION");
      await log(ticket._id, user.id, "RESOLVED", `Submitted as resolved${round > 1 ? ` (revision ${round})` : ""}${files ? ` with ${files}` : ""}`, {
        from,
        to: "RESOLVED",
        meta: { round, deliverables: fresh.map((d) => d._id) },
      });
      await syncLinkedTask(ticket._id, user.id);
      await notifyTicket(
        ticket,
        [ticket.requester],
        user.id,
        round > 1 ? "Revised work submitted on your ticket" : "Your ticket has been resolved",
        `${ticket.ticketNumber} · Review the delivered work and confirm completion or request changes.`
      );
      break;
    }

    case "ACCEPT":
    case "REQUEST_CHANGES": {
      const idx = (ticket.resolutions ?? []).length - 1;
      if (idx < 0) throw unprocessable("There is no submitted work to review");
      const accept = input.action === "ACCEPT";
      const text = accept ? input.note : input.feedback;
      const set: Record<string, unknown> = {
        [`resolutions.${idx}.outcome`]: accept ? "ACCEPTED" : "CHANGES_REQUESTED",
        [`resolutions.${idx}.reviewedBy`]: oid(user.id),
        [`resolutions.${idx}.reviewedAt`]: now,
        [`resolutions.${idx}.feedback`]: text,
        status: accept ? "CLOSED" : "CHANGES_REQUESTED",
      };
      if (accept) set.closure = { closedBy: oid(user.id), closedAt: now, note: text, byManager: !actorIsRequester };
      await guardedUpdate(ticket, { $set: set });

      if (accept) {
        if (text) await addThreadEntry(ticket._id, user.id, text, "CLOSURE");
        await log(ticket._id, user.id, "CLOSED", actorIsRequester ? `Confirmed completion${text ? ` — ${text}` : ""}` : `Closed on the requester's behalf${text ? ` — ${text}` : ""}`, {
          from,
          to: "CLOSED",
          meta: { round: idx + 1, byManager: !actorIsRequester },
        });
        await syncLinkedTask(ticket._id, user.id);
        await recordAudit({ actorId: user.id, action: "ticket.close", entityType: "Ticket", entityId: ticket._id, summary: `Closed ${ticket.ticketNumber}` });
        await notifyTicket(ticket, [ticket.assignee, ticket.assignedBy], user.id, "Ticket closed — work accepted", `${ticket.ticketNumber} · ${ticket.title}`, "ticket_updates");
        if (!actorIsRequester) await notifyTicket(ticket, [ticket.requester], user.id, "Your ticket was closed", `${ticket.ticketNumber} · Closed by ${user.name}`, "ticket_updates");
      } else {
        await addThreadEntry(ticket._id, user.id, text, "CHANGE_REQUEST");
        await log(ticket._id, user.id, "CHANGES_REQUESTED", `Requested changes: ${text}`, { from, to: "CHANGES_REQUESTED", meta: { round: idx + 1 } });
        await syncLinkedTask(ticket._id, user.id);
        await notifyTicket(ticket, [ticket.assignee], user.id, "Changes requested on your work", `${ticket.ticketNumber} · ${text.slice(0, 160)}`);
      }
      break;
    }

    case "REOPEN": {
      const to = nextStatus("REOPEN", from);
      const set: Record<string, unknown> = { status: to };
      if (from === "CLOSED") set.closure = { closedBy: null, closedAt: null, note: "", byManager: false };
      if (from === "REJECTED") set.rejection = { rejectedBy: null, rejectedAt: null, reason: "" };
      await guardedUpdate(ticket, { $set: set, $inc: { reopenCount: 1 } });
      await addThreadEntry(ticket._id, user.id, input.reason, "REOPEN");
      await log(ticket._id, user.id, "REOPENED", `Reopened: ${input.reason}`, { from, to });
      await syncLinkedTask(ticket._id, user.id);
      await recordAudit({ actorId: user.id, action: "ticket.reopen", entityType: "Ticket", entityId: ticket._id, summary: `Reopened ${ticket.ticketNumber}` });
      if (from === "CLOSED") {
        await notifyTicket(ticket, [ticket.assignee, ticket.assignedBy, ticket.requester], user.id, "Ticket reopened", `${ticket.ticketNumber} · ${input.reason.slice(0, 160)}`, "ticket_updates");
      } else {
        await notifyTicket(ticket, [ticket.requester], user.id, "Your ticket was reopened for review", `${ticket.ticketNumber} · ${ticket.title}`, "ticket_updates");
      }
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

export async function addTicketComment(user: CurrentUser, id: string, body: string): Promise<void> {
  const { ctx, ticket } = await loadTicket(user, id);
  if (FINAL_TICKET_STATUSES.includes(ticket.status as TicketStatus)) throw unprocessable("This ticket is closed. Reopen it to continue the conversation.");
  const wf = ticketWorkflowContext(ctx, ticket);
  if (!(wf.isRequester || wf.isAssignee || canMonitorTicket(ctx, ticket))) throw forbidden("Former assignees can view this ticket but not comment");
  await TicketComment.create({ ticket: ticket._id, author: oid(user.id), body, kind: "COMMENT" });
  await log(ticket._id, user.id, "COMMENTED", `Commented: ${body.slice(0, 160)}`);
  await notifyTicket(ticket, [ticket.requester, ticket.assignee, ticket.assignedBy], user.id, `New comment on ${ticket.ticketNumber}`, body.slice(0, 160), "comments");
}

/* ------------------------------------------------------------------ */
/* Dashboards                                                          */
/* ------------------------------------------------------------------ */

/** Employee dashboard: my open tickets. */
export async function myOpenTickets(user: CurrentUser, limit = 6): Promise<TicketListItemDTO[]> {
  const ctx = await ticketAccessContext(user);
  const rows = await LIST_POPULATE(
    Ticket.find({ requester: oid(user.id), status: { $nin: FINAL_TICKET_STATUSES } }).sort({ updatedAt: -1 }).limit(limit)
  );
  return rows.map((r: any) => toListItem(r, ctx));
}

/** Project Manager dashboard: new / under-review tickets waiting for assignment. */
export async function ticketIntakeQueue(user: CurrentUser, limit = 6): Promise<{ items: TicketListItemDTO[]; total: number }> {
  const ctx = await ticketAccessContext(user);
  if (!ctx.isAdmin && !ctx.canManageTickets) return { items: [], total: 0 };
  const filter = { $and: [manageScopeFilter(ctx), { status: { $in: ["NEW", "UNDER_REVIEW"] } }] };
  const [rows, total] = await Promise.all([LIST_POPULATE(Ticket.find(filter).sort({ createdAt: 1 }).limit(limit)), Ticket.countDocuments(filter)]);
  return { items: rows.map((r: any) => toListItem(r, ctx)), total };
}

/** Department Head dashboard: open requests sent to departments they head. */
export async function departmentTicketQueue(user: CurrentUser, limit = 6): Promise<{ items: TicketListItemDTO[]; total: number }> {
  const ctx = await ticketAccessContext(user);
  if (!ctx.headed.size) return { items: [], total: 0 };
  const filter = { targetDepartment: { $in: [...ctx.headed].map((x) => oid(x)) }, status: { $nin: FINAL_TICKET_STATUSES } };
  const [rows, total] = await Promise.all([LIST_POPULATE(Ticket.find(filter).sort({ dueDate: 1 }).limit(limit)), Ticket.countDocuments(filter)]);
  return { items: rows.map((r: any) => toListItem(r, ctx)), total };
}


/** Every active department (minimal fields) — any employee may request help from any department. */
export async function ticketTargetDepartments(): Promise<DepartmentRef[]> {
  const rows = await Department.find({ status: "ACTIVE" }).select(DEPT_REF_FIELDS).sort({ name: 1 }).collation({ locale: "en", strength: 2 }).lean();
  return rows.map((d) => toDepartmentRef(d)!);
}
