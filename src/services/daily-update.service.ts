import "server-only";
import type { Types } from "mongoose";
import type { z } from "zod";
import { addDays, format, startOfWeek } from "date-fns";
import type { CurrentUser } from "@/lib/auth/current-user";
import { conflict, escapeRegex, forbidden, notFound, paginate, unprocessable } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { hasPermission } from "@/lib/permissions";
import { getSystemSettings } from "@/lib/settings";
import { todayIn } from "@/lib/settings-types";
import { CLOSED_TASK_STATUSES } from "@/lib/constants";
import type {
  createDailyUpdateSchema,
  dailySummaryQuerySchema,
  dailyUpdateListQuerySchema,
  reviewDailyUpdateSchema,
  updateDailyUpdateSchema,
} from "@/lib/validations/daily-update";
import { Attachment, DailyUpdate, Department, Project, Role, Task, User } from "@/models";
import type { DailySummaryDTO, DailyUpdateDetailDTO, DailyUpdateDTO, Paginated } from "@/types/dto";
import { canReview, canView, ctxFor, isAuthor, teamFilter, type Access } from "./daily-update-access";
import { toAttachmentDTO } from "./attachment.service";
import { DEPT_REF_FIELDS, iso, toDepartmentRef, toUserRef, USER_REF_FIELDS } from "./mappers";
import { oid, type Filter } from "./scope";

/* eslint-disable @typescript-eslint/no-explicit-any */

type CreateInput = z.output<typeof createDailyUpdateSchema>;
type UpdateInput = z.output<typeof updateDailyUpdateSchema>;
type ReviewInput = z.output<typeof reviewDailyUpdateSchema>;
type ListQuery = z.output<typeof dailyUpdateListQuerySchema>;
type SummaryQuery = z.output<typeof dailySummaryQuerySchema>;

const sid = (v: unknown): string =>
  !v ? "" : typeof v === "object" && "_id" in (v as object) ? String((v as { _id: unknown })._id) : String(v);
const isId = (v: string) => /^[a-f\d]{24}$/i.test(v);
const toDay = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dayStr = (d: Date) => d.toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* One-time index migration                                            */
/* ------------------------------------------------------------------ */

let migrated = false;
/** The original (unused) schema had a unique {user, date} index that would block several reports per day. */
async function dropLegacyIndex() {
  if (migrated) return;
  migrated = true;
  try {
    const idx = await DailyUpdate.collection.indexes();
    if (idx.some((i) => i.name === "user_1_date_-1" && i.unique)) await DailyUpdate.collection.dropIndex("user_1_date_-1");
  } catch {
    /* collection may not exist yet */
  }
}

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

/** People who should review a report by this author. */
async function reviewersFor(authorId: string, departmentId: unknown): Promise<string[]> {
  if (!departmentId) return [];
  const dept = await Department.findById(departmentId).select("head teamLeaders").lean();
  const ids = [sid(dept?.head)];
  // Team Leaders review only when an administrator granted them the permission.
  if (hasPermission("TEAM_LEADER", "daily-update:review")) ids.push(...(dept?.teamLeaders ?? []).map(String));
  const list = [...new Set(ids.filter(Boolean))].filter((x) => x !== authorId);
  if (list.length) return list;
  // The department head's own reports go to the Super Admins.
  const sa = await Role.findOne({ key: "SUPER_ADMIN" }).select("_id").lean();
  const admins = sa ? await User.find({ role: sa._id, status: "ACTIVE" }).select("_id").lean() : [];
  return admins.map((a) => a._id.toString()).filter((x) => x !== authorId);
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

const POPULATE = (q: any) =>
  q
    .populate("user", USER_REF_FIELDS)
    .populate("department", DEPT_REF_FIELDS)
    .populate("project", "name code")
    .populate("task", "taskNumber title")
    .populate("reviewedBy", USER_REF_FIELDS)
    .lean();

function toDTO(r: any, c: Access, attachmentCount = 0): DailyUpdateDTO {
  const author = isAuthor(c, r);
  return {
    id: r._id.toString(),
    date: dayStr(r.date),
    user: toUserRef(r.user),
    department: toDepartmentRef(r.department),
    project: r.project && "name" in r.project ? { id: r.project._id.toString(), name: r.project.name, code: r.project.code } : null,
    task: r.task && "taskNumber" in r.task ? { id: r.task._id.toString(), taskNumber: r.task.taskNumber, title: r.task.title } : null,
    workCompleted: r.workCompleted,
    pendingWork: r.pendingWork ?? "",
    blockers: r.blockers ?? "",
    hoursSpent: r.hoursSpent,
    status: r.status,
    revision: r.revision ?? 1,
    submittedAt: iso(r.submittedAt ?? r.createdAt)!,
    updatedAt: iso(r.updatedAt)!,
    reviewedBy: toUserRef(r.reviewedBy),
    reviewedAt: iso(r.reviewedAt),
    reviewComment: r.reviewComment ?? "",
    attachmentCount,
    can: {
      edit: author && r.status !== "APPROVED",
      delete: author && r.status === "SUBMITTED" && !r.reviewedAt,
      review: r.status === "SUBMITTED" && canReview(c, r),
    },
  };
}

async function attachmentCounts(ids: Types.ObjectId[]) {
  const rows = await Attachment.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { entityType: "DailyUpdate", entityId: { $in: ids } } },
    { $group: { _id: "$entityId", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.n]));
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

