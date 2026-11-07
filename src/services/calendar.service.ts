import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { unprocessable } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { CLOSED_TASK_STATUSES, FINAL_TICKET_STATUSES, NOT_OVERDUE_TICKET_STATUSES, OPEN_PROJECT_STATUSES } from "@/lib/constants";
import { Milestone, Project, Task, Ticket } from "@/models";
import { accessContext, projectVisibilityFilter, taskVisibilityFilter } from "./access";
import { oid, type Filter } from "./scope";
import { manageScopeFilter, ticketAccessContext } from "./ticket-access";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const CALENDAR_TYPES = ["project", "task", "ticket", "milestone"] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number];

export type CalendarEvent = {
  id: string;
  type: CalendarType;
  title: string;
  /** Reference shown with the title: TSK-00012, TKT-0004, PRJ-0003… */
  ref: string;
  /** Calendar day (yyyy-MM-dd). */
  date: string;
  status: string;
  priority: string | null;
  overdue: boolean;
  closed: boolean;
  href: string;
  context: string;
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const MAX_DAYS = 62;

/**
 * Deadlines the user is allowed to see, between two calendar days (inclusive):
 * project end dates, task and ticket due dates, and milestones. Visibility uses
 * exactly the same rules as the project, task and ticket lists.
 */
export async function calendarEvents(
  user: CurrentUser,
  q: { from: string; to: string; types: CalendarType[]; mine: boolean }
): Promise<{ events: CalendarEvent[]; overdue: CalendarEvent[] }> {
  const from = new Date(`${q.from}T00:00:00.000Z`);
  const to = new Date(`${q.to}T23:59:59.999Z`);
  if (to < from) throw unprocessable("The end date must be after the start date");
  if ((to.getTime() - from.getTime()) / 86400000 > MAX_DAYS) throw unprocessable(`Choose a range of at most ${MAX_DAYS} days`);

  const now = new Date();
  const ctx = await accessContext(user);
  const self = oid(user.id);
  const want = new Set(q.types);
  const canProjects = hasPermission(user.role, "project:read");
  const canTasks = hasPermission(user.role, "task:read");
  const canTickets = hasPermission(user.role, "ticket:create");

  const projectScope: Filter = q.mine ? { $or: [{ manager: self }, { _id: { $in: [...ctx.memberOf].map((x) => oid(x)) } }] } : projectVisibilityFilter(ctx);
  const taskScope: Filter = q.mine ? { $or: [{ owner: self }, { collaborators: self }] } : taskVisibilityFilter(ctx);
  const tctx = canTickets ? await ticketAccessContext(user) : null;
  const ticketScope: Filter = {
    $or: [{ requester: self }, { assignee: self }, ...(q.mine || !tctx ? [] : [manageScopeFilter(tctx)])],
  };

  const visibleProjects = canProjects && (want.has("milestone") || want.has("project"))
    ? await Project.find({ $and: [projectScope, { isArchived: { $ne: true } }] }).select("_id name code").lean()
    : [];
  const projectNames = new Map(visibleProjects.map((p) => [p._id.toString(), p]));

  const [projects, tasks, tickets, milestones, overdueTasks, overdueTickets] = await Promise.all([
    want.has("project") && canProjects
      ? Project.find({ $and: [projectScope, { isArchived: { $ne: true }, endDate: { $gte: from, $lte: to } }] }).select("name code status endDate priority").lean()
      : [],
    want.has("task") && canTasks
      ? Task.find({ $and: [taskScope, { dueDate: { $gte: from, $lte: to } }] })
          .select("taskNumber title status priority dueDate project linkedTicket owner")
          .populate("project", "name code")
          .populate("owner", "name")
          .limit(1500)
          .lean()
      : [],
    want.has("ticket") && canTickets
      ? Ticket.find({ $and: [ticketScope, { dueDate: { $gte: from, $lte: to } }] })
          .select("ticketNumber title status priority dueDate targetDepartment assignee")
          .populate("targetDepartment", "name")
          .populate("assignee", "name")
          .limit(1000)
          .lean()
      : [],
    want.has("milestone") && canProjects
      ? Milestone.find({ project: { $in: visibleProjects.map((p) => p._id) }, dueDate: { $gte: from, $lte: to } }).select("title status dueDate project").lean()
      : [],
    want.has("task") && canTasks
      ? Task.find({ $and: [taskScope, { status: { $nin: CLOSED_TASK_STATUSES }, dueDate: { $lt: now } }] })
          .select("taskNumber title status priority dueDate project linkedTicket owner")
          .populate("project", "name code")
          .populate("owner", "name")
          .sort({ dueDate: 1 })
          .limit(50)
          .lean()
      : [],
    want.has("ticket") && canTickets
      ? Ticket.find({ $and: [ticketScope, { status: { $nin: NOT_OVERDUE_TICKET_STATUSES }, dueDate: { $lt: now } }] })
          .select("ticketNumber title status priority dueDate targetDepartment assignee")
          .populate("targetDepartment", "name")
          .populate("assignee", "name")
          .sort({ dueDate: 1 })
          .limit(50)
          .lean()
      : [],
  ]);

  const taskEvent = (t: any): CalendarEvent => {
    const closed = CLOSED_TASK_STATUSES.includes(t.status);
    return {
      id: `task-${t._id}`,
      type: "task",
      title: t.title,
      ref: t.taskNumber,
      date: day(t.dueDate),
      status: t.status,
      priority: t.priority,
      overdue: !closed && t.dueDate < now,
      closed,
      href: t.linkedTicket ? `/tickets/${t.linkedTicket}?from=task` : `/tasks/${t._id}`,
      context: [t.project?.name ?? (t.linkedTicket ? "Internal request" : null), t.owner?.name].filter(Boolean).join(" · "),
    };
  };
  const ticketEvent = (t: any): CalendarEvent => ({
    id: `ticket-${t._id}`,
    type: "ticket",
    title: t.title,
    ref: t.ticketNumber,
    date: day(t.dueDate),
    status: t.status,
    priority: t.priority,
    overdue: t.dueDate < now && !NOT_OVERDUE_TICKET_STATUSES.includes(t.status),
    closed: FINAL_TICKET_STATUSES.includes(t.status),
    href: `/tickets/${t._id}`,
    context: [t.targetDepartment?.name, t.assignee?.name ?? "Unassigned"].filter(Boolean).join(" · "),
  });

  const events: CalendarEvent[] = [
    ...projects.map((p: any) => {
      const closed = !OPEN_PROJECT_STATUSES.includes(p.status);
      return {
        id: `project-${p._id}`,
        type: "project" as const,
        title: p.name,
        ref: p.code,
        date: day(p.endDate),
        status: p.status,
        priority: p.priority ?? null,
        overdue: !closed && p.endDate < now,
        closed,
        href: `/projects/${p._id}`,
        context: "Project deadline",
      };
    }),
    ...tasks.map(taskEvent),
    ...tickets.map(ticketEvent),
    ...milestones.map((m: any) => {
      const p = projectNames.get(m.project.toString());
      const closed = m.status === "COMPLETED";
      return {
        id: `milestone-${m._id}`,
        type: "milestone" as const,
        title: m.title,
        ref: p?.code ?? "",
        date: day(m.dueDate),
        status: m.status,
        priority: null,
        overdue: !closed && m.dueDate < now,
        closed,
        href: `/projects/${m.project}`,
        context: p ? `Milestone · ${p.name}` : "Milestone",
      };
    }),
  ].sort((a, b) => a.date.localeCompare(b.date) || Number(a.closed) - Number(b.closed));

  const overdue = [...overdueTasks.map(taskEvent), ...overdueTickets.map(ticketEvent)].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 50);
  return { events, overdue };
}
