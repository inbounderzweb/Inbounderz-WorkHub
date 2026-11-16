import "server-only";
import type { Types } from "mongoose";
import { format, subDays, subMonths } from "date-fns";
import type { z } from "zod";
import type { CurrentUser } from "@/lib/auth/current-user";
import { forbidden, notFound, paginate } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import type { TaskPriority } from "@/lib/constants";
import { getRoleByKey, getRoleMaps } from "@/lib/roles";
import { Department, Project, ProjectMember, Task, Ticket, User, WorkloadSettings } from "@/models";
import type {
  EmployeeWorkloadDTO,
  WorkloadCategory,
  WorkloadDepartmentDTO,
  WorkloadDetailDTO,
  WorkloadEmployeesDTO,
  WorkloadItemDTO,
  WorkloadOverviewDTO,
  WorkloadPeriod,
  WorkloadSettingsDTO,
  WorkloadTrendPointDTO,
} from "@/types/dto";
import type { workloadEmployeesQuerySchema, workloadQuerySchema, workloadSettingsSchema } from "@/lib/validations/workload";
import { iso } from "./mappers";
import { oid } from "./scope";
import { triageDepartmentIds } from "./ticket-access";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * One definition of "how busy is this person", shared by the analytics dashboard and the ticket
 * assignment screen so they always agree.
 *
 *   utilization % = hours the person's active, owned work still needs / working hours in the period
 *
 * - Only OWNED work counts: tasks they own (never ones they merely collaborate on) and tickets assigned to them.
 * - Completed / cancelled work never counts. On-hold and in-review work counts at a configurable weight.
 * - An item with no estimate is counted at `fallbackHours` and the result is flagged as an estimate.
 */

const s = (v: any): string => (v ? String(v._id ?? v) : "");
const round1 = (n: number) => Math.round(n * 10) / 10;

type Bucket = "pending" | "inProgress" | "onHold" | "review";
const TICKET_BUCKET: Record<string, Bucket> = { ASSIGNED: "pending", IN_PROGRESS: "inProgress", ON_HOLD: "onHold", SUBMITTED_FOR_REVIEW: "review" };
const TASK_BUCKET: Record<string, Bucket> = { TODO: "pending", IN_PROGRESS: "inProgress", CHANGES_REQUESTED: "inProgress", ON_HOLD: "onHold", IN_REVIEW: "review" };

export const WORKLOAD_DEFAULTS: WorkloadSettingsDTO = {
  hoursPerDay: 8,
  daysPerWeek: 5,
  moderateFrom: 40,
  highFrom: 70,
  overloadedAbove: 100,
  onHoldWeight: 0.5,
  reviewWeight: 0,
  fallbackHours: 4,
};

export async function loadSettings(): Promise<WorkloadSettingsDTO> {
  const d: any = await WorkloadSettings.findOne({ key: "default" }).lean();
  const out = { ...WORKLOAD_DEFAULTS };
  if (d) for (const k of Object.keys(out) as (keyof WorkloadSettingsDTO)[]) if (typeof d[k] === "number") out[k] = d[k];
  return out;
}

export async function updateSettings(user: CurrentUser, input: z.output<typeof workloadSettingsSchema>): Promise<WorkloadSettingsDTO> {
  if (user.role !== "SUPER_ADMIN") throw forbidden("Only a Super Admin can change workload settings");
  const before = await loadSettings();
  await WorkloadSettings.updateOne({ key: "default" }, { $set: { ...input, updatedBy: oid(user.id) } }, { upsert: true });
  const changes = Object.fromEntries((Object.keys(input) as (keyof typeof input)[]).filter((k) => before[k] !== input[k]).map((k) => [k, { from: before[k], to: input[k] }]));
  await recordAudit({ actorId: user.id, action: "workload.settings", entityType: "WorkloadSettings", summary: `Updated workload settings: ${Object.keys(changes).join(", ") || "no changes"}`, changes });
  return loadSettings();
}

export const periodCapacity = (st: WorkloadSettingsDTO, period: WorkloadPeriod) => st.hoursPerDay * st.daysPerWeek * (period === "month" ? 4 : 1);

