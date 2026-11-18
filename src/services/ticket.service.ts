import "server-only";
import type { z } from "zod";
import type { CurrentUser } from "@/lib/auth/current-user";
import { conflict, escapeRegex, forbidden, notFound, paginate, unprocessable } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { getRoleByKey } from "@/lib/roles";
import {
  REVIEW_OVERDUE_HOURS,
  TICKET_ACTIVE_WORK_STATUSES,
  TICKET_CLOSED_STATUSES,
  humanize,
  type Availability,
  type TicketStatus,
} from "@/lib/constants";
import { Department, nextSequence, Ticket, TicketActivity, User } from "@/models";
import { canReviewDeliverable, isReviewOverdue, reviewAlreadyStarted, reviewRoutedTo, reviewerProblem } from "@/lib/ticket-review";
import {
  applyProgress,
  applyVerification,
  deliverableStatus,
  deliverableSummary,
  describeDeliverableChanges,
  mergeDeliverables,
  progressText,
  unfinishedDeliverables,
  verifyAll,
  type DeliverableRecord,
} from "@/lib/deliverables";
import type { DeliverableDTO, Paginated, ReviewerOptionDTO, ReviewQueueRowDTO, TeamWorkloadDTO, TicketActivityDTO, TicketDetailDTO, TicketDTO, TicketSummaryDTO, WorkloadRowDTO } from "@/types/dto";
import type {
  createTicketSchema,
  reviewQueueQuerySchema,
  ticketActionSchema,
  ticketListQuerySchema,
  updateTicketSchema,
} from "@/lib/validations/ticket";
import { listAttachments } from "./attachment.service";
import { accumulateLoads, finalizeLoad, loadSettings, periodCapacity } from "./workload.service";
import { appendToQueue, ensureRanked, queuePositions, reorderAuthority } from "./ticket-queue.service";
import { iso, toDepartmentRef, toUserRef, DEPT_REF_FIELDS, USER_REF_FIELDS } from "./mappers";
import { oid, type Filter } from "./scope";
import { headedTicketDepartmentIds, ticketCan, ticketDepartments, ticketRights, ticketTriageFilter, triageDepartmentIds, triageRecipients } from "./ticket-access";
import { hasPermission } from "@/lib/permissions";

/* eslint-disable @typescript-eslint/no-explicit-any */

type CreateInput = z.output<typeof createTicketSchema>;
type UpdateInput = z.output<typeof updateTicketSchema>;
type ActionInput = z.output<typeof ticketActionSchema>;
type ListQuery = z.output<typeof ticketListQuerySchema>;
type ReviewQueueQuery = z.output<typeof reviewQueueQuerySchema>;

const s = (v: any): string => (v ? String(v._id ?? v) : "");
const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null);
const toDueDate = (v: string | null | undefined) => (v ? new Date(`${v}T23:59:59.999Z`) : null);
const link = (id: any) => `/tickets/${s(id)}`;
const isClosed = (st: string) => TICKET_CLOSED_STATUSES.includes(st as TicketStatus);
const isOverdue = (t: { status: string; dueDate?: Date | null }) =>
  !!t.dueDate && t.dueDate.getTime() < Date.now() && !isClosed(t.status) && t.status !== "DRAFT";

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

async function log(
  t: { _id: any; ticketNumber: string },
  actorId: string,
  action: string,
  extra: {
    fromStatus?: string | null;
    toStatus?: string | null;
    from?: unknown;
    to?: unknown;
    message?: string;
    /** Extra field-level before/after values for the audit trail. */
    changes?: Record<string, { from: unknown; to: unknown }>;
  } = {}
) {
  const changes = {
    ...(extra.fromStatus || extra.toStatus ? { status: { from: extra.fromStatus ?? null, to: extra.toStatus ?? null } } : {}),
    ...(extra.changes ?? {}),
  };
  await TicketActivity.create({
    ticket: t._id,
    actor: oid(actorId),
    action: action as never,
    fromStatus: extra.fromStatus ?? null,
    toStatus: extra.toStatus ?? null,
    from: extra.from ?? null,
    to: extra.to ?? null,
    message: (extra.message ?? "").slice(0, 3000),
  });
  await recordAudit({
    actorId,
    action: `ticket.${action.toLowerCase()}`,
    entityType: "Ticket",
    entityId: t._id,
    summary: `${t.ticketNumber}: ${action.toLowerCase().replaceAll("_", " ")}${extra.message ? ` – ${extra.message.slice(0, 120)}` : ""}`,
    changes: Object.keys(changes).length ? changes : null,
  });
}

/* ------------------------------------------------------------------ */
/* Deliverables (rules in lib/deliverables.ts)                         */
/* ------------------------------------------------------------------ */

const recordsOf = (t: any): DeliverableRecord[] =>
  (t.deliverables ?? []).map((d: any) => ({
    id: s(d._id),
    type: d.type,
    quantity: d.quantity,
    specifications: d.specifications ?? "",
    completedQuantity: d.completedQuantity ?? 0,
    verifiedQuantity: d.verifiedQuantity ?? 0,
  }));

/** Back to the stored shape. Existing rows keep their `_id`; mongoose assigns one to new rows. */
const toStored = (list: DeliverableRecord[]) =>
  list.map(({ id, ...rest }) => (id ? { _id: oid(id), ...rest } : rest));

const toDeliverableDTO = (d: DeliverableRecord): DeliverableDTO => ({ ...d, id: d.id!, status: deliverableStatus(d) });

/** Compact "Videos 2, Banner 1" form for the audit trail's before/after values. */
const deliverablesSnapshot = (list: DeliverableRecord[]) => list.map((d) => `${d.type} ${d.quantity}`).join(", ") || "none";

function assertDeliverables(errors: Record<string, string>) {
  const keys = Object.keys(errors);
  if (keys.length) throw unprocessable(errors[keys[0]], errors);
}

/** Work can't go to review, or be approved, while a requested quantity hasn't been reached. */
function assertDeliverablesDone(ticket: any, what: string) {
  const open = unfinishedDeliverables(recordsOf(ticket));
  if (open.length) throw unprocessable(`${what}: ${open.map(progressText).join(", ")}`);
}

/**
 * Work timer helpers. Timer changes ride along with the status change in one atomic update, so the
 * clock can never keep running after the ticket leaves In Progress.
 */
function timerStop(ticket: any, kind: "PAUSED" | "AUTO", reason = "") {
  const startedAt: Date | undefined = ticket.timer?.startedAt;
  if (!ticket.timer?.running || !startedAt) return { set: {} as Record<string, unknown>, push: {} as Record<string, unknown> };
  const endedAt = new Date();
  const seconds = Math.max(0, Math.round((endedAt.getTime() - new Date(startedAt).getTime()) / 1000));
  return {
    set: { "timer.running": false, "timer.startedAt": null, "timer.by": null, "timer.totalSeconds": (ticket.timer.totalSeconds ?? 0) + seconds },
    push: { timeLog: { user: ticket.timer.by ?? ticket.assignee, startedAt, endedAt, seconds, pauseReason: reason.slice(0, 500), endKind: kind } },
  };
}
/**
 * One running timer per person. If another ticket's timer is running, the caller must confirm
 * (`pausePrevious`); then that timer is closed first, so two clocks never run at once.
 */
async function claimTimer(ticket: any, userId: string, pausePrevious?: boolean) {
  const other: any = await Ticket.findOne({ "timer.running": true, "timer.by": oid(userId), _id: { $ne: ticket._id } }).select("ticketNumber timer assignee");
  if (!other) return;
  if (!pausePrevious) throw unprocessable(`${other.ticketNumber} timer is still running. Pause it to continue with this ticket.`, { timerConflict: other.ticketNumber });
  const tm = timerStop(other, "PAUSED", `Paused to work on ${ticket.ticketNumber}`);
  await Ticket.updateOne({ _id: other._id, "timer.running": true, "timer.startedAt": other.timer.startedAt }, { $set: tm.set, $push: tm.push });
}
const timerStart = (userId: string) => ({ "timer.running": true, "timer.startedAt": new Date(), "timer.by": oid(userId) });

/**
 * Atomic compare-and-set: the update only applies while the ticket is still in one of the
 * expected statuses, so two people acting at once can never both succeed (no double assignment).
 */