async function assertDateAllowed(date: string) {
  const s = await getSystemSettings();
  const today = todayIn(s.company.timezone);
  if (date > today) throw unprocessable("You can't report work for a future date", { date: "Choose today or an earlier date" });
  const earliest = format(addDays(toDay(today), -s.dailyUpdates.backdateDays), "yyyy-MM-dd");
  if (date < earliest) {
    throw unprocessable(`Reports can be submitted for the last ${s.dailyUpdates.backdateDays} day(s) only`, { date: `Earliest allowed date is ${earliest}` });
  }
}

async function assertHoursWithinDay(userId: string, date: Date, hours: number, excludeId?: Types.ObjectId) {
  const s = await getSystemSettings();
  const [row] = await DailyUpdate.aggregate<{ total: number }>([
    { $match: { user: oid(userId), date, ...(excludeId ? { _id: { $ne: excludeId } } : {}) } },
    { $group: { _id: null, total: { $sum: "$hoursSpent" } } },
  ]);
  const total = (row?.total ?? 0) + hours;
  if (total > s.dailyUpdates.maxHoursPerDay) {
    throw unprocessable(`That would make ${total} h on ${dayStr(date)}; the daily maximum is ${s.dailyUpdates.maxHoursPerDay} h`, { hoursSpent: "Too many hours for this day" });
  }
}

