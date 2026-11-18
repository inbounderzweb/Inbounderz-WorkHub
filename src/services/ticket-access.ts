import "server-only";
import type { Types } from "mongoose";
import type { CurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/permissions";
import { TICKET_CLOSED_STATUSES, type TicketStatus } from "@/lib/constants";
import { canReviewDeliverable, REVIEWER_CHANGE_STATUSES } from "@/lib/ticket-review";
import { Department, User } from "@/models";
import { getRoleByKey } from "@/lib/roles";
import { oid, type Filter } from "./scope";

/* eslint-disable @typescript-eslint/no-explicit-any */

const s = (v: any): string => (v ? String(v._id ?? v) : "");

export type TicketLike = {
  status: string;
  createdBy: any;
  assignee?: any;
  targetDepartment: any;
  additionalDepartments?: any[];
  requestingDepartment?: any;
  projectManager?: any;
  reviewedBy?: any;
  assignedReviewer?: any;
  reviewStatus?: string | null;
};

export type TicketRights = {
  admin: boolean;
  requester: boolean;
  assignee: boolean;
  /** Project Manager of the target department (or Super Admin). The only role that approves and assigns. */
  triager: boolean;
  head: boolean;
  /** Head of the TARGET department: receives approved tickets the Project Manager left unassigned. */
  targetHead: boolean;
  /** The reviewer chosen by the Project Manager for this ticket. */
  assignedReviewer: boolean;
  /** May review the deliverable: the assigned reviewer, or (legacy ticket with none) the requester, or an admin. */
  reviewer: boolean;
  view: boolean;
};

/** Who the viewer is in relation to this ticket. Server-side source of truth. */
export async function ticketRights(user: CurrentUser, t: TicketLike): Promise<TicketRights> {
  const admin = user.role === "SUPER_ADMIN";
  const requester = s(t.createdBy) === user.id;
  const assignee = !!t.assignee && s(t.assignee) === user.id;
  const depts = await Department.find({ _id: { $in: [t.targetDepartment, t.requestingDepartment, ...(t.additionalDepartments ?? [])].filter(Boolean) } })
    .select("head projectManagers")
    .lean();
  const target = depts.find((d) => d._id.toString() === s(t.targetDepartment));
  const triager =
    admin ||
    (hasPermission(user.role, "ticket:manage") && (t.projectManager
      ? s(t.projectManager) === user.id
      : !!target?.projectManagers?.some((p) => p.toString() === user.id)));
  const head = depts.some((d) => d.head?.toString() === user.id);
  const targetHead = target?.head?.toString() === user.id;
  const draft = t.status === "DRAFT";
  const assignedReviewer = !!t.assignedReviewer && s(t.assignedReviewer) === user.id;
  const reviewer = canReviewDeliverable({ userId: user.id, isAdmin: admin, ticket: { status: "SUBMITTED_FOR_REVIEW", createdBy: t.createdBy, assignee: t.assignee, assignedReviewer: t.assignedReviewer } });
  const view = draft ? requester || admin : requester || assignee || triager || head || admin || assignedReviewer;
  return { admin, requester, assignee, triager, head, targetHead, assignedReviewer, reviewer, view };
}

/** Departments whose tickets the user triages. `null` = every department (Super Admin). */
/** Target department first, then any additional departments (as strings). */
export function ticketDepartments(t: { targetDepartment: any; additionalDepartments?: any[] }): string[] {
  return [...new Set([s(t.targetDepartment), ...(t.additionalDepartments ?? []).map(s)].filter(Boolean))];
}

export async function triageDepartmentIds(user: CurrentUser): Promise<Types.ObjectId[] | null> {
  if (user.role === "SUPER_ADMIN") return null;
  if (!hasPermission(user.role, "ticket:manage")) return [];
  const rows = await Department.find({ projectManagers: oid(user.id) }).select("_id").lean();
  return rows.map((r) => r._id);
}

export async function headedTicketDepartmentIds(user: CurrentUser): Promise<Types.ObjectId[]> {
  const rows = await Department.find({ head: oid(user.id) }).select("_id").lean();
  return rows.map((r) => r._id);
}

/** Directly routed tickets plus department tickets that have no selected reviewer. */
export async function ticketTriageFilter(user: CurrentUser): Promise<Filter> {
  if (user.role === "SUPER_ADMIN") return {};
  if (!hasPermission(user.role, "ticket:manage")) return { _id: { $in: [] } };
  const departments = await triageDepartmentIds(user);
  return { $or: [
    { projectManager: oid(user.id) },
    { projectManager: null, targetDepartment: { $in: departments ?? [] } },
  ] };
}

/** Selected active reviewer, otherwise department routing; Super Admins handle unavailable reviewers. */
export async function triageRecipients(targetDepartment: any, projectManager?: any): Promise<string[]> {
  if (projectManager) {
    const pmRole = await getRoleByKey("PROJECT_MANAGER");
    const selected = await User.findOne({ _id: oid(s(projectManager)), role: oid(pmRole.id), status: "ACTIVE" }).select("_id").lean();
    if (selected) return [selected._id.toString()];
  }
  const d = await Department.findById(targetDepartment).select("projectManagers").lean();
  const pms = projectManager ? [] : (d?.projectManagers ?? []).map(String);
  if (pms.length) return pms;
  const role = await getRoleByKey("SUPER_ADMIN");
  if (!role) return [];
  const admins = await User.find({ role: oid(role.id), status: "ACTIVE" }).select("_id").lean();
  return admins.map((a) => a._id.toString());
}

const IN = (status: string, list: TicketStatus[]) => list.includes(status as TicketStatus);

/** What the viewer may do right now. The action endpoint re-checks every flag. */
export function ticketCan(r: TicketRights, t: TicketLike) {
  const st = t.status;
  const open = !TICKET_CLOSED_STATUSES.includes(st as TicketStatus);
  const notDraft = st !== "DRAFT";
  const triageable = IN(st, ["PENDING_APPROVAL", "UNDER_REVIEW"]);
  const working = IN(st, ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"]);
  // Separation of duties: a Project Manager can't approve a ticket they raised themselves.
  const ownTicket = r.requester && !r.admin;
  return {
    edit: r.requester && IN(st, ["DRAFT", "PENDING_APPROVAL", "PENDING_CLARIFICATION"]),
    changeProjectManager: r.requester && IN(st, ["DRAFT", "PENDING_APPROVAL", "PENDING_CLARIFICATION"]),
    submit: r.requester && st === "DRAFT",
    triage: r.triager && !ownTicket && triageable,
    approve: r.triager && !ownTicket && triageable,
    // An approved ticket with no employee picked goes to the Department Head, who may assign it too.
    assign: ((r.triager && !ownTicket) || (r.targetHead && !r.requester)) && st === "UNASSIGNED",
    reassign: r.triager && working,
    setDates: r.triager && open && notDraft,
    // Re-prioritise only until work starts; after that the assignee is already executing against it.
    setPriority: r.triager && !ownTicket && IN(st, ["PENDING_APPROVAL", "UNDER_REVIEW", "PENDING_CLARIFICATION", "UNASSIGNED", "ASSIGNED"]),
    respond: r.requester && st === "PENDING_CLARIFICATION",
    start: r.assignee && st === "ASSIGNED",
    hold: (r.assignee || r.triager) && st === "IN_PROGRESS",
    resume: (r.assignee || r.triager) && st === "ON_HOLD",
    submitWork: r.assignee && st === "IN_PROGRESS",
    trackTime: r.assignee && st === "IN_PROGRESS",
    // Only the person doing the work reports progress, and only while working on it.
    recordProgress: r.assignee && st === "IN_PROGRESS",
    // The requester edits deliverables through `edit` until approval. Any change after that (or during
    // triage) is an authorised requirement change by the Project Manager, with a reason on record.
    changeDeliverables: ((r.triager && !ownTicket) || r.admin) && open && notDraft,
    // Routed to the assigned reviewer (the requester only on legacy tickets without one). Never the assignee.
    review: st === "SUBMITTED_FOR_REVIEW" && r.reviewer,
    // The Project Manager can name or change the reviewer until the ticket closes. During a review it needs a reason.
    setReviewer: ((r.triager && !ownTicket) || r.admin) && REVIEWER_CHANGE_STATUSES.includes(st),
    cancel: (r.requester || (r.triager && !ownTicket)) && open,
    escalate: r.head && !r.triager && open && notDraft,
    comment: r.view && notDraft && open,
    upload: (r.requester || r.assignee || r.triager || r.assignedReviewer) && open,
  };
}
export type TicketCan = ReturnType<typeof ticketCan>;
