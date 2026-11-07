import "server-only";
import type { Types } from "mongoose";
import type { CurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/permissions";
import { TICKET_REOPEN_WINDOW_DAYS, type TicketStatus } from "@/lib/constants";
import type { TicketWorkflowContext } from "@/lib/ticket-workflow";
import { accessContext, type AccessContext } from "./access";
import { oid, type Filter } from "./scope";

/**
 * Who may see / act on an internal ticket.
 *
 *  - Requester: their own tickets.
 *  - Assignee: tickets assigned to them (former assignees keep read access).
 *  - Project Manager (`ticket:manage`): tickets with no related project, plus
 *    tickets related to projects they manage.
 *  - Department Head (`ticket:monitor`): tickets requested by or sent to the
 *    departments they head (read + comment).
 *  - Super Admin: everything.
 */
export type TicketAccessContext = AccessContext & { canManageTickets: boolean; canMonitorTickets: boolean };

type TicketLike = {
  requester?: unknown;
  assignee?: unknown;
  project?: unknown;
  targetDepartment?: unknown;
  requestingDepartment?: unknown;
  assignments?: { employee?: unknown }[] | null;
  status?: string;
  closure?: { closedAt?: Date | null } | null;
};

/** Id as string, whether the value is an ObjectId, a string or a populated document. */
export const sid = (v: unknown): string =>
  !v ? "" : typeof v === "object" && "_id" in (v as object) ? String((v as { _id: unknown })._id) : String(v);

export async function ticketAccessContext(user: CurrentUser): Promise<TicketAccessContext> {
  const ctx = await accessContext(user);
  return {
    ...ctx,
    canManageTickets: hasPermission(user.role, "ticket:manage"),
    canMonitorTickets: hasPermission(user.role, "ticket:monitor"),
  };
}

/** Upgrades a task/project AccessContext (already computed for this request). */
export function fromAccessContext(ctx: AccessContext): TicketAccessContext {
  return {
    ...ctx,
    canManageTickets: hasPermission(ctx.user.role, "ticket:manage"),
    canMonitorTickets: hasPermission(ctx.user.role, "ticket:monitor"),
  };
}

export const isTicketRequester =(ctx: TicketAccessContext, t: TicketLike) => sid(t.requester) === ctx.user.id;
export const isTicketAssignee = (ctx: TicketAccessContext, t: TicketLike) => !!t.assignee && sid(t.assignee) === ctx.user.id;
export const wasTicketAssignee = (ctx: TicketAccessContext, t: TicketLike) =>
  (t.assignments ?? []).some((a) => sid(a.employee) === ctx.user.id);

/** Review, assign, reassign, reject, intervene. */
export function canManageTicket(ctx: TicketAccessContext, t: TicketLike): boolean {
  if (ctx.isAdmin) return true;
  if (!ctx.canManageTickets) return false;
  return !t.project || ctx.managed.has(sid(t.project));
}

/** Read access to the ticket from a management perspective (manager or department head). */
export function canMonitorTicket(ctx: TicketAccessContext, t: TicketLike): boolean {
  if (canManageTicket(ctx, t)) return true;
  if (!ctx.canMonitorTickets) return false;
  return ctx.headed.has(sid(t.targetDepartment)) || ctx.headed.has(sid(t.requestingDepartment));
}

export function canViewTicket(ctx: TicketAccessContext, t: TicketLike): boolean {
  return canMonitorTicket(ctx, t) || isTicketRequester(ctx, t) || isTicketAssignee(ctx, t) || wasTicketAssignee(ctx, t);
}

/** Mongo filter for the Ticket Management queue. Matches nothing when the user has no scope. */
export function manageScopeFilter(ctx: TicketAccessContext): Filter {
  if (ctx.isAdmin) return {};
  const or: Filter[] = [];
  if (ctx.canManageTickets) {
    or.push({ project: null });
    if (ctx.managed.size) or.push({ project: { $in: [...ctx.managed].map((x) => oid(x)) } });
  }
  if (ctx.canMonitorTickets && ctx.headed.size) {
    const headed = [...ctx.headed].map((x) => oid(x));
    or.push({ targetDepartment: { $in: headed } }, { requestingDepartment: { $in: headed } });
  }
  return or.length ? { $or: or } : { _id: { $in: [] as Types.ObjectId[] } };
}

export function withinReopenWindow(t: TicketLike): boolean {
  const closedAt = t.closure?.closedAt;
  if (!closedAt) return false;
  return Date.now() - new Date(closedAt).getTime() <= TICKET_REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export function ticketWorkflowContext(ctx: TicketAccessContext, t: TicketLike): TicketWorkflowContext {
  return {
    status: t.status as TicketStatus,
    isRequester: isTicketRequester(ctx, t),
    isAssignee: isTicketAssignee(ctx, t),
    canManage: canManageTicket(ctx, t),
    hasAssignee: !!t.assignee,
    withinReopenWindow: withinReopenWindow(t),
  };
}