async function load(user: CurrentUser, id: string) {
  const c = await ctxFor(user);
  const r = await DailyUpdate.findById(id).lean();
  if (!r || !canView(c, r)) throw notFound("Report not found");
  return { c, r };
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export async function createDailyUpdate(user: CurrentUser, input: CreateInput): Promise<{ id: string }> {
  if (!hasPermission(user.role, "daily-update:submit")) throw forbidden();
  await dropLegacyIndex();
  await assertDateAllowed(input.date);
  const c = await ctxFor(user);

  const project = await Project.findById(input.project).select("name isArchived").lean();
  if (!project) throw unprocessable("Project not found", { project: "Project not found" });
  if (!c.isAdmin && !c.memberOf.has(project._id.toString()) && !c.managed.has(project._id.toString())) {
    throw unprocessable("You can only report work on projects you're allocated to", { project: "Not on this project's team" });
  }
  if (project.isArchived) throw unprocessable("This project is archived", { project: "Project is archived" });

  let taskId: Types.ObjectId | null = null;
  if (input.task) {
    const task = await Task.findById(input.task).select("project owner collaborators").lean();
    if (!task || sid(task.project) !== project._id.toString()) throw unprocessable("Task not found in this project", { task: "Choose a task from the selected project" });
    const mine = sid(task.owner) === user.id || (task.collaborators ?? []).some((x) => x.toString() === user.id);
    if (!mine && !c.isAdmin && !c.managed.has(project._id.toString())) throw unprocessable("You can only report on tasks you work on", { task: "Not your task" });
    taskId = task._id;
  }

  const date = toDay(input.date);
  const existing = await DailyUpdate.findOne({ user: oid(user.id), date, project: project._id, task: taskId }).select("_id").lean();
  const duplicate = () =>
    conflict("You already submitted a report for this work item on this date. Open it and edit it instead.", {
      [taskId ? "task" : "project"]: "Already reported for this date",
      existingId: existing?._id.toString() ?? "",
    });
  if (existing) throw duplicate();
  await assertHoursWithinDay(user.id, date, input.hoursSpent);

  const now = new Date();
  let doc;
  try {
    doc = await DailyUpdate.create({
      user: oid(user.id),
      department: user.departmentId ? oid(user.departmentId) : null,
      date,
      project: project._id,
      task: taskId,
      workCompleted: input.workCompleted,
      pendingWork: input.pendingWork,
      blockers: input.blockers,
      hoursSpent: input.hoursSpent,
      status: "SUBMITTED",
      submittedAt: now,
      history: [{ action: "SUBMITTED", by: oid(user.id), at: now }],
    });
  } catch (err: any) {
    if (err?.code === 11000) throw duplicate(); // submitted twice at the same moment
    throw err;
  }

  await notify({
    recipients: await reviewersFor(user.id, doc.department),
    actorId: user.id,
    type: "DAILY_UPDATE",
    pref: "daily_update",
    title: "Daily report submitted",
    message: `${user.name} · ${input.date} · ${project.name} · ${input.hoursSpent} h${input.blockers ? " · has blockers" : ""}`,
    link: `/daily-updates?report=${doc._id}`,
    entityType: "DailyUpdate",
    entityId: doc._id,
  });
  return { id: doc._id.toString() };
}

export async function updateDailyUpdate(user: CurrentUser, id: string, input: UpdateInput): Promise<void> {
  const { c, r } = await load(user, id);
  if (!isAuthor(c, r)) throw forbidden("Only the author can edit a report");
  if (r.status === "APPROVED") throw unprocessable("Approved reports are locked. Ask your reviewer if something needs correcting.");
  const set: Record<string, unknown> = {};
  for (const f of ["workCompleted", "pendingWork", "blockers", "hoursSpent"] as const) {
    if (input[f] !== undefined && input[f] !== (r as any)[f]) set[f] = input[f];
  }
  if (!Object.keys(set).length && r.status !== "CHANGES_REQUESTED") return;
  if (set.hoursSpent !== undefined) await assertHoursWithinDay(user.id, r.date, set.hoursSpent as number, r._id);

  const resubmit = r.status === "CHANGES_REQUESTED";
  const now = new Date();
  const res = await DailyUpdate.updateOne(
    { _id: r._id, status: r.status, updatedAt: r.updatedAt },
    {
      $set: { ...set, ...(resubmit ? { status: "SUBMITTED", submittedAt: now } : {}) },
      ...(resubmit ? { $inc: { revision: 1 } } : {}),
      $push: { history: { action: resubmit ? "RESUBMITTED" : "EDITED", by: oid(user.id), at: now } },
    },
    { runValidators: true }
  );
  if (!res.matchedCount) throw conflict("This report was just reviewed or changed. Refresh to see the latest version.");
  if (resubmit) {
    await notify({
      recipients: [r.reviewedBy, ...(await reviewersFor(user.id, r.department))],
      actorId: user.id,
      type: "DAILY_UPDATE",
      pref: "daily_update",
      title: "Daily report resubmitted",
      message: `${user.name} · ${dayStr(r.date)} · updated after your feedback`,
      link: `/daily-updates?report=${r._id}`,
      entityType: "DailyUpdate",
      entityId: r._id,
    });
  }
}

export async function deleteDailyUpdate(user: CurrentUser, id: string): Promise<void> {
  const { c, r } = await load(user, id);
  if (!isAuthor(c, r)) throw forbidden("Only the author can delete a report");
  if (r.status !== "SUBMITTED" || r.reviewedAt) throw unprocessable("Reviewed reports are kept as a record and can't be deleted");
  const res = await DailyUpdate.deleteOne({ _id: r._id, status: "SUBMITTED", reviewedAt: null });
  if (!res.deletedCount) throw conflict("This report was just reviewed. Refresh to see the latest version.");
  await Attachment.deleteMany({ entityType: "DailyUpdate", entityId: r._id });
}

export async function reviewDailyUpdate(user: CurrentUser, id: string, input: ReviewInput): Promise<void> {
  const { c, r } = await load(user, id);
  if (isAuthor(c, r)) throw forbidden("You can't review your own report");
  if (!canReview(c, r)) throw forbidden("Only the author's Department Head (or a Super Admin) can review this report");
  if (r.status !== "SUBMITTED") throw unprocessable(r.status === "APPROVED" ? "This report is already approved" : "Waiting for the author to update the report");
  const approve = input.decision === "APPROVE";
  const now = new Date();
  const res = await DailyUpdate.updateOne(
    { _id: r._id, status: "SUBMITTED", updatedAt: r.updatedAt },
    {
      $set: { status: approve ? "APPROVED" : "CHANGES_REQUESTED", reviewedBy: oid(user.id), reviewedAt: now, reviewComment: input.comment },
      $push: { history: { action: approve ? "APPROVED" : "CHANGES_REQUESTED", by: oid(user.id), at: now, comment: input.comment } },
    }
  );
  if (!res.matchedCount) throw conflict("The author just changed this report. Refresh and review the latest version.");
  const author = await User.findById(r.user).select("name").lean();
  await recordAudit({
    actorId: user.id,
    action: approve ? "daily_update.approve" : "daily_update.changes_requested",
    entityType: "DailyUpdate",
    entityId: r._id,
    summary: `${approve ? "Approved" : "Requested changes on"} ${author?.name ?? "employee"}'s report for ${dayStr(r.date)}`,
    changes: { status: { from: "SUBMITTED", to: approve ? "APPROVED" : "CHANGES_REQUESTED" } },
  });
  await notify({
    recipients: [r.user],
    actorId: user.id,
    type: "DAILY_UPDATE",
    title: approve ? "Daily report approved" : "Daily report needs changes",
    message: `${dayStr(r.date)}${input.comment ? ` · ${input.comment.slice(0, 140)}` : ""}`,
    link: `/daily-updates?report=${r._id}`,
    entityType: "DailyUpdate",
    entityId: r._id,
  });
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function listDailyUpdates(user: CurrentUser, q: ListQuery): Promise<Paginated<DailyUpdateDTO> & { canSeeTeam: boolean }> {
  const c = await ctxFor(user);
  const team = teamFilter(c);
  let base: Filter;
  if (q.scope === "team") {
    if (!team) throw forbidden("You don't review or oversee anyone's daily reports");
    base = team;
  } else base = { user: oid(user.id) };
  const and: Filter[] = [base];
  if (q.from || q.to) {
    const range: Filter = {};
    if (q.from) range.$gte = toDay(q.from);
    if (q.to) range.$lte = toDay(q.to);
    and.push({ date: range });
  }
  if (isId(q.user)) and.push({ user: oid(q.user) });
  if (isId(q.project)) and.push({ project: oid(q.project) });
  if (isId(q.department)) and.push({ department: oid(q.department) });
  if (q.status) and.push({ status: q.status });
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    and.push({ $or: [{ workCompleted: rx }, { pendingWork: rx }, { blockers: rx }] });
  }
  const filter = { $and: and };
  const [rows, total] = await Promise.all([
    POPULATE(DailyUpdate.find(filter).sort({ date: -1, createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize)),
    DailyUpdate.countDocuments(filter),
  ]);
  const counts = await attachmentCounts(rows.map((r: any) => r._id));
  return {
    ...paginate(rows.map((r: any) => toDTO(r, c, counts.get(r._id.toString()) ?? 0)), total, q.page, q.pageSize),
    canSeeTeam: !!team,
  };
}

export async function getDailyUpdate(user: CurrentUser, id: string): Promise<DailyUpdateDetailDTO> {
  const { c, r } = await load(user, id);
  const [full, files] = await Promise.all([
    POPULATE(DailyUpdate.findById(r._id).populate("history.by", USER_REF_FIELDS)),
    Attachment.find({ entityType: "DailyUpdate", entityId: r._id }).sort({ createdAt: 1 }).populate("uploadedBy", USER_REF_FIELDS).lean(),
  ]);
  const author = isAuthor(c, r);
  const editable = author && r.status !== "APPROVED";
  return {
    ...toDTO(full, c, files.length),
    attachments: files.map((a) => {
      const dto = toAttachmentDTO(a, user.id, false);
      dto.canDelete = editable && dto.canDelete;
      return dto;
    }),
    history: (full.history ?? []).map((h: any) => ({ action: h.action, by: toUserRef(h.by), at: iso(h.at)!, comment: h.comment ?? "" })).reverse(),
    canUpload: editable,
  };
}

/** Projects and open tasks the user can report on (form options). */
export async function reportableWork(user: CurrentUser): Promise<{ projects: { id: string; name: string; code: string; tasks: { id: string; taskNumber: string; title: string }[] }[] }> {
  const c = await ctxFor(user);
  const ids = c.isAdmin ? null : [...new Set([...c.memberOf, ...c.managed])].map((x) => oid(x));
  const projects = await Project.find({ ...(ids ? { _id: { $in: ids } } : {}), isArchived: { $ne: true } }).select("name code").sort({ name: 1 }).lean();
  const tasks = await Task.find({
    project: { $in: projects.map((p) => p._id) },
    status: { $nin: CLOSED_TASK_STATUSES },
    $or: [{ owner: oid(user.id) }, { collaborators: oid(user.id) }],
  })
    .select("taskNumber title project")
    .sort({ dueDate: 1 })
    .lean();
  return {
    projects: projects.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      code: p.code,
      tasks: tasks.filter((t) => sid(t.project) === p._id.toString()).map((t) => ({ id: t._id.toString(), taskNumber: t.taskNumber, title: t.title })),
    })),
  };
}

