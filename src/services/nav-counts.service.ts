import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/permissions";
import { DuplicateReview, PMAssignment, Ticket } from "@/models";
import { oid, type Filter } from "./scope";
import { ticketTriageFilter } from "./ticket-access";

/** Number of items waiting on the caller, keyed by sidebar href. Items with nothing waiting are omitted. */
export type NavCounts = Record<string, number>;

/**
 * Counts what needs the caller's attention (not totals), so a badge means "go and look":
 *   /tickets          tickets assigned to me and not started, my tickets awaiting my clarification,
 *                     and (managers) new tickets waiting in their triage queue.
 *   /tickets/reviews  reviews waiting for me to decide.
 *   /clients          (admins) possible duplicate clients waiting for a decision.
 *   /projects         handovers waiting for me to accept, and handovers of mine that were rejected.
 */
export async function navCounts(user: CurrentUser): Promise<NavCounts> {
  const me = oid(user.id);
  const admin = user.role === "SUPER_ADMIN";
  const manager = hasPermission(user.role, "ticket:manage");
  const triage: Filter | null = manager ? await ticketTriageFilter(user) : null;

  const [assignedNew, clarification, triageNew, reviewsPending, duplicates, handoverPending, handoverRejected] = await Promise.all([
    hasPermission(user.role, "ticket:create") ? Ticket.countDocuments({ assignee: me, status: "ASSIGNED" }) : 0,
    hasPermission(user.role, "ticket:create") ? Ticket.countDocuments({ createdBy: me, status: "PENDING_CLARIFICATION" }) : 0,
    triage ? Ticket.countDocuments({ ...triage, status: { $in: ["PENDING_APPROVAL", "UNASSIGNED"] } }) : 0,
    hasPermission(user.role, "ticket:create")
      ? Ticket.countDocuments({
          reviewStatus: "PENDING",
          status: { $ne: "DRAFT" },
          ...(admin ? {} : { $or: [{ assignedReviewer: me }, { assignedReviewer: null, createdBy: me }, ...(triage ? [triage] : [])] }),
        })
      : 0,
    hasPermission(user.role, "client:manage") ? DuplicateReview.countDocuments({ status: "OPEN" }) : 0,
    user.role === "PROJECT_MANAGER" ? PMAssignment.countDocuments({ isCurrent: true, status: "PENDING", primaryPm: me }) : 0,
    hasPermission(user.role, "project:handover") ? PMAssignment.countDocuments({ isCurrent: true, status: "REJECTED", ...(admin ? {} : { nominatedBy: me }) }) : 0,
  ]);

  const raw: NavCounts = {
    "/tickets": assignedNew + clarification + triageNew,
    "/tickets/reviews": reviewsPending,
    "/clients": duplicates,
    "/projects": handoverPending + handoverRejected,
  };
  return Object.fromEntries(Object.entries(raw).filter(([, n]) => n > 0));
}