async function move(ticket: any, from: TicketStatus[], set: Record<string, unknown>, push?: Record<string, unknown>) {
  const update = push ? { $set: set, $push: push } : { $set: set };
  const updated = await Ticket.findOneAndUpdate({ _id: ticket._id, status: { $in: from }, updatedAt: ticket.updatedAt }, update, { returnDocument: "after" });
  if (!updated) throw conflict("This ticket was just updated by someone else. Refresh and try again.");
  return updated;
}

/* ------------------------------------------------------------------ */
/* Workload                                                            */
/* ------------------------------------------------------------------ */

function availabilityOf(load: number): Availability {
  if (load >= 1) return "FULL";
  if (load >= 0.6) return "LIMITED";
  return "AVAILABLE";
}

/**
 * Everyone who can be given work for a department: its employees, team leaders and Department Head,
 * plus anyone named as the department's head / team leader on the department record itself.
 * Project Managers are deliberately excluded: they approve and assign, they aren't assigned.
 */
async function eligiblePeople(departmentId: string, fields: string) {
  const [employeeRole, leaderRole, headRole, dept] = await Promise.all([
    getRoleByKey("EMPLOYEE"),
    getRoleByKey("TEAM_LEADER"),
    getRoleByKey("DEPARTMENT_HEAD"),
    Department.findById(departmentId).select("head teamLeaders").lean(),
  ]);
  const named = [dept?.head, ...(dept?.teamLeaders ?? [])].filter(Boolean);
  return User.find({
    status: "ACTIVE",
    $or: [
      { department: oid(departmentId), role: { $in: [oid(employeeRole.id), oid(leaderRole.id), oid(headRole.id)] } },
      { _id: { $in: named } },
    ],
  })
    .select(fields)
    .sort({ name: 1 })
    .lean();
}

/**
 * Per-employee load for a department. Combines assigned tickets and open tasks, and weighs both
 * the NUMBER of items and their estimated EFFORT in hours against fixed capacities, so one huge
 * task counts as more than several tiny ones. Deadlines surface as overdue count / next due date.
 */
export async function departmentWorkload(departmentId: string, suggestedId?: string | null): Promise<WorkloadRowDTO[]> {
  const people = await eligiblePeople(departmentId, "name email avatarUrl designation employeeId");
  if (!people.length) return [];
  const st = await loadSettings();
  const capacity = periodCapacity(st, "week");
  const loads = await accumulateLoads(people.map((p) => p._id), { settings: st });

  const rows = people.map((p) => {
    const id = p._id.toString();
    const f = finalizeLoad(loads.get(id), st, capacity);
    return {
      id,
      name: p.name,
      email: p.email,
      avatarUrl: p.avatarUrl ?? "",
      designation: p.designation ?? "",
      employeeId: p.employeeId,
      activeItems: f.items,
      ticketItems: f.ticketItems,
      taskItems: f.taskItems,
      pendingItems: f.pending,
      openHours: f.workloadHours,
      capacityHours: capacity,
      overdue: f.overdue,
      nextDue: iso(f.nextDue),
      loadPercent: f.utilization,
      category: f.category,
      unestimatedItems: f.unestimated,
      // Assignment guard: fully occupied from 100%.
      availability: availabilityOf(f.utilization / 100),
      suggested: !!suggestedId && suggestedId === id,
    } satisfies WorkloadRowDTO;
  });
  return rows.sort((a, b) => a.loadPercent - b.loadPercent || a.name.localeCompare(b.name));
}

export async function getWorkload(user: CurrentUser, departmentId: string, ticketId?: string): Promise<WorkloadRowDTO[]> {
  const dept = await Department.findById(departmentId).select("head projectManagers").lean();
  if (!dept) throw notFound("Department not found");
  let allowed =
    user.role === "SUPER_ADMIN" ||
    dept.head?.toString() === user.id ||
    (dept.projectManagers ?? []).some((p) => p.toString() === user.id);
  let suggested: string | null = null;
  if (ticketId) {
    const t = await Ticket.findById(ticketId).select("status createdBy assignee suggestedEmployee targetDepartment additionalDepartments requestingDepartment projectManager assignedReviewer").lean();
    if (t && ticketDepartments(t).includes(departmentId)) {
      const rights = await ticketRights(user, t);
      if (rights.triager && t.status !== "DRAFT") allowed = true;
      if (rights.view) suggested = s(t.suggestedEmployee) || null;
    }
  }
  if (!allowed) throw forbidden("Only the ticket's Project Manager or department Head can view its workload");
  return departmentWorkload(departmentId, suggested);
}

/** Validates an assignee and enforces the capacity guard. */
async function resolveAssignee(departments: string[], assigneeId: string, override: boolean): Promise<{ id: string; name: string }> {
  const person = await User.findById(assigneeId).select("name status department role").lean();
  if (!person || person.status !== "ACTIVE") throw unprocessable("That employee is not available", { assignee: "Employee not found or inactive" });
  let row: Awaited<ReturnType<typeof departmentWorkload>>[number] | undefined;
  for (const d of departments) {
    row = (await departmentWorkload(d)).find((r) => r.id === assigneeId);
    if (row) break;
  }
  if (!row) throw unprocessable(`${person.name} can't be assigned tickets`, { assignee: "Pick someone from the ticket's departments (employee, team leader or department head)" });
  if (row.availability === "FULL" && !override) {
    throw unprocessable(`${person.name} is fully occupied (${row.activeItems} active items, ${row.openHours}h of ${row.capacityHours}h). Confirm the override to assign anyway.`, {
      assignee: "Fully occupied",
    });
  }
  return { id: assigneeId, name: person.name };
}

/* ------------------------------------------------------------------ */
/* Reviewer                                                            */
/* ------------------------------------------------------------------ */

/** Any active employee may review a ticket's deliverable (the PM chooses; the assignee is excluded by the callers). */
async function reviewerPool(_ticket: unknown, fields: string) {
  return User.find({ status: "ACTIVE" }).select(fields).populate("department", "name").sort({ name: 1 }).limit(1000).lean();
}

/** Eligible reviewers for the assignment screen. Only people who assign (PM, Department Head, admin) may list them. */
export async function reviewerOptions(user: CurrentUser, ticketId: string): Promise<ReviewerOptionDTO[]> {
  const { ticket, rights } = await load(user, ticketId);
  if (!(rights.triager || rights.targetHead || rights.admin)) throw forbidden("Only the Project Manager or department Head can choose a reviewer");
  const people: any[] = await reviewerPool(ticket, "name email employeeId avatarUrl designation department");
  return people
    .filter((p) => s(p._id) !== s(ticket.assignee))
    .map((p) => ({
      id: p._id.toString(),
      name: p.name,
      email: p.email,
      employeeId: p.employeeId,
      avatarUrl: p.avatarUrl ?? "",
      designation: p.designation ?? "",
      department: p.department?.name ?? "",
    }));
}

/** Validates a reviewer choice server-side (never trust the picker): active, eligible, and not the assignee. */
async function resolveReviewer(ticket: any, reviewerId: string, assigneeId: unknown): Promise<{ id: string; name: string }> {
  const problem = reviewerProblem(reviewerId, assigneeId as any);
  if (problem) throw unprocessable(problem, { reviewer: problem });
  const person: any = await User.findById(reviewerId).select("name status department role").lean();
  if (!person || person.status !== "ACTIVE") throw unprocessable("That reviewer is not available", { reviewer: "Employee not found or inactive" });
  return { id: reviewerId, name: person.name };
}

/** One reviewer-change history entry (append-only). */
const reviewerEntry = (previous: unknown, next: string, by: string, reason: string) => ({
  previousReviewer: previous ? oid(s(previous)) : null,
  newReviewer: oid(next),
  changedBy: oid(by),
  reason,
  createdAt: new Date(),
});

type ReviewerPlan = { reviewer: { id: string; name: string }; set: Record<string, unknown>; push: Record<string, unknown>; previous: unknown };

/**
 * Decides whether an assignment also changes the reviewer. Without a request the current reviewer stays,
 * but it must not collide with the new assignee (nobody reviews their own work).
 */
async function planReviewer(ticket: any, requested: string | null | undefined, assigneeId: unknown, by: string, reason: string): Promise<ReviewerPlan | null> {
  const current = s(ticket.assignedReviewer);
  if (!requested || requested === current) {
    const clash = current ? reviewerProblem(current, assigneeId as any) : null;
    if (clash) throw unprocessable(`${clash}. Choose a different reviewer.`, { reviewer: clash });
    return null;
  }
  const reviewer = await resolveReviewer(ticket, requested, assigneeId);
  return {
    reviewer,
    set: { assignedReviewer: oid(reviewer.id) },
    push: { reviewHistory: reviewerEntry(ticket.assignedReviewer, reviewer.id, by, reason) },
    previous: ticket.assignedReviewer,
  };
}