export function categorize(items: number, utilization: number, st: WorkloadSettingsDTO): WorkloadCategory {
  if (!items) return "NONE";
  if (utilization > st.overloadedAbove) return "OVERLOADED";
  if (utilization >= st.highFrom) return "HIGH";
  if (utilization >= st.moderateFrom) return "MODERATE";
  return "LOW";
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

export type LoadAcc = {
  items: number; ticketItems: number; taskItems: number;
  pending: number; inProgress: number; onHold: number; review: number;
  overdue: number; unestimated: number; effectiveHours: number; nextDue: Date | null;
};
const blank = (): LoadAcc => ({ items: 0, ticketItems: 0, taskItems: 0, pending: 0, inProgress: 0, onHold: 0, review: 0, overdue: 0, unestimated: 0, effectiveHours: 0, nextDue: null });

const hasEstimate = { $gt: [{ $ifNull: ["$estimatedHours", 0] }, 0] };

/**
 * Per-person load, computed in the database. `asOf` rebuilds the load at a past moment from assignment
 * and completion timestamps (status weights can't be replayed, so every item then counts in full).
 * `project` restricts the count to that project's tasks (tickets don't belong to projects).
 */
export async function accumulateLoads(
  userIds: Types.ObjectId[] | null,
  opts: { project?: Types.ObjectId | null; asOf?: Date; settings?: WorkloadSettingsDTO } = {}
): Promise<Map<string, LoadAcc>> {
  const st = opts.settings ?? (await loadSettings());
  const now = new Date();
  const asOf = opts.asOf;
  const who = userIds ? { $in: userIds } : { $ne: null };
  const out = new Map<string, LoadAcc>();

  const group = (userField: string) => ({
    $group: {
      _id: { u: `$${userField}`, s: asOf ? { $literal: "ASOF" } : "$status" },
      n: { $sum: 1 },
      est: { $sum: { $ifNull: ["$estimatedHours", 0] } },
      none: { $sum: { $cond: [hasEstimate, 0, 1] } },
      over: { $sum: { $cond: [{ $and: [{ $ne: ["$due", null] }, { $lt: ["$due", asOf ?? now] }] }, 1, 0] } },
      next: { $min: { $cond: [{ $gte: ["$due", now] }, "$due", null] } },
    },
  });

  const ticketMatch: any = asOf
    ? { assignee: who, assignedAt: { $lte: asOf }, $or: [
        { status: { $in: Object.keys(TICKET_BUCKET) } },
        { status: "COMPLETED", completedAt: { $gt: asOf } },
        { status: { $in: ["CANCELLED", "REJECTED"] }, updatedAt: { $gt: asOf } },
      ] }
    : { assignee: who, status: { $in: Object.keys(TICKET_BUCKET) } };
  const taskMatch: any = asOf
    ? { owner: who, createdAt: { $lte: asOf }, $or: [
        { status: { $in: Object.keys(TASK_BUCKET) } },
        { status: "COMPLETED", completedAt: { $gt: asOf } },
        { status: "CANCELLED", updatedAt: { $gt: asOf } },
      ] }
    : { owner: who, status: { $in: Object.keys(TASK_BUCKET) } };
  if (opts.project) taskMatch.project = opts.project;

  const [ticketRows, taskRows] = await Promise.all([
    opts.project ? Promise.resolve([]) : Ticket.aggregate([{ $match: ticketMatch }, { $addFields: { due: { $ifNull: ["$expectedCompletion", "$dueDate", null] } } }, group("assignee")]),
    Task.aggregate([{ $match: taskMatch }, { $addFields: { due: { $ifNull: ["$dueDate", null] } } }, group("owner")]),
  ]);

  const fold = (rows: any[], kind: "ticket" | "task") => {
    const map = kind === "ticket" ? TICKET_BUCKET : TASK_BUCKET;
    for (const r of rows) {
      const id = s(r._id.u);
      const a = out.get(id) ?? blank();
      const bucket: Bucket = asOf ? "pending" : map[r._id.s];
      const weight = asOf ? 1 : bucket === "onHold" ? st.onHoldWeight : bucket === "review" ? st.reviewWeight : 1;
      a.items += r.n;
      if (kind === "ticket") a.ticketItems += r.n; else a.taskItems += r.n;
      a[bucket] += r.n;
      a.overdue += r.over;
      a.unestimated += r.none;
      a.effectiveHours += weight * (r.est + r.none * st.fallbackHours);
      if (r.next && (!a.nextDue || r.next < a.nextDue)) a.nextDue = r.next;
      out.set(id, a);
    }
  };
  fold(ticketRows, "ticket");
  fold(taskRows, "task");
  return out;
}

export function finalizeLoad(acc: LoadAcc | undefined, st: WorkloadSettingsDTO, capacityHours: number) {
  const a = acc ?? blank();
  const utilization = capacityHours ? Math.round((a.effectiveHours / capacityHours) * 100) : 0;
  return {
    ...a,
    workloadHours: round1(a.effectiveHours),
    capacityHours,
    availableHours: round1(Math.max(0, capacityHours - a.effectiveHours)),
    utilization,
    estimated: a.unestimated > 0,
    category: categorize(a.items, (a.effectiveHours / (capacityHours || 1)) * 100, st),
  };
}

/* ------------------------------------------------------------------ */
/* Scope & employee rows                                               */
/* ------------------------------------------------------------------ */

const ROLES = ["EMPLOYEE", "TEAM_LEADER", "DEPARTMENT_HEAD"] as const;
const isId = (v: string) => /^[a-f\d]{24}$/i.test(v);

/** Projects a Project Manager may analyse. Super Admins: every project (null). */
async function managedProjectIds(user: CurrentUser): Promise<Types.ObjectId[] | null> {
  if (user.role === "SUPER_ADMIN") return null;
  return (await Project.find({ manager: oid(user.id) }).select("_id").lean()).map((p) => p._id);
}

async function scopedUsers(user: CurrentUser, q: { department?: string; project?: string }) {
  if (user.role !== "SUPER_ADMIN" && !hasPermission(user.role, "ticket:manage")) throw forbidden();
  const roleIds = (await Promise.all(ROLES.map((r) => getRoleByKey(r)))).map((r) => oid(r.id));
  const and: any[] = [{ status: "ACTIVE", role: { $in: roleIds } }];

  const managed = await managedProjectIds(user);
  if (managed) {
    const departments = (await triageDepartmentIds(user)) ?? [];
    const memberIds = managed.length ? (await ProjectMember.find({ project: { $in: managed }, isActive: true }).select("user").lean()).map((m) => m.user) : [];
    and.push({ $or: [{ department: { $in: departments } }, { _id: { $in: memberIds } }] });
  }
  if (q.project && isId(q.project)) {
    if (managed && !managed.some((p) => p.toString() === q.project)) throw forbidden("You can only filter by projects you manage");
    const ids = (await ProjectMember.find({ project: oid(q.project), isActive: true }).select("user").lean()).map((m) => m.user);
    and.push({ _id: { $in: ids } });
  }
  if (q.department && isId(q.department)) and.push({ department: oid(q.department) });
  return User.find({ $and: and }).select("name email avatarUrl designation employeeId department role").sort({ name: 1 }).lean();
}

async function buildRows(user: CurrentUser, q: z.output<typeof workloadQuerySchema>, opts: { includeDepartmentFilter: boolean }) {
  const [st, users] = await Promise.all([loadSettings(), scopedUsers(user, { project: q.project, department: opts.includeDepartmentFilter ? q.department : "" })]);
  const capacity = periodCapacity(st, q.period);
  const project = q.project && isId(q.project) ? oid(q.project) : null;
  const [loads, departments, maps] = await Promise.all([
    accumulateLoads(users.map((u) => u._id), { project, settings: st }),
    Department.find({ _id: { $in: [...new Set(users.map((u) => s(u.department)).filter(Boolean))].map(oid) } }).select("name color").lean(),
    getRoleMaps(),
  ]);
  const deptById = new Map(departments.map((d) => [d._id.toString(), d]));
  const rows: EmployeeWorkloadDTO[] = users.map((u) => {
    const f = finalizeLoad(loads.get(u._id.toString()), st, capacity);
    const d = deptById.get(s(u.department));
    return {
      id: u._id.toString(),
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl ?? "",
      employeeId: u.employeeId,
      designation: u.designation || maps.byId.get(s(u.role))?.name || "",
      department: d ? { id: d._id.toString(), name: d.name, color: (d as any).color ?? "#16a34a" } : null,
      activeItems: f.items,
      ticketItems: f.ticketItems,
      taskItems: f.taskItems,
      pending: f.pending,
      inProgress: f.inProgress,
      onHold: f.onHold,
      review: f.review,
      overdue: f.overdue,
      workloadHours: f.workloadHours,
      unestimatedItems: f.unestimated,
      capacityHours: f.capacityHours,
      availableHours: f.availableHours,
      utilization: f.utilization,
      estimated: f.estimated,
      category: f.category,
      nextDue: iso(f.nextDue),
    };
  });
  return { rows, st, capacity, project };
}

const emptyCounts = (): Record<WorkloadCategory, number> => ({ NONE: 0, LOW: 0, MODERATE: 0, HIGH: 0, OVERLOADED: 0 });
const countBy = (rows: { category: WorkloadCategory }[]) => rows.reduce((c, r) => ((c[r.category] += 1), c), emptyCounts());

/* ------------------------------------------------------------------ */
/* Trend (all aggregation, one pass per collection)                    */
/* ------------------------------------------------------------------ */

async function trend(userIds: Types.ObjectId[], period: WorkloadPeriod, project: Types.ObjectId | null): Promise<WorkloadTrendPointDTO[]> {
  const now = new Date();
  const n = period === "week" ? 8 : 6;
  const bounds: Date[] = Array.from({ length: n + 1 }, (_, i) => (period === "week" ? subDays(now, 7 * (n - i)) : subMonths(now, n - i)));
  // Label each bucket by the day it ends, so the last point reads as "today".
  const pointLabels = bounds.slice(1).map((d) => (period === "week" ? format(d, "d MMM") : format(d, "MMM yy")));

  const acc = (name: string, t: Date, prev: Date) => ({
    [`a${name}`]: { $sum: { $cond: [{ $and: [{ $lte: ["$s", t] }, { $or: [{ $eq: ["$e", null] }, { $gt: ["$e", t] }] }] }, 1, 0] } },
    [`o${name}`]: { $sum: { $cond: [{ $and: [{ $lte: ["$s", t] }, { $or: [{ $eq: ["$e", null] }, { $gt: ["$e", t] }] }, { $ne: ["$due", null] }, { $lt: ["$due", t] }] }, 1, 0] } },
    [`n${name}`]: { $sum: { $cond: [{ $and: [{ $gt: ["$s", prev] }, { $lte: ["$s", t] }] }, 1, 0] } },
    [`c${name}`]: { $sum: { $cond: [{ $and: [{ $eq: ["$done", true] }, { $gt: ["$e", prev] }, { $lte: ["$e", t] }] }, 1, 0] } },
  });
  const group = { $group: { _id: null, ...Object.assign({}, ...bounds.slice(1).map((t, i) => acc(String(i), t, bounds[i]))) } };

  const [tk, ts] = await Promise.all([
    project
      ? Promise.resolve([])
      : Ticket.aggregate([
          { $match: { assignee: { $in: userIds }, assignedAt: { $ne: null, $lte: now }, $or: [{ status: { $nin: ["COMPLETED", "CANCELLED", "REJECTED"] } }, { updatedAt: { $gt: bounds[0] } }] } },
          { $project: { s: "$assignedAt", due: { $ifNull: ["$expectedCompletion", "$dueDate", null] }, done: { $eq: ["$status", "COMPLETED"] },
              e: { $cond: [{ $eq: ["$status", "COMPLETED"] }, { $ifNull: ["$completedAt", "$updatedAt"] }, { $cond: [{ $in: ["$status", ["CANCELLED", "REJECTED"]] }, "$updatedAt", null] }] } } },
          group,
        ]),
    Task.aggregate([
      { $match: { owner: { $in: userIds }, status: { $ne: "BACKLOG" }, ...(project ? { project } : {}), $or: [{ status: { $nin: ["COMPLETED", "CANCELLED"] } }, { updatedAt: { $gt: bounds[0] } }] } },
      { $project: { s: "$createdAt", due: { $ifNull: ["$dueDate", null] }, done: { $eq: ["$status", "COMPLETED"] },
          e: { $cond: [{ $eq: ["$status", "COMPLETED"] }, { $ifNull: ["$completedAt", "$updatedAt"] }, { $cond: [{ $eq: ["$status", "CANCELLED"] }, "$updatedAt", null] }] } } },
      group,
    ]),
  ]);
  const a: any = tk[0] ?? {};
  const b: any = ts[0] ?? {};
  return pointLabels.map((label, i) => ({
    label,
    active: (a[`a${i}`] ?? 0) + (b[`a${i}`] ?? 0),
    assigned: (a[`n${i}`] ?? 0) + (b[`n${i}`] ?? 0),
    completed: (a[`c${i}`] ?? 0) + (b[`c${i}`] ?? 0),
    overdue: (a[`o${i}`] ?? 0) + (b[`o${i}`] ?? 0),
  }));
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function workloadOverview(user: CurrentUser, q: z.output<typeof workloadQuerySchema>): Promise<WorkloadOverviewDTO> {
  const { rows: all, st, capacity, project } = await buildRows(user, q, { includeDepartmentFilter: false });
  const rows = q.department && isId(q.department) ? all.filter((r) => r.department?.id === q.department) : all;

  const prevAt = q.period === "week" ? subDays(new Date(), 7) : subMonths(new Date(), 1);
  const prevLoads = rows.length ? await accumulateLoads(rows.map((r) => oid(r.id)), { project, asOf: prevAt, settings: st }) : new Map();
  const prevRows = rows.map((r) => ({ category: finalizeLoad(prevLoads.get(r.id), st, capacity).category }));

  const byDept = new Map<string, EmployeeWorkloadDTO[]>();
  for (const r of all) byDept.set(r.department?.id ?? "none", [...(byDept.get(r.department?.id ?? "none") ?? []), r]);
  const departments: WorkloadDepartmentDTO[] = [...byDept.entries()]
    .map(([id, list]) => {
      const counts = countBy(list);
      return {
        id,
        name: list[0].department?.name ?? "No department",
        employees: list.length,
        none: counts.NONE,
        occupied: list.length - counts.NONE,
        overloaded: counts.OVERLOADED,
        avgUtilization: Math.round(list.reduce((n, r) => n + r.utilization, 0) / list.length),
        counts,
      };
    })
    .sort((x, y) => y.avgUtilization - x.avgUtilization);

  const managed = await managedProjectIds(user);
  const projects = await Project.find({ ...(managed ? { _id: { $in: managed } } : {}), status: { $nin: ["COMPLETED", "CANCELLED"] }, isArchived: { $ne: true } }).select("name").sort({ name: 1 }).limit(300).lean();

  return {
    period: q.period,
    capacityHours: capacity,
    settings: st,
    canConfigure: user.role === "SUPER_ADMIN",
    total: rows.length,
    counts: countBy(rows),
    previous: rows.length ? countBy(prevRows) : null,
    previousTotal: rows.length,
    departments,
    trend: rows.length ? await trend(rows.map((r) => oid(r.id)), q.period, project) : [],
    filters: {
      departments: departments.filter((d) => d.id !== "none").map((d) => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name)),
      projects: projects.map((p) => ({ id: p._id.toString(), name: p.name })),
    },
  };
}

export async function workloadEmployees(user: CurrentUser, q: z.output<typeof workloadEmployeesQuerySchema>): Promise<WorkloadEmployeesDTO> {
  const { rows } = await buildRows(user, q, { includeDepartmentFilter: true });
  const rx = q.q.toLowerCase();
  const list = rows
    .filter((r) => (!q.status || r.category === q.status) && (!rx || [r.name, r.email, r.employeeId].some((v) => v.toLowerCase().includes(rx))))
    .sort((a, b) => {
      switch (q.sort) {
        case "lowest": return a.utilization - b.utilization || a.name.localeCompare(b.name);
        case "available": return b.availableHours - a.availableHours || a.name.localeCompare(b.name);
        case "overdue": return b.overdue - a.overdue || b.utilization - a.utilization;
        default: return b.utilization - a.utilization || a.name.localeCompare(b.name);
      }
    });
  const page = paginate(list.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), list.length, q.page, q.pageSize);
  return { ...page, chart: list.slice(0, 15) };
}

