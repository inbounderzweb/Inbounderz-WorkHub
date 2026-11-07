import "server-only";
import type { Types } from "mongoose";
import { addDays, startOfMonth } from "date-fns";
import { utcDayRange } from "@/lib/dates";
import type { CurrentUser } from "@/lib/auth/current-user";
import {
  CLOSED_TASK_STATUSES,
  OPEN_TASK_STATUSES,
  TASK_STATUSES,
  type ProjectStatus,
  type TaskStatus,
} from "@/lib/constants";
import { AuditLog, Department, Notification, Project, Task, User } from "@/models";
import type { ActivityDTO, NotificationDTO, TaskSummaryDTO, TicketListItemDTO } from "@/types/dto";
import { departmentTicketQueue, myOpenTickets, ticketIntakeQueue } from "./ticket.service";
import { dedupe, headedDepartmentIds, ledDepartmentIds, oid, type Filter } from "./scope";
import { accessContext } from "./access";
import { EMPTY_PROGRESS, progressFor } from "./progress.service";
import { iso, toTaskSummary, toUserRef, USER_REF_FIELDS } from "./mappers";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type StatusCount = { status: TaskStatus; count: number };

export type DepartmentPerformance = {
  id: string;
  name: string;
  code: string;
  color: string;
  employees: number;
  total: number;
  completed: number;
  open: number;
  overdue: number;
  completionRate: number;
};

export type ProjectProgress = {
  id: string;
  name: string;
  code: string;
  status: ProjectStatus;
  endDate: string | null;
  totalTasks: number;
  completedTasks: number;
  openTasks: number;
  progress: number;
};

export type WorkloadRow = { id: string; name: string; open: number; inProgress: number; inReview: number; overdue: number };

export type AdminDashboard = {
  kind: "admin";
  stats: {
    employees: number;
    activeEmployees: number;
    departments: number;
    activeProjects: number;
    totalTasks: number;
    pendingTasks: number;
    overdueTasks: number;
    inReview: number;
  };
  tasksByStatus: StatusCount[];
  departmentPerformance: DepartmentPerformance[];
  recentActivity: ActivityDTO[];
  upcomingDeadlines: TaskSummaryDTO[];
  ticketQueue: TicketQueue;
};

export type TicketQueue = { items: TicketListItemDTO[]; total: number };

export type ManagerDashboard = {
  kind: "manager";
  stats: {
    managedProjects: number;
    pendingTasks: number;
    awaitingReview: number;
    upcomingDeadlines: number;
    overdueTasks: number;
  };
  projects: ProjectProgress[];
  reviewQueue: TaskSummaryDTO[];
  deadlines: TaskSummaryDTO[];
  tasksByStatus: StatusCount[];
  ticketQueue: TicketQueue;
};

export type TeamDashboard = {
  kind: "team";
  scope: "department" | "team";
  departments: { id: string; name: string }[];
  stats: {
    employees: number;
    activeTasks: number;
    pendingReviews: number;
    overdueTasks: number;
    completedThisMonth: number;
  };
  workload: WorkloadRow[];
  reviewQueue: TaskSummaryDTO[];
  overdue: TaskSummaryDTO[];
  tasksByStatus: StatusCount[];
  /** Open requests sent to departments the user heads (Department Heads only). */
  departmentTickets: TicketQueue;
};

export type EmployeeDashboard = {
  kind: "employee";
  stats: { myOpenTasks: number; dueToday: number; inProgress: number; completed: number; overdue: number };
  todaysDeadlines: TaskSummaryDTO[];
  myTasks: TaskSummaryDTO[];
  notifications: NotificationDTO[];
  myTickets: TicketListItemDTO[];
};

export type DashboardData = AdminDashboard | ManagerDashboard | TeamDashboard | EmployeeDashboard;

const populateTask = (q: any) =>
  q.populate("owner", USER_REF_FIELDS).populate("project", "name code").populate("linkedTicket", "ticketNumber").lean();