/** Daily or weekly (Mon–Sun) summary of hours and report status per employee. */
export async function dailySummary(user: CurrentUser, q: SummaryQuery): Promise<DailySummaryDTO> {
  const c = await ctxFor(user);
  const s = await getSystemSettings();
  const anchor = q.date || todayIn(s.company.timezone);
  const start = q.view === "week" ? format(startOfWeek(toDay(anchor), { weekStartsOn: 1 }), "yyyy-MM-dd") : anchor;
  const days = Array.from({ length: q.view === "week" ? 7 : 1 }, (_, i) => format(addDays(toDay(start), i), "yyyy-MM-dd"));
  const from = days[0];
  const to = days[days.length - 1];

  let scope: Filter;
  if (q.scope === "team") {
    const team = teamFilter(c);
    if (!team) throw forbidden("You don't review or oversee anyone's daily reports");
    scope = team;
  } else scope = { user: oid(user.id) };
  const and: Filter[] = [scope, { date: { $gte: toDay(from), $lte: toDay(to) } }];
  if (isId(q.department)) and.push({ department: oid(q.department) });
  if (isId(q.project)) and.push({ project: oid(q.project) });

  const rows = await DailyUpdate.find({ $and: and }).select("user department date hoursSpent status blockers").populate("user", USER_REF_FIELDS).populate("department", "name").lean();
  const byUser = new Map<string, DailySummaryDTO["rows"][number]>();
  for (const r of rows as any[]) {
    const key = r.user._id.toString();
    if (!byUser.has(key)) {
      byUser.set(key, { user: toUserRef(r.user)!, department: r.department?.name ?? null, reports: 0, hours: 0, hoursByDay: Object.fromEntries(days.map((d) => [d, 0])), approved: 0, pending: 0, changesRequested: 0, blockers: 0 });
    }
    const row = byUser.get(key)!;
    row.reports++;
    row.hours += r.hoursSpent;
    row.hoursByDay[dayStr(r.date)] = (row.hoursByDay[dayStr(r.date)] ?? 0) + r.hoursSpent;
    if (r.status === "APPROVED") row.approved++;
    else if (r.status === "CHANGES_REQUESTED") row.changesRequested++;
    else row.pending++;
    if (r.blockers) row.blockers++;
  }

  // Team members who haven't reported (department scope only, active people).
  let missing: DailySummaryDTO["missing"] = [];
  if (q.scope === "team") {
    const depts = c.isAdmin ? null : [...new Set([...c.headed, ...c.led])];
    const deptFilter = isId(q.department) ? [q.department] : depts;
    if (deptFilter === null || deptFilter.length) {
      const people = await User.find({
        status: "ACTIVE",
        _id: { $ne: oid(user.id) },
        ...(deptFilter ? { department: { $in: deptFilter.map((x) => oid(x)) } } : { department: { $ne: null } }),
      })
        .select(USER_REF_FIELDS)
        .sort({ name: 1 })
        .limit(500)
        .lean();
      missing = people.filter((p) => !byUser.has(p._id.toString())).map((p) => toUserRef(p)!);
    }
  }

  const list = [...byUser.values()].sort((a, b) => b.hours - a.hours).map((r) => ({ ...r, hours: Math.round(r.hours * 100) / 100 }));
  return {
    view: q.view,
    from,
    to,
    days,
    rows: list,
    missing,
    totals: {
      reports: list.reduce((n, r) => n + r.reports, 0),
      hours: Math.round(list.reduce((n, r) => n + r.hours, 0) * 100) / 100,
      employees: list.length,
      blockers: list.reduce((n, r) => n + r.blockers, 0),
      pending: list.reduce((n, r) => n + r.pending, 0),
    },
  };
}
