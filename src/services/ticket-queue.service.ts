import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { conflict, forbidden, notFound, unprocessable } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { TICKET_CLOSED_STATUSES, type TicketStatus } from "@/lib/constants";
import { Ticket, TicketActivity, TicketQueue } from "@/models";
import { oid, type Filter } from "./scope";
import { ticketRights, triageDepartmentIds } from "./ticket-access";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Manager-defined ticket order. A "queue" is one employee's open tickets. Positions are 1..n with
 * no duplicates, kept dense by rewriting ranks while holding a per-queue lock. The rank is stored
 * separately from `priority`, so neither ever changes the other.
 */

const s = (v: any): string => (v ? String(v._id ?? v) : "");
const OPEN_EXCLUDED = [...TICKET_CLOSED_STATUSES, "DRAFT"];

export const queueFilter = (assigneeId: string): Filter => ({ assignee: oid(assigneeId), status: { $nin: OPEN_EXCLUDED } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withQueueLock<T>(queueId: string, fn: () => Promise<T>): Promise<T> {
  const _id = oid(queueId);
  let locked = false;
  for (let attempt = 0; attempt < 25 && !locked; attempt++) {
    const now = new Date();
    try {
      // Upsert only succeeds when the queue is unlocked (or its lock expired); otherwise the insert hits a duplicate _id.
      await TicketQueue.findOneAndUpdate(
        { _id, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
        { $set: { lockedUntil: new Date(now.getTime() + 10_000) } },
        { upsert: true }
      );
      locked = true;
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      await sleep(40 + Math.random() * 80);
    }
  }
  if (!locked) throw conflict("Someone else is reordering this queue right now. Please try again.");
  try {
    return await fn();
  } finally {
    await TicketQueue.updateOne({ _id }, { $set: { lockedUntil: null } }).catch(() => undefined);
  }
}

const time = (d: any) => (d ? new Date(d).getTime() : 0);

/** The queue in manager order. Unranked tickets (just assigned) fall to the end, oldest assignment first. */
async function sortedQueue(queueId: string) {
  const rows: any[] = await Ticket.find(queueFilter(queueId)).select("priorityRank queueId assignedAt createdAt").lean();
  rows.sort(
    (a, b) =>
      (a.priorityRank ?? Infinity) - (b.priorityRank ?? Infinity) ||
      time(a.assignedAt ?? a.createdAt) - time(b.assignedAt ?? b.createdAt) ||
      String(a._id).localeCompare(String(b._id))
  );
  return rows;
}

/** Rewrite ranks as 1..n. Caller must hold the queue lock. */
async function normalizeLocked(queueId: string, rows?: any[]) {
  const ordered = rows ?? (await sortedQueue(queueId));
  const ops = ordered
    .map((r, i) => ({ r, rank: i + 1 }))
    .filter(({ r, rank }) => r.priorityRank !== rank || s(r.queueId) !== queueId)
    .map(({ r, rank }) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { priorityRank: rank, queueId: oid(queueId) } } } }));
  if (ops.length) await Ticket.bulkWrite(ops);
  return ordered.map((r) => s(r._id));
}

/** Read path: make sure every ticket in the queue has a rank (legacy tickets, fresh assignments). */
export async function ensureRanked(queueId: string) {
  const missing = await Ticket.exists({ ...queueFilter(queueId), $or: [{ priorityRank: null }, { queueId: { $ne: oid(queueId) } }] });
  if (missing) await withQueueLock(queueId, () => normalizeLocked(queueId));
}

/** id → 1-based position for one employee's open queue. */
export async function queuePositions(queueId: string): Promise<Map<string, number>> {
  const rows = await sortedQueue(queueId);
  return new Map(rows.map((r, i) => [s(r._id), i + 1]));
}

/** A newly (re)assigned ticket joins the END of the assignee's queue; nobody else's position changes. */
export async function appendToQueue(ticketId: any, assigneeId: string) {
  await withQueueLock(assigneeId, async () => {
    await Ticket.updateOne({ _id: ticketId }, { $set: { priorityRank: null, queueId: oid(assigneeId) } });
    await normalizeLocked(assigneeId);
  });
}

/** Which tickets the viewer may reorder, without a database hit per row. */
export async function reorderAuthority(user: CurrentUser): Promise<(t: any) => boolean> {
  if (user.role === "SUPER_ADMIN") return () => true;
  if (!hasPermission(user.role, "ticket:manage")) return () => false;
  const departments = new Set(((await triageDepartmentIds(user)) ?? []).map(String));
  return (t) => (t.projectManager ? s(t.projectManager) === user.id : departments.has(s(t.targetDepartment)));
}

export async function reorderTicket(user: CurrentUser, ticketId: string, position: number) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw notFound("Ticket not found");
  const rights = await ticketRights(user, ticket);
  if (!rights.view) throw notFound("Ticket not found");
  if (!rights.triager) throw forbidden("Only the department's Project Manager or a Super Admin can reorder tickets");
  if (!ticket.assignee || OPEN_EXCLUDED.includes(ticket.status as TicketStatus)) {
    throw unprocessable("Only open, assigned tickets can be reordered");
  }
  const queueId = s(ticket.assignee);

  return withQueueLock(queueId, async () => {
    // Re-check inside the lock: the ticket may have been reassigned or closed while we waited.
    const fresh = await Ticket.findById(ticketId).select("assignee status").lean();
    if (!fresh || s(fresh.assignee) !== queueId || OPEN_EXCLUDED.includes(fresh.status)) throw conflict("This ticket changed while you were reordering. Refresh and try again.");

    const rows = await sortedQueue(queueId);
    const ids = rows.map((r) => s(r._id));
    const from = ids.indexOf(ticketId);
    if (from < 0) throw conflict("This ticket is no longer in that queue. Refresh and try again.");
    const to = Math.min(Math.max(position, 1), ids.length) - 1;
    if (to === from) return { from: from + 1, to: from + 1, size: ids.length };

    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved);
    const now = new Date();
    const ops = rows
      .map((r, i) => ({ r, rank: i + 1 }))
      .filter(({ r, rank }) => r.priorityRank !== rank || s(r.queueId) !== queueId || s(r._id) === ticketId)
      .map(({ r, rank }) => ({
        updateOne: {
          filter: { _id: r._id },
          update: { $set: { priorityRank: rank, queueId: oid(queueId), ...(s(r._id) === ticketId ? { reorderedBy: oid(user.id), reorderedAt: now } : {}) } },
        },
      }));
    await Ticket.bulkWrite(ops);

    await TicketActivity.create({
      ticket: ticket._id,
      actor: oid(user.id),
      action: "REORDERED" as never,
      from: String(from + 1),
      to: String(to + 1),
      message: `Moved from position ${from + 1} to ${to + 1} of ${ids.length} in the assignee's queue`,
    });
    await recordAudit({
      actorId: user.id,
      action: "ticket.reordered",
      entityType: "Ticket",
      entityId: ticket._id,
      summary: `${ticket.ticketNumber}: queue position ${from + 1} → ${to + 1}`,
      changes: { queuePosition: { from: from + 1, to: to + 1 }, queue: { from: queueId, to: queueId } },
    });
    return { from: from + 1, to: to + 1, size: ids.length };
  });
}
