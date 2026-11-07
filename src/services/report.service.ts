import "server-only";
import type { Types } from "mongoose";
import { format, startOfMonth, subDays, subMonths } from "date-fns";
import type { CurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/permissions";
import {
  CLOSED_TASK_STATUSES,
  FINAL_TICKET_STATUSES,
  NOT_OVERDUE_TICKET_STATUSES,
  OPEN_PROJECT_STATUSES,
  OPEN_TASK_STATUSES,
  PROJECT_STATUSES,
  TASK_STATUSES,
  TICKET_STATUSES,
  type ProjectStatus,
  type TaskStatus,
  type TicketStatus,
} from "@/lib/constants";
import { DailyUpdate, Department, Milestone, Project, Task, Ticket, User } from "@/models";
import { accessContext, projectVisibilityFilter, taskVisibilityFilter } from "./access";
import { ctxFor, teamFilter } from "./daily-update-access";
import { progressFor, EMPTY_PROGRESS } from "./progress.service";
import { oid, type Filter } from "./scope";
import { manageScopeFilter, ticketAccessContext } from "./ticket-access";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type TaskStats = { total: number; completed: number; pending: number; inProgress: number; inReview: number; overdue: number; cancelled: number; completionRate: number };
export type TrendPoint = { month: string; label: string; created: number; completed: number };
export type WorkloadPoint = { id: string; name: string; department: string | null; open: number; inProgress: number; overdue: number; completed: number };
export type DeptPoint = { id: string; name: string; color: string; total: number; completed: number; open: number; overdue: number; completionRate: number };
export type TicketStats = {
  total: number;
  open: number;
  closed: number;
  overdue: number;
  byStatus: { status: TicketStatus; count: number }[];
  avgHoursToAssign: number | null;
  avgHoursToClose: number | null;
};
export type ProjectRow = { id: string; name: string; code: string; status: ProjectStatus; endDate: string | null; progress: number; total: number; completed: number; overdue: number };

export type ReportsDTO = {
  generatedAt: string;
  months: number;
  sections: { company: boolean; project: boolean; department: boolean };
  personal: {
    stats: TaskStats;
    statusDistribution: { status: TaskStatus; count: number }[];
    trend: TrendPoint[];
    dailyHours: { date: string; hours: number }[];
    reports: { total: number; approved: number; pending: number; changesRequested: number; hours: number };
  };
  company?: {
    projects: { total: number; byStatus: { status: ProjectStatus; count: number }[]; averageProgress: number };
    projectCompletion: ProjectRow[];
    tasks: TaskStats;
    statusDistribution: { status: TaskStatus; count: number }[];
    departments: DeptPoint[];
    workload: WorkloadPoint[];
    tickets: TicketStats;
    trend: TrendPoint[];
  };
  project?: {
    projects: ProjectRow[];
    tasks: TaskStats;
    statusDistribution: { status: TaskStatus; count: number }[];
    departments: DeptPoint[];
    deadlines: { type: "project" | "milestone"; id: string; title: string; project: string; date: string; overdue: boolean }[];
    tickets: TicketStats & { assignees: { id: string; name: string; assigned: number; active: number; closed: number; avgHoursToClose: number | null }[] };
    trend: TrendPoint[];
  };
  department?: {
    departments: { id: string; name: string }[];
    tasks: TaskStats;
    statusDistribution: { status: TaskStatus; count: number }[];
    workload: WorkloadPoint[];
    ticketsReceived: TicketStats;
    trend: TrendPoint[];
    dailyUpdates: { reports: number; hours: number; pendingReview: number; employeesReporting: number };
  };
};

/* ------------------------------------------------------------------ */
/* Aggregation helpers (all computed from MongoDB)                     */
/* ------------------------------------------------------------------ */

const round1 = (n: number) => Math.round(n * 10) / 10;

async function taskStats(match: Filter): Promise<TaskStats> {
  const now = new Date();
  const [r] = await Task.aggregate<any>([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ["$status", "IN_PROGRESS"] }, 1, 0] } },
        inReview: { $sum: { $cond: [{ $eq: ["$status", "IN_REVIEW"] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $in: ["$status", OPEN_TASK_STATUSES] }, 1, 0] } },
        overdue: {
          $sum: { $cond: [{ $and: [{ $in: ["$status", OPEN_TASK_STATUSES] }, { $ne: ["$dueDate", null] }, { $lt: ["$dueDate", now] }] }, 1, 0] },
        },
      },
    },
  ]);
  const total = r?.total ?? 0;
  const effective = total - (r?.cancelled ?? 0);
  return {
    total,
    completed: r?.completed ?? 0,
    pending: r?.pending ?? 0,
    inProgress: r?.inProgress ?? 0,
    inReview: r?.inReview ?? 0,
    overdue: r?.overdue ?? 0,
    cancelled: r?.cancelled ?? 0,
    completionRate: effective > 0 ? Math.round(((r?.completed ?? 0) / effective) * 100) : 0,
  };
}

