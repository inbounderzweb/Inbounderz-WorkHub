import type { TaskStatus } from "./constants";

/**
 * Task status state machine — the single source of truth for which status
 * changes are allowed. Used by the server (enforcement) and the UI (to only
 * offer valid actions). Review decisions (approve / request changes) are
 * separate actions, see `canReview`.
 */

/** Transitions available to the accountable owner. */
const OWNER: Record<TaskStatus, TaskStatus[]> = {
  BACKLOG: ["TODO"],
  TODO: ["IN_PROGRESS", "ON_HOLD"],
  IN_PROGRESS: ["TODO", "ON_HOLD", "IN_REVIEW"],
  ON_HOLD: ["TODO", "IN_PROGRESS"],
  IN_REVIEW: ["IN_PROGRESS"], // withdraw a submission
  CHANGES_REQUESTED: ["IN_PROGRESS", "IN_REVIEW"],
  COMPLETED: [],
  CANCELLED: [],
};

/** Transitions available to people who manage the task (PM, dept head, team leader, admin). */
const MANAGER: Record<TaskStatus, TaskStatus[]> = {
  BACKLOG: ["TODO", "IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  TODO: ["BACKLOG", "IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["BACKLOG", "TODO", "ON_HOLD", "IN_REVIEW", "CANCELLED"],
  ON_HOLD: ["BACKLOG", "TODO", "IN_PROGRESS", "CANCELLED"],
  IN_REVIEW: ["IN_PROGRESS", "CANCELLED"],
  CHANGES_REQUESTED: ["IN_PROGRESS", "IN_REVIEW", "ON_HOLD", "CANCELLED"],
  COMPLETED: ["IN_PROGRESS"], // reopen
  CANCELLED: ["TODO"], // restore
};

export type WorkflowContext = {
  status: TaskStatus;
  approvalRequired: boolean;
  isOwner: boolean;
  canManage: boolean;
  canReview: boolean;
};

/** Statuses the actor may move the task to via a plain status change. */
export function allowedTransitions(ctx: WorkflowContext): TaskStatus[] {
  const next = new Set<TaskStatus>();
  if (ctx.isOwner) OWNER[ctx.status].forEach((s) => next.add(s));
  if (ctx.canManage) MANAGER[ctx.status].forEach((s) => next.add(s));

  // Without approval, the owner/manager may complete directly from active work.
  if (!ctx.approvalRequired && (ctx.isOwner || ctx.canManage)) {
    if (["IN_PROGRESS", "IN_REVIEW", "CHANGES_REQUESTED"].includes(ctx.status)) next.add("COMPLETED");
  }
  // With approval, completion only happens through a review decision.
  if (ctx.approvalRequired) next.delete("COMPLETED");
  // Changes Requested is a review outcome, never a plain status change.
  next.delete("CHANGES_REQUESTED");
  next.delete(ctx.status);
  return [...next];
}

/** Whether the actor can approve / request changes right now. */
export function reviewAvailable(ctx: WorkflowContext): boolean {
  return ctx.status === "IN_REVIEW" && ctx.canReview && ctx.approvalRequired;
}