async function tasksByStatus(match: Filter): Promise<StatusCount[]> {
  const rows = await Task.aggregate<{ _id: TaskStatus; n: number }>([
    { $match: match },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  const map = new Map(rows.map((r) => [r._id, r.n]));
  return TASK_STATUSES.map((status) => ({ status, count: map.get(status) ?? 0 }));
}

const overdueFilter = () => ({ status: { $nin: CLOSED_TASK_STATUSES }, dueDate: { $lt: new Date() } });

/* ------------------------------------------------------------------ */

async function adminDashboard(user: CurrentUser): Promise<AdminDashboard> {
  const now = new Date();
  const [
    employees,
    activeEmployees,
    departments,
    activeProjects,
    totalTasks,
    pendingTasks,
    overdueTasks,
    inReview,
    statusCounts,
    perf,
    deptRows,
    empByDept,
    activity,
    upcoming,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ status: "ACTIVE" }),
    Department.countDocuments({ status: "ACTIVE" }),
    Project.countDocuments({ status: "ACTIVE" }),
    Task.countDocuments(),
    Task.countDocuments({ status: { $in: OPEN_TASK_STATUSES } }),
    Task.countDocuments(overdueFilter()),
    Task.countDocuments({ status: "IN_REVIEW" }),
    tasksByStatus({}),
    Task.aggregate<{ _id: Types.ObjectId; total: number; completed: number; cancelled: number; open: number; overdue: number }>([
      { $match: { department: { $ne: null } } },
      {
        $group: {
          _id: "$department",
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
          open: { $sum: { $cond: [{ $in: ["$status", OPEN_TASK_STATUSES] }, 1, 0] } },
          overdue: {
            $sum: {
              $cond: [
                { $and: [{ $in: ["$status", OPEN_TASK_STATUSES] }, { $ne: ["$dueDate", null] }, { $lt: ["$dueDate", now] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    Department.find({ status: "ACTIVE" }).select("name code color").sort({ name: 1 }).lean(),
    User.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { department: { $ne: null }, status: "ACTIVE" } },
      { $group: { _id: "$department", n: { $sum: 1 } } },
    ]),
    AuditLog.find({ action: { $nin: ["auth.login"] } })
      .sort({ createdAt: -1 })
      .limit(12)
      .populate("actor", USER_REF_FIELDS)
      .lean(),
    populateTask(
      Task.find({ status: { $in: OPEN_TASK_STATUSES }, dueDate: { $gte: now, $lte: addDays(now, 7) } })
        .sort({ dueDate: 1 })
        .limit(8)
    ),
  ]);

  const perfMap = new Map(perf.map((p) => [p._id.toString(), p]));
  const empMap = new Map(empByDept.map((e) => [e._id.toString(), e.n]));

  return {
    kind: "admin",
    stats: { employees, activeEmployees, departments, activeProjects, totalTasks, pendingTasks, overdueTasks, inReview },
    tasksByStatus: statusCounts,
    departmentPerformance: deptRows.map((d) => {
      const p = perfMap.get(d._id.toString());
      const effective = (p?.total ?? 0) - (p?.cancelled ?? 0);
      return {
        id: d._id.toString(),
        name: d.name,
        code: d.code,
        color: d.color ?? "#16a34a",
        employees: empMap.get(d._id.toString()) ?? 0,
        total: p?.total ?? 0,
        completed: p?.completed ?? 0,
        open: p?.open ?? 0,
        overdue: p?.overdue ?? 0,
        completionRate: effective > 0 ? Math.round(((p?.completed ?? 0) / effective) * 100) : 0,
      };
    }),
    recentActivity: activity.map(toActivity),
    upcomingDeadlines: (upcoming as any[]).map(toTaskSummary),
    ticketQueue: await ticketIntakeQueue(user),
  };
}

export function toActivity(a: any): ActivityDTO {
  return {
    id: a._id.toString(),
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId ? a.entityId.toString() : null,
    summary: a.summary ?? "",
    changes: a.changes ?? null,
    actor: toUserRef(a.actor),
    createdAt: iso(a.createdAt)!,
  };
}

/* ------------------------------------------------------------------ */

async function projectProgress(projectIds: Types.ObjectId[]): Promise<ProjectProgress[]> {
  const projects = await Project.find({ _id: { $in: projectIds }, status: { $nin: ["CANCELLED"] }, isArchived: { $ne: true } })
    .sort({ status: 1, endDate: 1 })
    .limit(12)
    .select("name code status endDate")
    .lean();
  const stats = await progressFor(projects.map((p) => p._id));
  return projects.map((p) => {
    const st = stats.get(p._id.toString()) ?? EMPTY_PROGRESS;
    return {
      id: p._id.toString(),
      name: p.name,
      code: p.code,
      status: p.status as ProjectStatus,
      endDate: iso(p.endDate),
      totalTasks: st.total - st.cancelled,
      completedTasks: st.completed,
      openTasks: st.total - st.cancelled - st.completed,
      progress: st.percent,
    };
  });
}

async function managerDashboard(user: CurrentUser): Promise<ManagerDashboard> {
  const ctx = await accessContext(user);
  const projectIds = [...ctx.managed].map((id) => oid(id));
  const now = new Date();
  const inProjects = { project: { $in: projectIds } };
  const reviewScope = inProjects;

  const [pendingTasks, awaitingReview, upcomingCount, overdueTasks, projects, review, deadlines, statusCounts] =
    await Promise.all([
      Task.countDocuments({ ...inProjects, status: { $in: OPEN_TASK_STATUSES } }),
      Task.countDocuments({ ...reviewScope, status: "IN_REVIEW" }),
      Task.countDocuments({ ...inProjects, status: { $in: OPEN_TASK_STATUSES }, dueDate: { $gte: now, $lte: addDays(now, 7) } }),
      Task.countDocuments({ ...inProjects, ...overdueFilter() }),
      projectProgress(projectIds),
      populateTask(Task.find({ ...reviewScope, status: "IN_REVIEW" }).sort({ updatedAt: -1 }).limit(8)),
      populateTask(
        Task.find({ ...inProjects, status: { $in: OPEN_TASK_STATUSES }, dueDate: { $ne: null, $lte: addDays(now, 7) } })
          .sort({ dueDate: 1 })
          .limit(8)
      ),
      tasksByStatus(inProjects),
    ]);

  return {
    kind: "manager",
    stats: { managedProjects: projectIds.length, pendingTasks, awaitingReview, upcomingDeadlines: upcomingCount, overdueTasks },
    projects,
    reviewQueue: (review as any[]).map(toTaskSummary),
    deadlines: (deadlines as any[]).map(toTaskSummary),
    tasksByStatus: statusCounts,
    ticketQueue: await ticketIntakeQueue(user),
  };
}

/* ------------------------------------------------------------------ */

async function teamDashboard(user: CurrentUser): Promise<TeamDashboard> {
  const isHead = user.role === "DEPARTMENT_HEAD";
  const deptIds = isHead ? await headedDepartmentIds(user.id) : await ledDepartmentIds(user.id);

  // Team = members of my departments (+ my direct reports), excluding me.
  const self = oid(user.id);
  const members = await User.find({
    _id: { $ne: self },
    $or: [{ department: { $in: deptIds } }, { reportingManager: self }],
  })
    .select("name status")
    .sort({ name: 1 })
    .lean();
  const memberIds = dedupe(members.map((m) => m._id));

  const scope: Filter = {
    $or: [{ department: { $in: deptIds } }, { owner: { $in: memberIds } }],
  };
  const now = new Date();

  const [departments, activeTasks, pendingReviews, overdueTasks, completedThisMonth, workloadRows, review, overdue, statusCounts] =
    await Promise.all([
      Department.find({ _id: { $in: deptIds } }).select("name").sort({ name: 1 }).lean(),
      Task.countDocuments({ ...scope, status: { $in: OPEN_TASK_STATUSES } }),
      Task.countDocuments({ ...scope, status: "IN_REVIEW" }),
      Task.countDocuments({ ...scope, ...overdueFilter() }),
      Task.countDocuments({ ...scope, status: "COMPLETED", completedAt: { $gte: startOfMonth(now) } }),
      Task.aggregate<{ _id: Types.ObjectId; open: number; inProgress: number; inReview: number; overdue: number }>([
        { $match: { owner: { $in: memberIds }, status: { $in: OPEN_TASK_STATUSES } } },
        {
          $group: {
            _id: "$owner",
            open: { $sum: 1 },
            inProgress: { $sum: { $cond: [{ $eq: ["$status", "IN_PROGRESS"] }, 1, 0] } },
            inReview: { $sum: { $cond: [{ $eq: ["$status", "IN_REVIEW"] }, 1, 0] } },
            overdue: {
              $sum: { $cond: [{ $and: [{ $ne: ["$dueDate", null] }, { $lt: ["$dueDate", now] }] }, 1, 0] },
            },
          },
        },
      ]),
      populateTask(Task.find({ ...scope, status: "IN_REVIEW" }).sort({ updatedAt: -1 }).limit(8)),
      populateTask(Task.find({ ...scope, ...overdueFilter() }).sort({ dueDate: 1 }).limit(8)),
      tasksByStatus(scope),
    ]);

  const wl = new Map(workloadRows.map((w) => [w._id.toString(), w]));
  const workload = members
    .filter((m) => m.status === "ACTIVE")
    .map((m) => {
      const w = wl.get(m._id.toString());
      return {
        id: m._id.toString(),
        name: m.name,
        open: w?.open ?? 0,
        inProgress: w?.inProgress ?? 0,
        inReview: w?.inReview ?? 0,
        overdue: w?.overdue ?? 0,
      };
    })
    .sort((a, b) => b.open - a.open)
    .slice(0, 12);

  return {
    kind: "team",
    scope: isHead ? "department" : "team",
    departments: departments.map((d) => ({ id: d._id.toString(), name: d.name })),
    stats: {
      employees: members.filter((m) => m.status === "ACTIVE").length,
      activeTasks,
      pendingReviews,
      overdueTasks,
      completedThisMonth,
    },
    workload,
    reviewQueue: (review as any[]).map(toTaskSummary),
    overdue: (overdue as any[]).map(toTaskSummary),
    tasksByStatus: statusCounts,
    departmentTickets: isHead ? await departmentTicketQueue(user) : { items: [], total: 0 },
  };
}

/* ------------------------------------------------------------------ */

export function toNotificationDTO(n: any): NotificationDTO {
  return {
    id: n._id.toString(),
    type: n.type,
    title: n.title,
    message: n.message ?? "",
    link: n.link ?? "",
    isRead: !!n.isRead,
    createdAt: iso(n.createdAt)!,
    actor: toUserRef(n.actor),
  };
}

async function employeeDashboard(user: CurrentUser): Promise<EmployeeDashboard> {
  const self = oid(user.id);
  const mine = { $or: [{ owner: self }, { collaborators: self }] };
  const now = new Date();
  const today = utcDayRange(now);

  const [myOpenTasks, dueToday, inProgress, completed, overdue, todays, myTasks, notifications] = await Promise.all([
    Task.countDocuments({ ...mine, status: { $in: OPEN_TASK_STATUSES } }),
    Task.countDocuments({ ...mine, status: { $in: OPEN_TASK_STATUSES }, dueDate: today }),
    Task.countDocuments({ ...mine, status: "IN_PROGRESS" }),
    Task.countDocuments({ ...mine, status: "COMPLETED" }),
    Task.countDocuments({ ...mine, ...overdueFilter() }),
    populateTask(Task.find({ ...mine, status: { $in: OPEN_TASK_STATUSES }, dueDate: today }).sort({ dueDate: 1 }).limit(10)),
    populateTask(
      Task.find({ ...mine, status: { $in: OPEN_TASK_STATUSES } })
        .sort({ dueDate: 1, updatedAt: -1 })
        .limit(10)
    ),
    Notification.find({ recipient: self }).sort({ createdAt: -1 }).limit(6).populate("actor", USER_REF_FIELDS).lean(),
  ]);

  return {
    kind: "employee",
    stats: { myOpenTasks, dueToday, inProgress, completed, overdue },
    todaysDeadlines: (todays as any[]).map(toTaskSummary),
    myTasks: (myTasks as any[]).map(toTaskSummary),
    notifications: notifications.map(toNotificationDTO),
    myTickets: await myOpenTickets(user),
  };
}

export async function getDashboard(user: CurrentUser): Promise<DashboardData> {
  switch (user.role) {
    case "SUPER_ADMIN":
      return adminDashboard(user);
    case "PROJECT_MANAGER":
      return managerDashboard(user);
    case "DEPARTMENT_HEAD":
    case "TEAM_LEADER":
      return teamDashboard(user);
    default:
      return employeeDashboard(user);
  }
}