async function statusDistribution(match: Filter) {
  const rows = await Task.aggregate<{ _id: TaskStatus; n: number }>([{ $match: match }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
  const m = new Map(rows.map((r) => [r._id, r.n]));
  return TASK_STATUSES.map((status) => ({ status, count: m.get(status) ?? 0 }));
}

/** Tasks created vs completed per calendar month (UTC), oldest first. */
async function monthlyTrend(match: Filter, months: number): Promise<TrendPoint[]> {
  const start = startOfMonth(subMonths(new Date(), months - 1));
  const [created, completed] = await Promise.all([
    Task.aggregate<{ _id: string; n: number }>([
      { $match: { $and: [match, { createdAt: { $gte: start } }] } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, n: { $sum: 1 } } },
    ]),
    Task.aggregate<{ _id: string; n: number }>([
      { $match: { $and: [match, { status: "COMPLETED", completedAt: { $gte: start } }] } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$completedAt" } }, n: { $sum: 1 } } },
    ]),
  ]);
  const c = new Map(created.map((r) => [r._id, r.n]));
  const d = new Map(completed.map((r) => [r._id, r.n]));
  return Array.from({ length: months }, (_, i) => {
    const m = subMonths(new Date(), months - 1 - i);
    const key = format(m, "yyyy-MM");
    return { month: key, label: format(m, "MMM yy"), created: c.get(key) ?? 0, completed: d.get(key) ?? 0 };
  });
}

async function workload(match: Filter, limit = 15): Promise<WorkloadPoint[]> {
  const now = new Date();
  const rows = await Task.aggregate<any>([
    { $match: { $and: [match, { owner: { $ne: null } }] } },
    {
      $group: {
        _id: "$owner",
        open: { $sum: { $cond: [{ $in: ["$status", OPEN_TASK_STATUSES] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ["$status", "IN_PROGRESS"] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
        overdue: {
          $sum: { $cond: [{ $and: [{ $in: ["$status", OPEN_TASK_STATUSES] }, { $ne: ["$dueDate", null] }, { $lt: ["$dueDate", now] }] }, 1, 0] },
        },
      },
    },
    { $sort: { open: -1, overdue: -1 } },
    { $limit: limit },
  ]);
  const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }).select("name department").populate("department", "name").lean();
  const byId = new Map(users.map((u: any) => [u._id.toString(), u]));
  return rows.map((r) => {
    const u: any = byId.get(r._id.toString());
    return { id: r._id.toString(), name: u?.name ?? "Unknown", department: u?.department?.name ?? null, open: r.open, inProgress: r.inProgress, overdue: r.overdue, completed: r.completed };
  });
}

async function departmentPerformance(match: Filter, deptIds?: Types.ObjectId[]): Promise<DeptPoint[]> {
  const now = new Date();
  const rows = await Task.aggregate<any>([
    { $match: { $and: [match, { department: deptIds ? { $in: deptIds } : { $ne: null } }] } },
    {
      $group: {
        _id: "$department",
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
        open: { $sum: { $cond: [{ $in: ["$status", OPEN_TASK_STATUSES] }, 1, 0] } },
        overdue: {
          $sum: { $cond: [{ $and: [{ $in: ["$status", OPEN_TASK_STATUSES] }, { $ne: ["$dueDate", null] }, { $lt: ["$dueDate", now] }] }, 1, 0] },
        },
      },
    },
  ]);
  const depts = await Department.find(deptIds ? { _id: { $in: deptIds } } : { status: "ACTIVE" }).select("name color").sort({ name: 1 }).lean();
  const m = new Map(rows.map((r) => [r._id.toString(), r]));
  return depts.map((d) => {
    const r = m.get(d._id.toString());
    const eff = (r?.total ?? 0) - (r?.cancelled ?? 0);
    return {
      id: d._id.toString(),
      name: d.name,
      color: d.color ?? "#16a34a",
      total: r?.total ?? 0,
      completed: r?.completed ?? 0,
      open: r?.open ?? 0,
      overdue: r?.overdue ?? 0,
      completionRate: eff > 0 ? Math.round(((r?.completed ?? 0) / eff) * 100) : 0,
    };
  });
}

async function ticketStats(match: Filter): Promise<TicketStats> {
  const now = new Date();
  const [byStatus, timing] = await Promise.all([
    Ticket.aggregate<{ _id: TicketStatus; n: number }>([{ $match: match }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Ticket.aggregate<any>([
      { $match: match },
      {
        $group: {
          _id: null,
          overdue: { $sum: { $cond: [{ $and: [{ $lt: ["$dueDate", now] }, { $not: [{ $in: ["$status", NOT_OVERDUE_TICKET_STATUSES] }] }] }, 1, 0] } },
          // First assignment time = first row of the assignment history.
          toAssign: { $avg: { $cond: [{ $gt: [{ $size: "$assignments" }, 0] }, { $subtract: [{ $arrayElemAt: ["$assignments.assignedAt", 0] }, "$createdAt"] }, null] } },
          toClose: { $avg: { $cond: [{ $and: [{ $eq: ["$status", "CLOSED"] }, { $ne: ["$closure.closedAt", null] }] }, { $subtract: ["$closure.closedAt", "$createdAt"] }, null] } },
        },
      },
    ]),
  ]);
  const m = new Map(byStatus.map((r) => [r._id, r.n]));
  const total = byStatus.reduce((n, r) => n + r.n, 0);
  const closed = FINAL_TICKET_STATUSES.reduce((n, s) => n + (m.get(s) ?? 0), 0);
  const t = timing[0];
  return {
    total,
    open: total - closed,
    closed: m.get("CLOSED") ?? 0,
    overdue: t?.overdue ?? 0,
    byStatus: TICKET_STATUSES.map((status) => ({ status, count: m.get(status) ?? 0 })),
    avgHoursToAssign: t?.toAssign != null ? round1(t.toAssign / 3600000) : null,
    avgHoursToClose: t?.toClose != null ? round1(t.toClose / 3600000) : null,
  };
}

async function projectRows(filter: Filter, limit = 50): Promise<ProjectRow[]> {
  const projects = await Project.find({ $and: [filter, { isArchived: { $ne: true } }] }).select("name code status endDate").sort({ endDate: 1 }).limit(limit).lean();
  const stats = await progressFor(projects.map((p) => p._id));
  return projects.map((p) => {
    const st = stats.get(p._id.toString()) ?? EMPTY_PROGRESS;
    return {
      id: p._id.toString(),
      name: p.name,
      code: p.code,
      status: p.status as ProjectStatus,
      endDate: p.endDate ? p.endDate.toISOString() : null,
      progress: st.percent,
      total: st.total - st.cancelled,
      completed: st.completed,
      overdue: st.overdue,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Report assembly                                                     */
/* ------------------------------------------------------------------ */

export async function getReports(user: CurrentUser, opts: { months: number; department: string }): Promise<ReportsDTO> {
  const months = Math.min(Math.max(opts.months, 3), 12);
  const ctx = await accessContext(user);
  const self = oid(user.id);
  const mine: Filter = { owner: self };

  // Personal (everyone).
  const since30 = subDays(new Date(), 29);
  const [pStats, pDist, pTrend, hours, reportAgg] = await Promise.all([
    taskStats(mine),
    statusDistribution(mine),
    monthlyTrend(mine, months),
    DailyUpdate.aggregate<{ _id: string; h: number }>([
      { $match: { user: self, date: { $gte: new Date(`${format(since30, "yyyy-MM-dd")}T00:00:00.000Z`) } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } }, h: { $sum: "$hoursSpent" } } },
    ]),
    DailyUpdate.aggregate<{ _id: string; n: number; h: number }>([{ $match: { user: self } }, { $group: { _id: "$status", n: { $sum: 1 }, h: { $sum: "$hoursSpent" } } }]),
  ]);
  const hm = new Map(hours.map((h) => [h._id, h.h]));
  const rs = new Map(reportAgg.map((r) => [r._id, r]));
  const result: ReportsDTO = {
    generatedAt: new Date().toISOString(),
    months,
    sections: { company: false, project: false, department: false },
    personal: {
      stats: pStats,
      statusDistribution: pDist,
      trend: pTrend,
      dailyHours: Array.from({ length: 30 }, (_, i) => {
        const d = format(subDays(new Date(), 29 - i), "yyyy-MM-dd");
        return { date: d, hours: round1(hm.get(d) ?? 0) };
      }),
      reports: {
        total: reportAgg.reduce((n, r) => n + r.n, 0),
        approved: rs.get("APPROVED")?.n ?? 0,
        pending: rs.get("SUBMITTED")?.n ?? 0,
        changesRequested: rs.get("CHANGES_REQUESTED")?.n ?? 0,
        hours: round1(reportAgg.reduce((n, r) => n + r.h, 0)),
      },
    },
  };

  // Company (Super Admin, or anyone granted report:company).
  if (hasPermission(user.role, "report:company")) {
    const deptFilter: Filter = /^[a-f\d]{24}$/i.test(opts.department) ? { department: oid(opts.department) } : {};
    const [projStatus, projectCompletion, tasks, dist, departments, wl, tickets, trend] = await Promise.all([
      Project.aggregate<{ _id: ProjectStatus; n: number }>([{ $match: { isArchived: { $ne: true } } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
      projectRows({ status: { $in: OPEN_PROJECT_STATUSES } }, 15),
      taskStats(deptFilter),
      statusDistribution(deptFilter),
      departmentPerformance({}),
      workload(deptFilter),
      ticketStats(/^[a-f\d]{24}$/i.test(opts.department) ? { targetDepartment: oid(opts.department) } : {}),
      monthlyTrend(deptFilter, months),
    ]);
    const pm = new Map(projStatus.map((p) => [p._id, p.n]));
    const all = await projectRows({}, 500);
    result.company = {
      projects: {
        total: projStatus.reduce((n, p) => n + p.n, 0),
        byStatus: PROJECT_STATUSES.map((status) => ({ status, count: pm.get(status) ?? 0 })),
        averageProgress: all.length ? Math.round(all.reduce((n, p) => n + p.progress, 0) / all.length) : 0,
      },
      projectCompletion,
      tasks,
      statusDistribution: dist,
      departments,
      workload: wl,
      tickets,
      trend,
    };
    result.sections.company = true;
  }

  // Managed projects (Project Managers).
  if (hasPermission(user.role, "report:project") && ctx.managed.size) {
    const ids = [...ctx.managed].map((x) => oid(x));
    const inProjects: Filter = { project: { $in: ids } };
    const now = new Date();
    const tctx = await ticketAccessContext(user);
    const ticketScope = manageScopeFilter(tctx);
    const [projects, tasks, dist, depts, milestones, tickets, assignees, trend] = await Promise.all([
      projectRows({ _id: { $in: ids } }),
      taskStats(inProjects),
      statusDistribution(inProjects),
      Project.find({ _id: { $in: ids } }).select("departments").lean(),
      Milestone.find({ project: { $in: ids }, status: { $ne: "COMPLETED" }, dueDate: { $ne: null } }).sort({ dueDate: 1 }).limit(20).populate("project", "name").lean(),
      ticketStats(ticketScope),
      Ticket.aggregate<any>([
        { $match: { $and: [ticketScope, { "assignments.0": { $exists: true } }] } },
        { $unwind: "$assignments" },
        {
          $group: {
            _id: "$assignments.employee",
            assigned: { $sum: 1 },
            active: { $sum: { $cond: [{ $and: [{ $eq: ["$assignments.endedAt", null] }, { $not: [{ $in: ["$status", FINAL_TICKET_STATUSES] }] }] }, 1, 0] } },
            closed: { $sum: { $cond: [{ $and: [{ $eq: ["$assignments.endedAt", null] }, { $eq: ["$status", "CLOSED"] }] }, 1, 0] } },
            toClose: { $avg: { $cond: [{ $and: [{ $eq: ["$assignments.endedAt", null] }, { $eq: ["$status", "CLOSED"] }] }, { $subtract: ["$closure.closedAt", "$assignments.assignedAt"] }, null] } },
          },
        },
        { $sort: { assigned: -1 } },
        { $limit: 15 },
      ]),
      monthlyTrend(inProjects, months),
    ]);
    const deptIds = [...new Set(depts.flatMap((p) => p.departments.map(String)))].map((x) => oid(x));
    const names = await User.find({ _id: { $in: assignees.map((a) => a._id) } }).select("name").lean();
    const nameOf = new Map(names.map((n) => [n._id.toString(), n.name]));
    result.project = {
      projects,
      tasks,
      statusDistribution: dist,
      departments: await departmentPerformance(inProjects, deptIds),
      deadlines: [
        ...projects
          .filter((p) => p.endDate && OPEN_PROJECT_STATUSES.includes(p.status))
          .map((p) => ({ type: "project" as const, id: p.id, title: p.name, project: p.name, date: p.endDate!, overdue: new Date(p.endDate!) < now })),
        ...milestones.map((m: any) => ({ type: "milestone" as const, id: m.project._id.toString(), title: m.title, project: m.project.name, date: m.dueDate.toISOString(), overdue: m.dueDate < now })),
      ]
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 15),
      tickets: {
        ...tickets,
        assignees: assignees.map((a) => ({
          id: a._id.toString(),
          name: nameOf.get(a._id.toString()) ?? "Unknown",
          assigned: a.assigned,
          active: a.active,
          closed: a.closed,
          avgHoursToClose: a.toClose != null ? round1(a.toClose / 3600000) : null,
        })),
      },
      trend,
    };
    result.sections.project = true;
  }

  // Departments the user heads (Department Heads).
  if (hasPermission(user.role, "report:department") && ctx.headed.size) {
    const deptIds = [...ctx.headed].map((x) => oid(x));
    const inDepts: Filter = { department: { $in: deptIds } };
    const since = new Date(`${format(since30, "yyyy-MM-dd")}T00:00:00.000Z`);
    const [departments, tasks, dist, wl, received, trend, du] = await Promise.all([
      Department.find({ _id: { $in: deptIds } }).select("name").sort({ name: 1 }).lean(),
      taskStats(inDepts),
      statusDistribution(inDepts),
      workload(inDepts, 25),
      ticketStats({ targetDepartment: { $in: deptIds } }),
      monthlyTrend(inDepts, months),
      DailyUpdate.aggregate<any>([
        { $match: { department: { $in: deptIds }, date: { $gte: since } } },
        { $group: { _id: null, reports: { $sum: 1 }, hours: { $sum: "$hoursSpent" }, pending: { $sum: { $cond: [{ $eq: ["$status", "SUBMITTED"] }, 1, 0] } }, people: { $addToSet: "$user" } } },
      ]),
    ]);
    result.department = {
      departments: departments.map((d) => ({ id: d._id.toString(), name: d.name })),
      tasks,
      statusDistribution: dist,
      workload: wl,
      ticketsReceived: received,
      trend,
      dailyUpdates: { reports: du[0]?.reports ?? 0, hours: round1(du[0]?.hours ?? 0), pendingReview: du[0]?.pending ?? 0, employeesReporting: du[0]?.people?.length ?? 0 },
    };
    result.sections.department = true;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

export const EXPORT_DATASETS = ["tasks", "projects", "tickets", "departments", "workload", "daily-updates"] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

/** RFC 4180 quoting, plus a guard against spreadsheet formula injection. */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
const d = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "");

/**
 * Exports exactly what the user may see. Reporting datasets (departments,
 * workload) use the widest report section the user has.
 */
export async function exportDataset(user: CurrentUser, dataset: ExportDataset): Promise<{ filename: string; csv: string } | null> {
  const ctx = await accessContext(user);
  const stamp = format(new Date(), "yyyy-MM-dd");
  const now = new Date();

  // Scope for the reporting datasets, in order of breadth.
  const reportScope: Filter | null = hasPermission(user.role, "report:company")
    ? {}
    : hasPermission(user.role, "report:project") && ctx.managed.size
      ? { project: { $in: [...ctx.managed].map((x) => oid(x)) } }
      : hasPermission(user.role, "report:department") && ctx.headed.size
        ? { department: { $in: [...ctx.headed].map((x) => oid(x)) } }
        : null;

  switch (dataset) {
    case "tasks": {
      if (!hasPermission(user.role, "task:read")) return null;
      const rows: any[] = await Task.find(taskVisibilityFilter(ctx))
        .sort({ createdAt: -1 })
        .limit(20000)
        .populate("project", "code name")
        .populate("department", "name")
        .populate("owner", "name email")
        .populate("linkedTicket", "ticketNumber")
        .lean();
      return {
        filename: `tasks-${stamp}.csv`,
        csv: toCsv(
          ["Task number", "Title", "Source", "Ticket", "Project code", "Project", "Department", "Owner", "Owner email", "Status", "Priority", "Start", "Due", "Completed", "Overdue", "Estimated hours", "Actual hours", "Created"],
          rows.map((t) => [
            t.taskNumber, t.title, t.linkedTicket ? "Internal request" : "Project", t.linkedTicket?.ticketNumber ?? "", t.project?.code ?? "", t.project?.name ?? "",
            t.department?.name ?? "", t.owner?.name ?? "", t.owner?.email ?? "", t.status, t.priority, d(t.startDate), d(t.dueDate), d(t.completedAt),
            !CLOSED_TASK_STATUSES.includes(t.status) && t.dueDate && t.dueDate < now ? "Yes" : "No", t.estimatedHours ?? "", t.actualHours ?? "", d(t.createdAt),
          ])
        ),
      };
    }
    case "projects": {
      if (!hasPermission(user.role, "project:read")) return null;
      const projects: any[] = await Project.find(projectVisibilityFilter(ctx)).sort({ createdAt: -1 }).populate("manager", "name").populate("departments", "name").lean();
      const stats = await progressFor(projects.map((p) => p._id));
      return {
        filename: `projects-${stamp}.csv`,
        csv: toCsv(
          ["Code", "Name", "Client", "Status", "Priority", "Manager", "Departments", "Start", "End", "Tasks", "Completed", "Overdue", "Progress %", "Archived"],
          projects.map((p) => {
            const st = stats.get(p._id.toString()) ?? EMPTY_PROGRESS;
            return [p.code, p.name, p.client ?? "", p.status, p.priority, p.manager?.name ?? "", (p.departments ?? []).map((x: any) => x.name).join("; "), d(p.startDate), d(p.endDate), st.total - st.cancelled, st.completed, st.overdue, st.percent, p.isArchived ? "Yes" : "No"];
          })
        ),
      };
    }
    case "tickets": {
      if (!hasPermission(user.role, "ticket:create")) return null;
      const tctx = await ticketAccessContext(user);
      const scope = tctx.isAdmin || tctx.canManageTickets || tctx.canMonitorTickets ? { $or: [{ requester: oid(user.id) }, { assignee: oid(user.id) }, manageScopeFilter(tctx)] } : { $or: [{ requester: oid(user.id) }, { assignee: oid(user.id) }] };
      const rows: any[] = await Ticket.find(scope)
        .sort({ createdAt: -1 })
        .limit(20000)
        .populate("requester", "name")
        .populate("assignee", "name")
        .populate("requestingDepartment", "name")
        .populate("targetDepartment", "name")
        .populate("linkedTask", "taskNumber")
        .lean();
      return {
        filename: `tickets-${stamp}.csv`,
        csv: toCsv(
          ["Ticket number", "Title", "Category", "Requester", "From department", "To department", "Priority", "Status", "Assigned to", "Linked task", "Required by", "Created", "First assigned", "Resolved", "Closed", "Revisions", "Overdue"],
          rows.map((t) => [
            t.ticketNumber, t.title, t.categoryName, t.requester?.name ?? "", t.requestingDepartment?.name ?? "", t.targetDepartment?.name ?? "", t.priority, t.status,
            t.assignee?.name ?? "", t.linkedTask?.taskNumber ?? "", d(t.dueDate), d(t.createdAt), d(t.assignments?.[0]?.assignedAt), d(t.resolvedAt), d(t.closure?.closedAt),
            t.resolutions?.length ?? 0, t.dueDate < now && !NOT_OVERDUE_TICKET_STATUSES.includes(t.status) ? "Yes" : "No",
          ])
        ),
      };
    }
    case "departments": {
      if (!reportScope) return null;
      const deptIds = hasPermission(user.role, "report:company") ? undefined : ctx.headed.size && !ctx.managed.size ? [...ctx.headed].map((x) => oid(x)) : undefined;
      const rows = await departmentPerformance(reportScope, deptIds);
      return {
        filename: `department-performance-${stamp}.csv`,
        csv: toCsv(["Department", "Tasks", "Completed", "Open", "Overdue", "Completion rate %"], rows.map((r) => [r.name, r.total, r.completed, r.open, r.overdue, r.completionRate])),
      };
    }
    case "workload": {
      if (!reportScope) return null;
      const rows = await workload(reportScope, 1000);
      return {
        filename: `employee-workload-${stamp}.csv`,
        csv: toCsv(["Employee", "Department", "Open tasks", "In progress", "Overdue", "Completed"], rows.map((r) => [r.name, r.department ?? "", r.open, r.inProgress, r.overdue, r.completed])),
      };
    }
    case "daily-updates": {
      const team = teamFilter(await ctxFor(user));
      const scope: Filter = team ? { $or: [{ user: oid(user.id) }, team] } : { user: oid(user.id) };
      const rows: any[] = await DailyUpdate.find(scope)
        .sort({ date: -1 })
        .limit(20000)
        .populate("user", "name email")
        .populate("department", "name")
        .populate("project", "code name")
        .populate("task", "taskNumber")
        .populate("reviewedBy", "name")
        .lean();
      return {
        filename: `daily-updates-${stamp}.csv`,
        csv: toCsv(
          ["Date", "Employee", "Email", "Department", "Project code", "Project", "Task", "Hours", "Work completed", "Pending work", "Blockers", "Status", "Reviewed by", "Review comment"],
          rows.map((r) => [d(r.date), r.user?.name ?? "", r.user?.email ?? "", r.department?.name ?? "", r.project?.code ?? "", r.project?.name ?? "", r.task?.taskNumber ?? "", r.hoursSpent, r.workCompleted, r.pendingWork, r.blockers, r.status, r.reviewedBy?.name ?? "", r.reviewComment ?? ""])
        ),
      };
    }
  }
}