/* ------------------------------------------------------------------ */
/* Review queue                                                        */
/* ------------------------------------------------------------------ */

/**
 * Tickets whose deliverable is (or was) under review. People see the reviews routed to them (plus legacy
 * tickets they raised). Project Managers see the reviews of tickets they triage so they can track them;
 * Super Admins see everything. `canReview` is true only for the routed reviewer and administrators.
 */
export async function listReviews(user: CurrentUser, query: ReviewQueueQuery): Promise<Paginated<ReviewQueueRowDTO>> {
  const me = oid(user.id);
  const admin = user.role === "SUPER_ADMIN";
  const and: Filter[] = [{ reviewStatus: { $in: ["PENDING", "CHANGES_REQUESTED", "APPROVED"] } }, { status: { $ne: "DRAFT" } }];
  if (!admin) {
    const visible: Filter[] = [{ assignedReviewer: me }, { assignedReviewer: null, createdBy: me }];
    if (hasPermission(user.role, "ticket:manage")) visible.push(await ticketTriageFilter(user));
    and.push({ $or: visible });
  }
  if (query.filter === "pending") and.push({ reviewStatus: "PENDING" });
  if (query.filter === "changes") and.push({ reviewStatus: "CHANGES_REQUESTED" });
  if (query.filter === "approved") and.push({ reviewStatus: "APPROVED" });
  if (query.filter === "overdue") and.push({ reviewStatus: "PENDING", submittedAt: { $lt: new Date(Date.now() - REVIEW_OVERDUE_HOURS * 3_600_000) } });
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    and.push({ $or: [{ title: rx }, { ticketNumber: rx }] });
  }
  const filter = { $and: and };
  const total = await Ticket.countDocuments(filter);
  // Oldest waiting reviews first, so nothing sits unnoticed.
  const pendingFirst = query.filter === "pending" || query.filter === "overdue";
  const rows: any[] = await Ticket.find(filter)
    .sort(pendingFirst ? { submittedAt: 1, _id: 1 } : { updatedAt: -1, _id: -1 })
    .skip((query.page - 1) * query.pageSize)
    .limit(query.pageSize)
    .populate("targetDepartment", DEPT_REF_FIELDS)
    .populate("assignee", USER_REF_FIELDS)
    .populate("assignedReviewer", USER_REF_FIELDS)
    .populate("createdBy", USER_REF_FIELDS)
    .lean();
  const items = rows.map((t): ReviewQueueRowDTO => {
    const routed = reviewRoutedTo(t);
    return {
      id: t._id.toString(),
      ticketNumber: t.ticketNumber,
      title: t.title,
      targetDepartment: toDepartmentRef(t.targetDepartment),
      status: t.status as TicketStatus,
      reviewStatus: (t.reviewStatus ?? "NONE") as ReviewQueueRowDTO["reviewStatus"],
      assignee: toUserRef(t.assignee),
      assignedReviewer: toUserRef(t.assignedReviewer),
      legacyReviewer: routed.legacy,
      reviewerName: (routed.legacy ? toUserRef(t.createdBy) : toUserRef(t.assignedReviewer))?.name ?? null,
      submittedAt: iso(t.submittedAt),
      isOverdue: isReviewOverdue(t),
      canReview: canReviewDeliverable({ userId: user.id, isAdmin: admin, ticket: t }),
    };
  });
  return paginate(items, total, query.page, query.pageSize);
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

const POPULATE = (q: any) =>
  q
    .populate("requestingDepartment", DEPT_REF_FIELDS)
    .populate("targetDepartment", DEPT_REF_FIELDS)
    .populate("additionalDepartments", DEPT_REF_FIELDS)
    .populate("createdBy", USER_REF_FIELDS)
    .populate("projectManager", USER_REF_FIELDS)
    .populate("assignedReviewer", USER_REF_FIELDS)
    .populate("assignee", USER_REF_FIELDS);

function toDTO(t: any): TicketDTO {
  return {
    id: t._id.toString(),
    ticketNumber: t.ticketNumber,
    title: t.title,
    category: t.category ?? "Other",
    priority: t.priority,
    status: t.status as TicketStatus,
    requestingDepartment: toDepartmentRef(t.requestingDepartment),
    targetDepartment: toDepartmentRef(t.targetDepartment),
    additionalDepartments: (t.additionalDepartments ?? []).map(toDepartmentRef).filter(Boolean) as TicketDTO["additionalDepartments"],
    createdBy: toUserRef(t.createdBy),
    projectManager: toUserRef(t.projectManager),
    assignedReviewer: toUserRef(t.assignedReviewer),
    reviewStatus: (t.reviewStatus ?? "NONE") as TicketDTO["reviewStatus"],
    assignee: toUserRef(t.assignee),
    queuePosition: null,
    queueSize: 0,
    canReorder: false,
    dueDate: iso(t.dueDate),
    expectedCompletion: iso(t.expectedCompletion),
    isOverdue: isOverdue(t),
    deliverableSummary: t.deliverables?.length ? deliverableSummary(recordsOf(t)) : null,
    createdAt: iso(t.createdAt)!,
    updatedAt: iso(t.updatedAt)!,
  };
}

async function load(user: CurrentUser, id: string) {
  const ticket = await Ticket.findById(id);
  if (!ticket) throw notFound("Ticket not found");
  const rights = await ticketRights(user, ticket);
  if (!rights.view) throw notFound("Ticket not found");
  return { ticket, rights, can: ticketCan(rights, ticket) };
}

export async function getTicket(user: CurrentUser, id: string): Promise<TicketDetailDTO> {
  const { ticket, rights, can } = await load(user, id);
  const t: any = await POPULATE(Ticket.findById(ticket._id))
    .populate("suggestedEmployee", USER_REF_FIELDS)
    .populate("approvedBy", USER_REF_FIELDS)
    .populate("assignedBy", USER_REF_FIELDS)
    .populate("reviewDecidedBy", USER_REF_FIELDS)
    .populate("reviewComments.author", USER_REF_FIELDS)
    .populate("reviewHistory.previousReviewer", USER_REF_FIELDS)
    .populate("reviewHistory.newReviewer", USER_REF_FIELDS)
    .populate("reviewHistory.changedBy", USER_REF_FIELDS)
    .populate("timer.by", USER_REF_FIELDS)
    .populate("timeLog.user", USER_REF_FIELDS)
    .lean();
  const [activity, attachments] = await Promise.all([
    TicketActivity.find({ ticket: ticket._id }).sort({ createdAt: 1 }).populate("actor", USER_REF_FIELDS).lean(),
    listAttachments(user, "Ticket", ticket._id, rights.triager),
  ]);
  // The assignee only ever sees the work itself, never the requester's staffing hint.
  const showSuggestion = rights.requester || rights.triager || rights.head || rights.admin;
  return {
    ...toDTO(t),
    description: t.description ?? "",
    referenceLinks: t.referenceLinks ?? [],
    deliverables: recordsOf(t).map(toDeliverableDTO),
    suggestedEmployee: showSuggestion ? toUserRef(t.suggestedEmployee) : null,
    approvedBy: toUserRef(t.approvedBy),
    approvedAt: iso(t.approvedAt),
    assignedBy: toUserRef(t.assignedBy),
    assignedAt: iso(t.assignedAt),
    estimatedHours: t.estimatedHours ?? null,
    decisionReason: t.decisionReason ?? "",
    clarificationRequest: t.clarificationRequest ?? "",
    submissionNote: t.submissionNote ?? "",
    startedAt: iso(t.startedAt),
    submittedAt: iso(t.submittedAt),
    completedAt: iso(t.completedAt),
    attachments,
    reviewRoutedTo: {
      user: t.assignedReviewer ? toUserRef(t.assignedReviewer) : toUserRef(t.createdBy),
      legacy: reviewRoutedTo(t).legacy,
    },
    reviewComments: (t.reviewComments ?? []).map((c: any) => ({
      id: c._id.toString(),
      author: toUserRef(c.author),
      decision: c.decision,
      comment: c.comment ?? "",
      createdAt: iso(c.createdAt)!,
    })),
    reviewHistory: (t.reviewHistory ?? []).map((h: any) => ({
      id: h._id.toString(),
      previousReviewer: toUserRef(h.previousReviewer),
      newReviewer: toUserRef(h.newReviewer),
      changedBy: toUserRef(h.changedBy),
      reason: h.reason ?? "",
      createdAt: iso(h.createdAt)!,
    })),
    reviewDecidedBy: toUserRef(t.reviewDecidedBy),
    reviewDecidedAt: iso(t.reviewDecidedAt),
    timer: {
      running: !!t.timer?.running,
      startedAt: iso(t.timer?.startedAt),
      by: toUserRef(t.timer?.by),
      totalSeconds: t.timer?.totalSeconds ?? 0,
      serverNow: new Date().toISOString(),
      log: [...(t.timeLog ?? [])].reverse().map((l: any) => ({
        id: l._id.toString(),
        user: toUserRef(l.user),
        startedAt: iso(l.startedAt)!,
        endedAt: iso(l.endedAt)!,
        seconds: l.seconds ?? 0,
        pauseReason: l.pauseReason ?? "",
        endKind: l.endKind ?? "PAUSED",
      })),
    },
    activity: activity.map(
      (a: any): TicketActivityDTO => ({
        id: a._id.toString(),
        action: a.action,
        fromStatus: a.fromStatus ?? null,
        toStatus: a.toStatus ?? null,
        from: a.from == null ? null : String(a.from),
        to: a.to == null ? null : String(a.to),
        message: a.message ?? "",
        actor: toUserRef(a.actor),
        createdAt: iso(a.createdAt)!,
      })
    ),
    can,
  };
}

