/**
 * Review-routing rules for tickets. Pure functions with no I/O so the server (enforcement), the UI
 * (what to offer) and the tests all share one definition.
 *
 * Routing: the Project Manager can name an independent reviewer. Tickets without one keep the legacy
 * behaviour: the person who raised the ticket reviews the deliverable.
 */
import { REVIEW_OVERDUE_HOURS, type ReviewStatus } from "./constants";

type Id = { toString(): string; _id?: { toString(): string } } | null | undefined;
/** Accepts raw ids and populated documents alike. */
const sid = (v: Id): string => (v ? (v._id ?? v).toString() : "");

export type ReviewTicketLike = {
  status: string;
  createdBy: Id;
  assignee?: Id;
  assignedReviewer?: Id;
  reviewStatus?: string | null;
  submittedAt?: Date | string | null;
};

/** Who the submitted work is routed to: the assigned reviewer, otherwise (legacy) the requester. */
export function reviewRoutedTo(t: Pick<ReviewTicketLike, "createdBy" | "assignedReviewer">): { id: string; legacy: boolean } {
  return t.assignedReviewer ? { id: sid(t.assignedReviewer), legacy: false } : { id: sid(t.createdBy), legacy: true };
}

/**
 * May this user approve / reject the submitted work right now?
 *  - Only while the work is waiting for review.
 *  - Only the person it is routed to, or a Super Admin (override).
 *  - Never the person who did the work, unless they are a Super Admin.
 */
export function canReviewDeliverable(i: { userId: string; isAdmin: boolean; ticket: ReviewTicketLike }): boolean {
  const { ticket: t } = i;
  if (t.status !== "SUBMITTED_FOR_REVIEW") return false;
  if (i.isAdmin) return true;
  if (sid(t.assignee) === i.userId) return false;
  return reviewRoutedTo(t).id === i.userId;
}

/** Why a person can't be the reviewer, or null when fine. The reviewer must differ from the assignee. */
export function reviewerProblem(reviewerId: string, assigneeId: Id): string | null {
  if (assigneeId && sid(assigneeId) === reviewerId) return "The reviewer can't be the person doing the work";
  return null;
}

/** Statuses in which the reviewer can be set or changed. A reassignment while SUBMITTED_FOR_REVIEW needs a reason. */
export const REVIEWER_CHANGE_STATUSES = ["UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "SUBMITTED_FOR_REVIEW"];
export const reviewAlreadyStarted = (status: string) => status === "SUBMITTED_FOR_REVIEW";

export function isReviewOverdue(t: { reviewStatus?: string | null; submittedAt?: Date | string | null }, now = Date.now()): boolean {
  if ((t.reviewStatus as ReviewStatus | undefined) !== "PENDING" || !t.submittedAt) return false;
  return now - new Date(t.submittedAt).getTime() > REVIEW_OVERDUE_HOURS * 3_600_000;
}
