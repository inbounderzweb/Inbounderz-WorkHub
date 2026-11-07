import type { TaskStatus, TicketStatus } from "./constants";

/**
 * Internal ticket state machine — the single source of truth for which
 * workflow actions are allowed. Used by the server (enforcement) and the UI
 * (to only offer valid actions).
 *
 * The ticket owns the status. Its linked task (if any) never changes status on
 * its own: `linkedTaskStatus` derives it from the ticket, so the two can't drift.
 */

export const TICKET_ACTIONS = [
  "START_REVIEW",
  "ASSIGN",
  "REASSIGN",
  "REJECT",
  "REQUEST_INFO",
  "PROVIDE_INFO",
  "START_WORK",
  "RESOLVE",
  "ACCEPT",
  "REQUEST_CHANGES",
  "REOPEN",
] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

export type TicketWorkflowContext = {
  status: TicketStatus;
  /** Raised the ticket. */
  isRequester: boolean;
  /** Current assignee. */
  isAssignee: boolean;
  /** Project Manager in scope, or Super Admin. */
  canManage: boolean;
  hasAssignee: boolean;
  /** Requester may still reopen a closed ticket. */
  withinReopenWindow: boolean;
};

type Rule = { from: TicketStatus[]; allowed: (c: TicketWorkflowContext) => boolean };

const RULES: Record<TicketAction, Rule> = {
  START_REVIEW: { from: ["NEW"], allowed: (c) => c.canManage },
  ASSIGN: { from: ["NEW", "UNDER_REVIEW"], allowed: (c) => c.canManage && !c.hasAssignee },
  REASSIGN: {
    from: ["ASSIGNED", "IN_PROGRESS", "WAITING_FOR_INFO", "CHANGES_REQUESTED"],
    allowed: (c) => c.canManage && c.hasAssignee,
  },
  REJECT: { from: ["NEW", "UNDER_REVIEW", "WAITING_FOR_INFO", "ASSIGNED"], allowed: (c) => c.canManage },
  REQUEST_INFO: {
    from: ["NEW", "UNDER_REVIEW", "ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"],
    allowed: (c) => (c.canManage && !c.isRequester) || (c.isAssignee && ["ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(c.status)),
  },
  // A manager may answer on the requester's behalf (e.g. the info came by another route).
  PROVIDE_INFO: { from: ["WAITING_FOR_INFO"], allowed: (c) => c.isRequester || c.canManage },
  START_WORK: { from: ["ASSIGNED", "CHANGES_REQUESTED"], allowed: (c) => c.isAssignee },
  RESOLVE: { from: ["IN_PROGRESS", "CHANGES_REQUESTED"], allowed: (c) => c.isAssignee },
  // The requester reviews the delivered work; managers may intervene.
  ACCEPT: { from: ["RESOLVED"], allowed: (c) => (c.isRequester || c.canManage) && !c.isAssignee },
  REQUEST_CHANGES: { from: ["RESOLVED"], allowed: (c) => (c.isRequester || c.canManage) && !c.isAssignee },
  REOPEN: {
    from: ["CLOSED", "REJECTED"],
    allowed: (c) => c.canManage || (c.status === "CLOSED" && c.isRequester && c.withinReopenWindow),
  },
};

export function availableActions(ctx: TicketWorkflowContext): TicketAction[] {
  return TICKET_ACTIONS.filter((a) => RULES[a].from.includes(ctx.status) && RULES[a].allowed(ctx));
}

/** Whether the action exists for this status at all (regardless of who is asking). */
export function actionValidFrom(action: TicketAction, status: TicketStatus): boolean {
  return RULES[action].from.includes(status);
}

export function canPerform(ctx: TicketWorkflowContext, action: TicketAction): boolean {
  return RULES[action].from.includes(ctx.status) && RULES[action].allowed(ctx);
}

/**
 * Status after an action. PROVIDE_INFO returns to wherever the ticket was when
 * the information was requested (`resumeStatus`).
 */
export function nextStatus(action: TicketAction, from: TicketStatus, resumeStatus?: TicketStatus | null): TicketStatus {
  switch (action) {
    case "START_REVIEW":
      return "UNDER_REVIEW";
    case "ASSIGN":
      return "ASSIGNED";
    case "REASSIGN":
      // The new assignee hasn't started yet.
      return from === "IN_PROGRESS" ? "ASSIGNED" : from;
    case "REJECT":
      return "REJECTED";
    case "REQUEST_INFO":
      return "WAITING_FOR_INFO";
    case "PROVIDE_INFO":
      return resumeStatus ?? "UNDER_REVIEW";
    case "START_WORK":
      return "IN_PROGRESS";
    case "RESOLVE":
      return "RESOLVED";
    case "ACCEPT":
      return "CLOSED";
    case "REQUEST_CHANGES":
      return "CHANGES_REQUESTED";
    case "REOPEN":
      return from === "REJECTED" ? "UNDER_REVIEW" : "CHANGES_REQUESTED";
  }
}

/** The linked task's status for a given ticket state (single source of truth). */
export function linkedTaskStatus(status: TicketStatus, hasAssignee: boolean): TaskStatus {
  switch (status) {
    case "ASSIGNED":
      return "TODO";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "WAITING_FOR_INFO":
      return hasAssignee ? "ON_HOLD" : "CANCELLED";
    case "RESOLVED":
      return "IN_REVIEW";
    case "CHANGES_REQUESTED":
      return "CHANGES_REQUESTED";
    case "CLOSED":
      return "COMPLETED";
    default:
      // NEW / UNDER_REVIEW (only after a rejected ticket is reopened) / REJECTED
      return "CANCELLED";
  }
}

/**
 * Task-board moves an assignee may make on a linked task from My Tasks.
 * Everything else (submitting work, asking for info) happens on the ticket.
 */
export function linkedTaskMoves(ctx: TicketWorkflowContext): TaskStatus[] {
  return canPerform(ctx, "START_WORK") ? ["IN_PROGRESS"] : [];
}

export const TICKET_ACTION_LABELS: Record<TicketAction, string> = {
  START_REVIEW: "Start review",
  ASSIGN: "Assign",
  REASSIGN: "Reassign",
  REJECT: "Reject",
  REQUEST_INFO: "Request information",
  PROVIDE_INFO: "Provide information",
  START_WORK: "Start work",
  RESOLVE: "Submit as resolved",
  ACCEPT: "Confirm completion",
  REQUEST_CHANGES: "Request changes",
  REOPEN: "Reopen",
};