/* ------------------------------------------------------------------ */
/* Create / update                                                     */
/* ------------------------------------------------------------------ */

/** Extra departments: active, de-duplicated, never the target itself. */
async function activeExtraDepartments(ids: string[] | undefined, targetId: string): Promise<string[]> {
  const unique = [...new Set(ids ?? [])].filter((d) => d !== targetId);
  if (!unique.length) return [];
  const rows = await Department.find({ _id: { $in: unique.map(oid) } }).select("name status").lean();
  if (rows.length !== unique.length) throw unprocessable("A selected department was not found", { additionalDepartments: "Department not found" });
  const inactive = rows.find((r) => r.status !== "ACTIVE");
  if (inactive) throw unprocessable(`${inactive.name} is not active`, { additionalDepartments: `${inactive.name} is not active` });
  return unique;
}

/** Tell the heads of newly involved departments that their team was added to a ticket. */
async function announceInvolvement(ticket: any, departmentIds: string[], actor: CurrentUser) {
  if (!departmentIds.length || ticket.status === "DRAFT") return;
  const depts = await Department.find({ _id: { $in: departmentIds.map(oid) } }).select("head").lean();
  await notify({
    recipients: depts.map((d) => d.head).filter(Boolean) as any[],
    actorId: actor.id,
    type: "TICKET",
    title: "Your department was added to a ticket",
    message: `${ticket.ticketNumber} · ${ticket.title}`,
    link: link(ticket._id),
    entityType: "Ticket",
    entityId: ticket._id,
  });
}

async function activeTargetDepartment(id: string) {
  const target = await Department.findById(id).select("name status").lean();
  if (!target) throw unprocessable("Department not found", { targetDepartment: "Department not found" });
  if (target.status !== "ACTIVE") throw unprocessable(`${target.name} is not active`, { targetDepartment: "Department is not active" });
  return target;
}

export async function createTicket(user: CurrentUser, input: CreateInput): Promise<TicketDTO> {
  const target = await activeTargetDepartment(input.targetDepartment);
  const extra = await activeExtraDepartments(input.additionalDepartments, input.targetDepartment);
  if (input.projectManager) await assertTicketManager(input.projectManager, user.id);
  if (input.suggestedEmployee) await assertSuggestion(input.suggestedEmployee, input.targetDepartment);

  const status: TicketStatus = input.draft ? "DRAFT" : "PENDING_APPROVAL";
  const ticket = await Ticket.create({
    ticketNumber: `TKT-${String(await nextSequence("ticketNumber")).padStart(5, "0")}`,
    title: input.title,
    description: input.description,
    category: input.category,
    priority: input.priority,
    status,
    requestingDepartment: user.departmentId ? oid(user.departmentId) : null,
    targetDepartment: oid(input.targetDepartment),
    additionalDepartments: extra.map(oid),
    createdBy: oid(user.id),
    projectManager: input.projectManager ? oid(input.projectManager) : null,
    suggestedEmployee: input.suggestedEmployee ? oid(input.suggestedEmployee) : null,
    referenceLinks: input.referenceLinks,
    deliverables: toStored(mergeDeliverables([], input.deliverables.map((d) => ({ ...d, id: null }))).next),
    dueDate: toDueDate(input.dueDate),
  });
  await log(ticket, user.id, "CREATED", { toStatus: status, message: input.draft ? "Saved as draft" : `Raised to ${target.name}` });
  if (!input.draft) {
    await announceSubmission(ticket, user);
    await announceInvolvement(ticket, extra, user);
  }
  const fresh = await POPULATE(Ticket.findById(ticket._id)).lean();
  return toDTO(fresh);
}

/** The suggestion is only a hint: it is validated but never assigned or notified. */
async function assertSuggestion(userId: string, targetDepartment: string) {
  const u = await User.findById(userId).select("status department name").lean();
  if (!u || u.status !== "ACTIVE" || s(u.department) !== targetDepartment) {
    throw unprocessable("The suggested employee must be an active member of the target department", { suggestedEmployee: "Pick someone from the target department" });
  }
}

/** Any active Project Manager may receive a direct review request. */
async function assertTicketManager(id: string, requesterId: string) {
  if (id === requesterId) throw unprocessable("Choose another Project Manager to review your ticket", { projectManager: "You cannot review your own ticket" });
  const role = await getRoleByKey("PROJECT_MANAGER");
  const manager = await User.findOne({ _id: oid(id), role: oid(role.id), status: "ACTIVE" }).select("_id").lean();
  if (!manager) throw unprocessable("Select an active Project Manager", { projectManager: "Project Manager not found or inactive" });
}

export async function ticketManagerOptions() {
  const role = await getRoleByKey("PROJECT_MANAGER");
  const people = await User.find({ role: oid(role.id), status: "ACTIVE" })
    .select("name email employeeId").sort({ name: 1 }).limit(500).lean();
  return people.map((p) => ({ id: p._id.toString(), name: p.name, email: p.email, employeeId: p.employeeId }));
}

async function announceSubmission(ticket: any, actor: CurrentUser) {
  const recipients = await triageRecipients(ticket.targetDepartment, ticket.projectManager);
  await notify({
    recipients,
    actorId: actor.id,
    type: "TICKET",
    title: "New ticket awaiting your approval",
    message: `${ticket.ticketNumber} · ${ticket.title} (${humanize(ticket.priority)} priority)`,
    link: link(ticket._id),
    entityType: "Ticket",
    entityId: ticket._id,
  });
}