export async function employeeWorkloadDetail(user: CurrentUser, id: string, period: WorkloadPeriod): Promise<WorkloadDetailDTO> {
  const target: any = await User.findById(id).select("department").lean();
  if (!target) throw notFound("Employee not found");
  // Project Managers / Super Admins by scope; a Department Head may open people in the department they head.
  const inScope = hasPermission(user.role, "ticket:manage") || user.role === "SUPER_ADMIN"
    ? (await scopedUsers(user, {})).some((u) => u._id.toString() === id)
    : false;
  const headed = !inScope && !!target.department && !!(await Department.exists({ _id: target.department, head: oid(user.id) }));
  if (!inScope && !headed) throw notFound("Employee not found");

  const st = await loadSettings();
  const capacity = periodCapacity(st, period);
  const [loads, maps, dept, tickets, tasks, doneTickets, doneTasks] = await Promise.all([
    accumulateLoads([oid(id)], { settings: st }),
    getRoleMaps(),
    target.department ? Department.findById(target.department).select("name color").lean() : null,
    Ticket.find({ assignee: oid(id), status: { $in: Object.keys(TICKET_BUCKET) as never[] } }).select("ticketNumber title priority status estimatedHours dueDate expectedCompletion").lean(),
    Task.find({ owner: oid(id), status: { $in: Object.keys(TASK_BUCKET) as never[] } }).select("taskNumber title priority status estimatedHours dueDate project").populate("project", "name").lean(),
    Ticket.countDocuments({ assignee: oid(id), status: "COMPLETED", completedAt: { $gte: subDays(new Date(), 30) } }),
    Task.countDocuments({ owner: oid(id), status: "COMPLETED", completedAt: { $gte: subDays(new Date(), 30) } }),
  ]);
  const person: any = await User.findById(id).select("name email avatarUrl designation employeeId role").lean();
  const f = finalizeLoad(loads.get(id), st, capacity);
  const now = Date.now();

  const toItem = (kind: "TICKET" | "TASK", d: any): WorkloadItemDTO => {
    const status = d.status as string;
    const bucket = (kind === "TICKET" ? TICKET_BUCKET : TASK_BUCKET)[status];
    const weight = bucket === "onHold" ? st.onHoldWeight : bucket === "review" ? st.reviewWeight : 1;
    const est = d.estimatedHours && d.estimatedHours > 0 ? d.estimatedHours : null;
    const counted = round1(weight * (est ?? st.fallbackHours));
    const due: Date | null = (kind === "TICKET" ? (d.expectedCompletion ?? d.dueDate) : d.dueDate) ?? null;
    return {
      type: kind,
      id: d._id.toString(),
      number: kind === "TICKET" ? d.ticketNumber : d.taskNumber,
      title: d.title,
      priority: d.priority,
      status,
      estimatedHours: est,
      countedHours: counted,
      share: capacity ? Math.round((counted / capacity) * 100) : 0,
      dueDate: iso(due),
      overdue: !!due && due.getTime() < now,
      project: kind === "TASK" ? (d.project?.name ?? null) : null,
      link: kind === "TICKET" ? `/tickets/${d._id}` : `/tasks/${d._id}`,
    };
  };
  const items = [...tickets.map((t) => toItem("TICKET", t)), ...tasks.map((t) => toItem("TASK", t))].sort((a, b) => b.countedHours - a.countedHours);
  const priorities: Record<TaskPriority, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };
  for (const i of items) priorities[i.priority] += 1;
  const horizon = now + 14 * 86_400_000;

  return {
    employee: {
      id,
      name: person.name,
      email: person.email,
      avatarUrl: person.avatarUrl ?? "",
      employeeId: person.employeeId,
      designation: person.designation || maps.byId.get(s(person.role))?.name || "",
      department: dept ? { id: (dept as any)._id.toString(), name: (dept as any).name, color: (dept as any).color ?? "#16a34a" } : null,
      activeItems: f.items,
      ticketItems: f.ticketItems,
      taskItems: f.taskItems,
      pending: f.pending,
      inProgress: f.inProgress,
      onHold: f.onHold,
      review: f.review,
      overdue: f.overdue,
      workloadHours: f.workloadHours,
      unestimatedItems: f.unestimated,
      capacityHours: f.capacityHours,
      availableHours: f.availableHours,
      utilization: f.utilization,
      estimated: f.estimated,
      category: f.category,
      nextDue: iso(f.nextDue),
    },
    items,
    priorities,
    upcoming: items.filter((i) => i.dueDate && !i.overdue && new Date(i.dueDate).getTime() <= horizon).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)).slice(0, 6),
    completedLast30Days: doneTickets + doneTasks,
  };
}