export async function updateTicket(user: CurrentUser, id: string, input: UpdateInput): Promise<void> {
  const { ticket, can } = await load(user, id);
  if (!can.edit) throw forbidden("This ticket can't be edited in its current state");
  const set: Record<string, unknown> = {};
  for (const f of ["title", "description", "category", "priority", "referenceLinks"] as const) {
    if (input[f] !== undefined) set[f] = input[f];
  }
  if (input.dueDate !== undefined) set.dueDate = toDueDate(input.dueDate);
  // Before approval the requester shapes the request freely; ids keep existing rows stable.
  let deliverableChanges: string[] = [];
  if (input.deliverables !== undefined) {
    const current = recordsOf(ticket);
    const { next, errors } = mergeDeliverables(current, input.deliverables);
    assertDeliverables(errors);
    deliverableChanges = describeDeliverableChanges(current, next);
    if (deliverableChanges.length) set.deliverables = toStored(next);
  }
  const managerChanged = input.projectManager !== undefined && s(input.projectManager) !== s(ticket.projectManager);
  if (managerChanged) {
    if (!can.changeProjectManager) throw unprocessable("The Project Manager cannot be changed in this ticket's current state", { projectManager: "Ticket is no longer editable" });
    if (input.projectManager) await assertTicketManager(input.projectManager, s(ticket.createdBy));
    set.projectManager = input.projectManager ? oid(input.projectManager) : null;
    if (ticket.status !== "DRAFT") {
      set.status = "PENDING_APPROVAL";
      set.reviewedBy = null;
      set.clarificationRequest = "";
    }
  }
  const target = input.targetDepartment ?? s(ticket.targetDepartment);
  if (input.targetDepartment !== undefined && target !== s(ticket.targetDepartment)) {
    if (ticket.status !== "DRAFT") throw unprocessable("Cancel this ticket and raise a new one to change the department");
    await activeTargetDepartment(target);
    set.targetDepartment = oid(target);
  }
  let addedDepartments: string[] = [];
  if (input.additionalDepartments !== undefined) {
    const next = await activeExtraDepartments(input.additionalDepartments, target);
    const current = (ticket.additionalDepartments ?? []).map(String);
    if (next.length !== current.length || next.some((d) => !current.includes(d))) {
      set.additionalDepartments = next.map(oid);
      addedDepartments = next.filter((d) => !current.includes(d));
    }
  }
  if (input.suggestedEmployee !== undefined) {
    if (input.suggestedEmployee) await assertSuggestion(input.suggestedEmployee, target);
    set.suggestedEmployee = input.suggestedEmployee ? oid(input.suggestedEmployee) : null;
  }
  if (!Object.keys(set).length) return;
  const updated = await move(ticket, [ticket.status as TicketStatus], set);
  const changedFields = Object.keys(set).filter((k) => k !== "deliverables");
  await log(ticket, user.id, "UPDATED", {
    message: [changedFields.length ? `Changed ${changedFields.join(", ")}` : "", ...deliverableChanges].filter(Boolean).join("\n"),
  });
  if (managerChanged && ticket.status !== "DRAFT") await announceSubmission(updated, user);
  await announceInvolvement(updated, addedDepartments, user);
}

/* ------------------------------------------------------------------ */
/* Workflow actions                                                    */
/* ------------------------------------------------------------------ */

function need(ok: boolean, msg = "You can't do that on this ticket right now") {
  if (!ok) throw forbidden(msg);
}

/** Records and announces a reviewer assignment / change. The new reviewer is the only recipient. */
async function announceReviewer(base: { _id: any; ticketNumber: string }, ticket: any, plan: ReviewerPlan, actorId: string, reason: string, reviewPending: boolean) {
  const changed = !!plan.previous;
  const previous = plan.previous ? await User.findById(plan.previous).select("name").lean() : null;
  await log(base, actorId, changed ? "REVIEWER_CHANGED" : "REVIEWER_ASSIGNED", {
    from: previous?.name ?? null,
    to: plan.reviewer.name,
    message: reason,
  });
  await notify({
    recipients: [plan.reviewer.id],
    actorId,
    type: "TICKET",
    title: changed ? "Review reassigned to you" : "You were assigned as reviewer",
    message: `${ticket.ticketNumber} · ${ticket.title}${reviewPending ? " (work is waiting for your review)" : ""}`,
    link: link(ticket._id),
    entityType: "Ticket",
    entityId: ticket._id,
  });
}

export async function ticketAction(user: CurrentUser, id: string, input: ActionInput): Promise<void> {
  const { ticket, rights, can } = await load(user, id);
  const from = ticket.status as TicketStatus;
  const base = { ticketNumber: ticket.ticketNumber, _id: ticket._id };
  const triageWho = async () => triageRecipients(ticket.targetDepartment, ticket.projectManager);
  const note = (extra: Partial<Parameters<typeof notify>[0]> & { title: string; recipients: any[] }) =>
    notify({ actorId: user.id, type: "TICKET", link: link(ticket._id), entityType: "Ticket", entityId: ticket._id, ...extra });

  switch (input.action) {
    case "submit": {
      need(can.submit);
      await move(ticket, ["DRAFT"], { status: "PENDING_APPROVAL" });
      await log(base, user.id, "SUBMITTED", { fromStatus: from, toStatus: "PENDING_APPROVAL" });
      await announceSubmission(ticket, user);
      return;
    }

    case "start_review": {
      need(can.triage);
      if (from !== "PENDING_APPROVAL") throw unprocessable("This ticket is already under review");
      await move(ticket, ["PENDING_APPROVAL"], { status: "UNDER_REVIEW", reviewedBy: oid(user.id) });
      await log(base, user.id, "REVIEW_STARTED", { fromStatus: from, toStatus: "UNDER_REVIEW" });
      return;
    }

    case "request_info": {
      need(can.triage);
      await move(ticket, ["PENDING_APPROVAL", "UNDER_REVIEW"], { status: "PENDING_CLARIFICATION", clarificationRequest: input.message, reviewedBy: oid(user.id) });
      await log(base, user.id, "INFO_REQUESTED", { fromStatus: from, toStatus: "PENDING_CLARIFICATION", message: input.message });
      await note({ recipients: [ticket.createdBy], title: "More information requested", message: `${ticket.ticketNumber}: ${input.message}` });
      return;
    }

    case "respond": {
      need(can.respond);
      await move(ticket, ["PENDING_CLARIFICATION"], { status: "PENDING_APPROVAL", clarificationRequest: "" });
      await log(base, user.id, "INFO_PROVIDED", { fromStatus: from, toStatus: "PENDING_APPROVAL", message: input.message });
      await note({ recipients: await triageWho(), title: "Requester replied – ticket awaiting approval", message: `${ticket.ticketNumber} · ${ticket.title}` });
      return;
    }

    case "reject": {
      need(can.triage);
      await move(ticket, ["PENDING_APPROVAL", "UNDER_REVIEW"], { status: "REJECTED", decisionReason: input.message, reviewedBy: oid(user.id) });
      await log(base, user.id, "REJECTED", { fromStatus: from, toStatus: "REJECTED", message: input.message });
      await note({ recipients: [ticket.createdBy], title: "Ticket rejected", message: `${ticket.ticketNumber}: ${input.message}` });
      return;
    }

    case "approve": {
      need(can.approve);
      const assignee = input.assignee ? await resolveAssignee(ticketDepartments(ticket), input.assignee, input.overrideCapacity) : null;
      const plan = await planReviewer(ticket, input.reviewer, assignee?.id ?? ticket.assignee, user.id, "Initial assignment");
      const now = new Date();
      const common = {
        ...(plan?.set ?? {}),
        approvedBy: oid(user.id),
        approvedAt: now,
        reviewedBy: oid(user.id),
        decisionReason: input.message,
        ...(input.estimatedHours !== undefined ? { estimatedHours: input.estimatedHours } : {}),
        ...(input.expectedCompletion !== undefined ? { expectedCompletion: toDate(input.expectedCompletion) } : {}),
      };
      // Approval and assignment land in a single atomic write, so the ticket is never half-processed.
      const to: TicketStatus = assignee ? "ASSIGNED" : "UNASSIGNED";
      await move(
        ticket,
        ["PENDING_APPROVAL", "UNDER_REVIEW"],
        assignee ? { ...common, status: to, assignee: oid(assignee.id), assignedBy: oid(user.id), assignedAt: now } : { ...common, status: to },
        plan?.push
      );
      await log(base, user.id, "APPROVED", { fromStatus: from, toStatus: "APPROVED", message: input.message });
      if (plan) await announceReviewer(base, ticket, plan, user.id, "Initial assignment", false);
      if (assignee) {
        await appendToQueue(ticket._id, assignee.id);
        await log(base, user.id, "ASSIGNED", { fromStatus: "APPROVED", toStatus: "ASSIGNED", to: assignee.name, message: input.message });
        await note({ recipients: [assignee.id], title: "New ticket assigned to you", message: `${ticket.ticketNumber} · ${ticket.title}` });
      } else {
        // No employee picked: hand it to the target department's Head to assign (Project Managers can still assign too).
        const dept = await Department.findById(ticket.targetDepartment).select("head name").lean();
        const head = dept?.head && dept.head.toString() !== user.id ? dept.head.toString() : null;
        await log(base, user.id, "STATUS_CHANGED", {
          fromStatus: "APPROVED",
          toStatus: "UNASSIGNED",
          message: head ? "Approved without an employee – sent to the Department Head to assign" : "No employee selected – waiting in the unassigned queue",
        });
        if (head) {
          await note({ recipients: [head], title: "Ticket needs an assignee", message: `${ticket.ticketNumber} · ${ticket.title} was approved. Please assign it to someone in ${dept?.name ?? "your department"}.` });
        }
      }
      await note({
        recipients: [ticket.createdBy],
        title: "Ticket approved",
        message: assignee ? `${ticket.ticketNumber} was approved and assigned to ${assignee.name}.` : `${ticket.ticketNumber} was approved and is waiting for an available employee.`,
      });
      return;
    }

    case "assign": {
      need(can.assign);
      const assignee = await resolveAssignee(ticketDepartments(ticket), input.assignee, input.overrideCapacity);
      const plan = await planReviewer(ticket, input.reviewer, assignee.id, user.id, "Assigned with the ticket");
      await move(ticket, ["UNASSIGNED"], {
        status: "ASSIGNED",
        assignee: oid(assignee.id),
        assignedBy: oid(user.id),
        assignedAt: new Date(),
        ...(plan?.set ?? {}),
        ...(input.estimatedHours !== undefined ? { estimatedHours: input.estimatedHours } : {}),
        ...(input.expectedCompletion !== undefined ? { expectedCompletion: toDate(input.expectedCompletion) } : {}),
      }, plan?.push);
      await appendToQueue(ticket._id, assignee.id);
      await log(base, user.id, "ASSIGNED", { fromStatus: from, toStatus: "ASSIGNED", to: assignee.name, message: input.message });
      if (plan) await announceReviewer(base, ticket, plan, user.id, "Assigned with the ticket", false);
      await note({ recipients: [assignee.id], title: "New ticket assigned to you", message: `${ticket.ticketNumber} · ${ticket.title}` });
      await note({ recipients: [ticket.createdBy], title: "Ticket assigned", message: `${ticket.ticketNumber} is now assigned to ${assignee.name}.` });
      return;
    }

    case "reassign": {
      need(can.reassign, "Only the department's Project Manager or a Super Admin can reassign tickets");
      if (input.assignee === s(ticket.assignee)) throw unprocessable("That employee already has this ticket", { assignee: "Pick a different employee" });
      const previous = ticket.assignee ? await User.findById(ticket.assignee).select("name").lean() : null;
      const assignee = await resolveAssignee(ticketDepartments(ticket), input.assignee, input.overrideCapacity);
      const plan = await planReviewer(ticket, input.reviewer, assignee.id, user.id, input.message);
      const tm = timerStop(ticket, "AUTO", "Ticket reassigned");
      await move(ticket, ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"], {
        ...tm.set,
        status: "ASSIGNED",
        assignee: oid(assignee.id),
        assignedBy: oid(user.id),
        assignedAt: new Date(),
        startedAt: null,
        ...(plan?.set ?? {}),
        ...(input.estimatedHours !== undefined ? { estimatedHours: input.estimatedHours } : {}),
        ...(input.expectedCompletion !== undefined ? { expectedCompletion: toDate(input.expectedCompletion) } : {}),
      }, plan?.push || tm.push.timeLog ? { ...(plan?.push ?? {}), ...tm.push } : undefined);
      await appendToQueue(ticket._id, assignee.id);
      if (plan) await announceReviewer(base, ticket, plan, user.id, input.message, false);
      await log(base, user.id, "REASSIGNED", { fromStatus: from, toStatus: "ASSIGNED", from: previous?.name ?? null, to: assignee.name, message: input.message });
      await note({ recipients: [assignee.id], title: "Ticket reassigned to you", message: `${ticket.ticketNumber} · ${ticket.title}` });
      await note({ recipients: [ticket.assignee], title: "Ticket reassigned", message: `${ticket.ticketNumber} is no longer assigned to you.` });
      await note({ recipients: [ticket.createdBy], title: "Ticket reassigned", message: `${ticket.ticketNumber} is now with ${assignee.name}.` });
      return;
    }

    case "set_reviewer": {
      need(can.setReviewer, "Only the ticket's Project Manager or a Super Admin can assign or change the reviewer");
      if (input.reviewer === s(ticket.assignedReviewer)) throw unprocessable("That person is already the reviewer", { reviewer: "Pick a different reviewer" });
      const inReview = reviewAlreadyStarted(from);
      // Changing the reviewer while work is awaiting review must be deliberate and explained.
      if (inReview && !input.message) throw unprocessable("Explain why the reviewer is being changed", { message: "A reason is required while the review is in progress" });
      const plan = await planReviewer(ticket, input.reviewer, ticket.assignee, user.id, input.message);
      if (!plan) return;
      // The compare-and-set also guards against the previous reviewer acting at the same moment.
      await move(ticket, [from], plan.set, plan.push);
      await announceReviewer(base, ticket, plan, user.id, input.message, inReview);
      return;
    }

    case "set_priority": {
      need(can.setPriority, "Priority can be changed by the Project Manager until the assignee starts work");
      if (input.priority === ticket.priority) return;
      // Only `priority` changes. The ticket keeps its manual queue position.
      await move(ticket, [from], { priority: input.priority });
      await log(base, user.id, "PRIORITY_CHANGED", { from: ticket.priority, to: input.priority, message: input.message });
      await note({
        recipients: [ticket.createdBy, ticket.assignee],
        title: "Ticket priority changed",
        message: `${ticket.ticketNumber} · ${humanize(ticket.priority)} → ${humanize(input.priority)}`,
      });
      return;
    }

    case "set_dates": {
      need(can.setDates);
      const set: Record<string, unknown> = {};
      if (input.estimatedHours !== undefined) set.estimatedHours = input.estimatedHours;
      if (input.expectedCompletion !== undefined) set.expectedCompletion = toDate(input.expectedCompletion);
      if (!Object.keys(set).length) return;
      await move(ticket, [from], set);
      await log(base, user.id, "DATES_UPDATED", {
        from: iso(ticket.expectedCompletion)?.slice(0, 10) ?? null,
        to: input.expectedCompletion ?? null,
        message: input.estimatedHours != null ? `Estimate ${input.estimatedHours}h` : "",
      });
      await note({ recipients: [ticket.createdBy, ticket.assignee], title: "Expected completion updated", message: `${ticket.ticketNumber} · ${input.expectedCompletion ?? "no date"}` });
      return;
    }

    case "start": {
      need(can.start);
      await claimTimer(ticket, user.id, input.pausePrevious);
      await move(ticket, ["ASSIGNED"], { status: "IN_PROGRESS", startedAt: ticket.startedAt ?? new Date(), ...timerStart(user.id) });
      await log(base, user.id, "STARTED", { fromStatus: from, toStatus: "IN_PROGRESS" });
      await note({ recipients: [ticket.createdBy], title: "Work started", message: `${ticket.ticketNumber} · ${ticket.title}` });
      return;
    }

    case "hold": {
      need(can.hold);
      const tm = timerStop(ticket, "AUTO", `On hold: ${input.message}`);
      await move(ticket, ["IN_PROGRESS"], { status: "ON_HOLD", ...tm.set }, tm.push.timeLog ? tm.push : undefined);
      await log(base, user.id, "ON_HOLD", { fromStatus: from, toStatus: "ON_HOLD", message: input.message });
      await note({ recipients: [ticket.createdBy, ticket.assignee], title: "Ticket put on hold", message: `${ticket.ticketNumber}: ${input.message}` });
      return;
    }

    case "resume": {
      need(can.resume);
      if (ticket.assignee && s(ticket.assignee) === user.id) await claimTimer(ticket, user.id, input.pausePrevious);
      await move(ticket, ["ON_HOLD"], { status: "IN_PROGRESS", ...(ticket.assignee && s(ticket.assignee) === user.id ? timerStart(user.id) : {}) });
      await log(base, user.id, "RESUMED", { fromStatus: from, toStatus: "IN_PROGRESS" });
      return;
    }

    case "start_timer": {
      need(can.trackTime, "Only the assignee can track time while the ticket is In Progress");
      if (ticket.timer?.running) return;
      await claimTimer(ticket, user.id, input.pausePrevious);
      await move(ticket, ["IN_PROGRESS"], timerStart(user.id));
      return;
    }

    case "pause_timer": {
      need(can.trackTime, "Only the assignee can track time while the ticket is In Progress");
      const tm = timerStop(ticket, "PAUSED", input.message);
      if (!tm.push.timeLog) return;
      await move(ticket, ["IN_PROGRESS"], tm.set, tm.push);
      return;
    }

    case "record_progress": {
      need(can.recordProgress, "Only the assignee can record progress while the ticket is In Progress");
      const { next, errors, changes } = applyProgress(recordsOf(ticket), input.items);
      assertDeliverables(errors);
      if (!changes.length) return;
      await move(ticket, ["IN_PROGRESS"], { deliverables: toStored(next) });
      await log(base, user.id, "DELIVERABLE_PROGRESS", { message: changes.join("\n") });
      return;
    }

    case "change_deliverables": {
      need(can.changeDeliverables, "Only the ticket's Project Manager can change the requested deliverables");
      const current = recordsOf(ticket);
      const { next, errors } = mergeDeliverables(current, input.deliverables);
      assertDeliverables(errors);
      const changes = describeDeliverableChanges(current, next);
      if (!changes.length) throw unprocessable("Nothing was changed");
      await move(ticket, [from], { deliverables: toStored(next) });
      await log(base, user.id, "DELIVERABLES_CHANGED", {
        message: `${input.message}\n${changes.join("\n")}`,
        changes: { deliverables: { from: deliverablesSnapshot(current), to: deliverablesSnapshot(next) } },
      });
      await note({
        recipients: [ticket.createdBy, ticket.assignee, ticket.assignedReviewer],
        title: "Requested deliverables changed",
        message: `${ticket.ticketNumber}: ${changes.join("; ").slice(0, 200)}`,
      });
      return;
    }

    case "submit_work": {
      need(can.submitWork);
      assertDeliverablesDone(ticket, "Record your progress before submitting");
      const tm = timerStop(ticket, "AUTO", "Submitted for review");
      await move(ticket, ["IN_PROGRESS"], { status: "SUBMITTED_FOR_REVIEW", reviewStatus: "PENDING", submittedAt: new Date(), submissionNote: input.message, ...tm.set }, tm.push.timeLog ? tm.push : undefined);
      await log(base, user.id, "WORK_SUBMITTED", { fromStatus: from, toStatus: "SUBMITTED_FOR_REVIEW", message: input.message });
      // Routed to the assigned reviewer; only legacy tickets without one go back to the requester.
      await note({ recipients: [reviewRoutedTo(ticket).id], title: "Work submitted for your review", message: `${ticket.ticketNumber} · ${ticket.title}` });
      return;
    }

    case "accept": {
      need(can.review, "Only the assigned reviewer can approve this work");
      // Approval is the verification: it can only happen once every requested quantity is reached.
      assertDeliverablesDone(ticket, "Not every deliverable is complete, so request changes instead");
      const now = new Date();
      const verified = ticket.deliverables?.length ? { deliverables: toStored(verifyAll(recordsOf(ticket))) } : {};
      await move(
        ticket,
        ["SUBMITTED_FOR_REVIEW"],
        { status: "COMPLETED", completedAt: now, reviewStatus: "APPROVED", reviewDecidedBy: oid(user.id), reviewDecidedAt: now, ...verified },
        { reviewComments: { author: oid(user.id), decision: "APPROVED", comment: input.message, createdAt: now } }
      );
      await log(base, user.id, "COMPLETED", { fromStatus: from, toStatus: "COMPLETED", message: input.message });
      // One notification covers both "review approved" and "ticket completed", so nobody is told twice.
      await note({ recipients: [ticket.assignee, ticket.createdBy, ...(await triageWho())], title: "Review approved – ticket completed", message: `${ticket.ticketNumber} · ${ticket.title}` });
      return;
    }

    case "request_changes": {
      need(can.review, "Only the assigned reviewer can send this work back");
      // Optional partial sign-off ("1 of 2 videos is fine"), so verified progress is visible before the end.
      const verification = applyVerification(recordsOf(ticket), input.verified);
      assertDeliverables(verification.errors);
      await move(
        ticket,
        ["SUBMITTED_FOR_REVIEW"],
        {
          status: "IN_PROGRESS",
          reviewStatus: "CHANGES_REQUESTED",
          submittedAt: null,
          reviewDecidedBy: oid(user.id),
          reviewDecidedAt: new Date(),
          ...(verification.changes.length ? { deliverables: toStored(verification.next) } : {}),
        },
        { reviewComments: { author: oid(user.id), decision: "CHANGES_REQUESTED", comment: input.message, createdAt: new Date() } }
      );
      await log(base, user.id, "CHANGES_REQUESTED", {
        fromStatus: from,
        toStatus: "IN_PROGRESS",
        message: verification.changes.length ? `${input.message}\nVerified: ${verification.changes.join("; ")}` : input.message,
      });
      await note({ recipients: [ticket.assignee], title: "Changes requested", message: `${ticket.ticketNumber}: ${input.message}` });
      return;
    }

    case "cancel": {
      need(can.cancel);
      const tm = timerStop(ticket, "AUTO", "Ticket cancelled");
      await move(ticket, [from], { status: "CANCELLED", decisionReason: input.message, ...tm.set }, tm.push.timeLog ? tm.push : undefined);
      await log(base, user.id, "CANCELLED", { fromStatus: from, toStatus: "CANCELLED", message: input.message });
      await note({ recipients: [ticket.createdBy, ticket.assignee, ...(from === "PENDING_APPROVAL" || from === "UNDER_REVIEW" ? await triageWho() : [])], title: "Ticket cancelled", message: `${ticket.ticketNumber} · ${ticket.title}` });
      return;
    }

    case "escalate": {
      need(can.escalate, "Only a Department Head can escalate");
      await log(base, user.id, "ESCALATED", { message: input.message });
      await note({ recipients: await triageWho(), title: "Ticket escalated by a Department Head", message: `${ticket.ticketNumber}: ${input.message}` });
      return;
    }

    case "comment": {
      need(can.comment);
      await log(base, user.id, "COMMENTED", { message: input.message });
      const others = [ticket.createdBy, ticket.assignee, ...(rights.requester || rights.assignee ? await triageWho() : [])];
      await note({ recipients: others, title: "New comment on a ticket", message: `${ticket.ticketNumber}: ${input.message.slice(0, 140)}` });
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Lists & summary                                                     */
/* ------------------------------------------------------------------ */

async function scopeFilter(user: CurrentUser, query: ListQuery): Promise<Filter> {
  const me = oid(user.id);
  switch (query.scope) {
    case "raised":
      return { createdBy: me };
    case "assigned":
      return { assignee: me, status: { $ne: "DRAFT" } };
    case "employee": {
      // A manager looking at one employee's queue. Project Managers only see the tickets they triage.
      if (!hasPermission(user.role, "ticket:manage")) throw forbidden();
      if (!/^[a-f\d]{24}$/i.test(query.assignee)) throw unprocessable("Pick an employee", { assignee: "Required" });
      return { $and: [{ assignee: oid(query.assignee), status: { $ne: "DRAFT" } }, await ticketTriageFilter(user)] };
    }
    case "queue": {
      if (!hasPermission(user.role, "ticket:manage")) throw forbidden();
      return { ...(await ticketTriageFilter(user)), status: { $ne: "DRAFT" } };
    }
    case "department": {
      const ids = await headedTicketDepartmentIds(user);
      if (user.role !== "SUPER_ADMIN" && !ids.length) throw forbidden("You don't head a department");
      return { ...(user.role === "SUPER_ADMIN" ? {} : { $or: [{ targetDepartment: { $in: ids } }, { additionalDepartments: { $in: ids } }, { requestingDepartment: { $in: ids } }] }), status: { $ne: "DRAFT" } };
    }
    case "all":
      if (user.role !== "SUPER_ADMIN") throw forbidden();
      return { status: { $ne: "DRAFT" } };
  }
}

const PRIORITY_RANK = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

export async function listTickets(user: CurrentUser, query: ListQuery): Promise<Paginated<TicketDTO>> {
  void sweepDeadlines();
  const and: Filter[] = [await scopeFilter(user, query)];
  // Manager order only exists inside one employee's open queue; elsewhere fall back to a sensible default.
  const queueOwner = query.scope === "assigned" ? user.id : query.scope === "employee" ? query.assignee : null;
  const manual = query.sort === "manager" && !!queueOwner && query.view !== "closed";
  const sortKey = query.sort === "manager" && !manual ? (query.view === "closed" ? "-updatedAt" : "-createdAt") : query.sort;
  if (manual) await ensureRanked(queueOwner!);
  if (query.view) and.push({ status: query.view === "closed" ? { $in: TICKET_CLOSED_STATUSES } : { $nin: TICKET_CLOSED_STATUSES } });
  if (query.status) and.push({ status: query.status });
  if (query.priority) and.push({ priority: query.priority });
  if (/^[a-f\d]{24}$/i.test(query.department)) and.push({ $or: [{ targetDepartment: oid(query.department) }, { additionalDepartments: oid(query.department) }, { requestingDepartment: oid(query.department) }] });
  if (query.overdue) and.push({ dueDate: { $lt: new Date() }, status: { $nin: [...TICKET_CLOSED_STATUSES, "DRAFT"] } });
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    and.push({ $or: [{ title: rx }, { ticketNumber: rx }] });
  }
  const filter = { $and: and };
  const total = await Ticket.countDocuments(filter);

  let rows: any[];
  if (manual) {
    rows = await POPULATE(Ticket.find(filter).sort({ priorityRank: 1, _id: 1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize)).lean();
  } else if (sortKey === "priority") {
    const all = await POPULATE(Ticket.find(filter).sort({ createdAt: -1 })).lean();
    all.sort((a: any, b: any) => PRIORITY_RANK[a.priority as keyof typeof PRIORITY_RANK] - PRIORITY_RANK[b.priority as keyof typeof PRIORITY_RANK]);
    rows = all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  } else {
    const dir = sortKey.startsWith("-") ? -1 : 1;
    const field = sortKey.replace(/^-/, "");
    rows = await POPULATE(Ticket.find(filter).sort({ [field]: dir, _id: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize)).lean();
  }
  const positions = queueOwner && query.view !== "closed" ? await queuePositions(queueOwner) : null;
  const mayReorder = positions ? await reorderAuthority(user) : null;
  const items = rows.map((r) => {
    const dto = toDTO(r);
    if (!positions) return dto;
    const position = positions.get(dto.id) ?? null;
    return { ...dto, queuePosition: position, queueSize: positions.size, canReorder: position !== null && !!mayReorder?.(r) };
  });
  return paginate(items, total, query.page, query.pageSize);
}

export async function ticketSummary(user: CurrentUser): Promise<TicketSummaryDTO> {
  void sweepDeadlines();
  const me = oid(user.id);
  const count = (f: Filter) => Ticket.countDocuments(f);
  const [raised, assigned] = await Promise.all([
    Promise.all([
      count({ createdBy: me }),
      count({ createdBy: me, status: "DRAFT" }),
      count({ createdBy: me, status: { $in: ["PENDING_APPROVAL", "UNDER_REVIEW", "APPROVED", "UNASSIGNED", "ASSIGNED"] } }),
      count({ createdBy: me, status: "PENDING_CLARIFICATION" }),
      count({ createdBy: me, status: { $in: ["IN_PROGRESS", "ON_HOLD"] } }),
      count({ createdBy: me, status: "SUBMITTED_FOR_REVIEW" }),
      count({ createdBy: me, status: "COMPLETED" }),
      count({ createdBy: me, status: { $in: TICKET_CLOSED_STATUSES } }),
    ]),
    Promise.all([
      count({ assignee: me }),
      count({ assignee: me, status: "ASSIGNED" }),
      count({ assignee: me, status: "IN_PROGRESS" }),
      count({ assignee: me, status: "ON_HOLD" }),
      count({ assignee: me, status: "SUBMITTED_FOR_REVIEW" }),
      count({ assignee: me, status: "COMPLETED" }),
      count({ assignee: me, status: { $in: TICKET_CLOSED_STATUSES } }),
    ]),
  ]);

  let queue: TicketSummaryDTO["queue"] = null;
  if (hasPermission(user.role, "ticket:manage")) {
    const f = await ticketTriageFilter(user);
    const [pa, ur, cl, un, od] = await Promise.all([
      count({ ...f, status: "PENDING_APPROVAL" }),
      count({ ...f, status: "UNDER_REVIEW" }),
      count({ ...f, status: "PENDING_CLARIFICATION" }),
      count({ ...f, status: "UNASSIGNED" }),
      count({ ...f, dueDate: { $lt: new Date() }, status: { $nin: [...TICKET_CLOSED_STATUSES, "DRAFT"] } }),
    ]);
    queue = { pendingApproval: pa, underReview: ur, clarification: cl, unassigned: un, overdue: od };
  }

  const headed = user.role === "SUPER_ADMIN" ? null : await headedTicketDepartmentIds(user);
  let department: TicketSummaryDTO["department"] = null;
  if (headed === null || headed.length) {
    const f = headed ? { $or: [{ targetDepartment: { $in: headed } }, { additionalDepartments: { $in: headed } }, { requestingDepartment: { $in: headed } }] } : {};
    const open = { status: { $nin: [...TICKET_CLOSED_STATUSES, "DRAFT"] } };
    const [o, od] = await Promise.all([count({ ...f, ...open }), count({ ...f, ...open, dueDate: { $lt: new Date() } })]);
    department = { open: o, overdue: od };
  }

  return {
    raised: { total: raised[0], draft: raised[1], pending: raised[2], clarification: raised[3], inProgress: raised[4], review: raised[5], completed: raised[6], closed: raised[7] },
    assigned: { total: assigned[0], pending: assigned[1], inProgress: assigned[2], onHold: assigned[3], review: assigned[4], completed: assigned[5], closed: assigned[6] },
    queue,
    department,
  };
}

/* ------------------------------------------------------------------ */
/* Deadline reminders                                                  */
/* ------------------------------------------------------------------ */

let lastSweep = 0;
/**
 * Sends "due soon" (within 24h) and "overdue" reminders once per ticket. There is no scheduler in this
 * app, so it runs opportunistically (at most every 10 minutes) when tickets are listed.
 */
export async function sweepDeadlines(): Promise<void> {
  if (Date.now() - lastSweep < 10 * 60_000) return;
  lastSweep = Date.now();
  try {
    const active = { status: { $in: TICKET_ACTIVE_WORK_STATUSES }, assignee: { $ne: null } };
    const soon = await Ticket.find({ ...active, dueSoonNotified: false, dueDate: { $gte: new Date(), $lte: new Date(Date.now() + 86_400_000) } }).limit(200);
    for (const t of soon) {
      await Ticket.updateOne({ _id: t._id }, { $set: { dueSoonNotified: true } });
      await notify({ recipients: [t.assignee], type: "TICKET", title: "Ticket due within 24 hours", message: `${t.ticketNumber} · ${t.title}`, link: link(t._id), entityType: "Ticket", entityId: t._id });
    }
    const late = await Ticket.find({ ...active, overdueNotified: false, dueDate: { $lt: new Date() } }).limit(200);
    for (const t of late) {
      await Ticket.updateOne({ _id: t._id }, { $set: { overdueNotified: true } });
      const pms = await triageRecipients(t.targetDepartment, t.projectManager);
      await notify({ recipients: [t.assignee, t.createdBy, ...pms], type: "TICKET", title: "Ticket overdue", message: `${t.ticketNumber} · ${t.title}`, link: link(t._id), entityType: "Ticket", entityId: t._id });
    }
  } catch (err) {
    console.error("[tickets] deadline sweep failed", err);
  }
}


/**
 * Names of a department's assignable people, for the requester's optional "suggested employee".
 * Deliberately excludes workload and contact details: it is only a hint for the Project Manager.
 */
export async function departmentPeople(departmentId: string) {
  const people = await eligiblePeople(departmentId, "name email employeeId designation");
  return people.map((p) => ({ id: p._id.toString(), name: p.name, email: p.email, employeeId: p.employeeId, subtitle: p.designation ?? "" }));
}

/**
 * Everyone the viewer manages, with how much they're carrying right now (tickets + project tasks,
 * estimated hours against capacity). Project Managers see their departments; Super Admins see all.
 */
export async function teamWorkload(user: CurrentUser): Promise<TeamWorkloadDTO[]> {
  if (!hasPermission(user.role, "ticket:manage")) throw forbidden();
  const ids = await triageDepartmentIds(user);
  const departments = await Department.find({ status: "ACTIVE", ...(ids ? { _id: { $in: ids } } : {}) }).select("name").sort({ name: 1 }).lean();
  const perDepartment = await Promise.all(departments.map(async (d) => (await departmentWorkload(d._id.toString())).map((r) => ({ ...r, department: d.name }))));
  const seen = new Set<string>();
  return perDepartment.flat().filter((r) => !seen.has(r.id) && !!seen.add(r.id));
}
