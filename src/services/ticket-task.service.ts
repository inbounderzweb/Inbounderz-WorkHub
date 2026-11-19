import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { notFound, unprocessable } from "@/lib/api";
import { Project, Task, TaskActivity } from "@/models";
import type { TicketProjectOptionDTO, TicketTaskOptionDTO } from "@/types/dto";
import { accessContext, canViewProject, projectVisibilityFilter } from "./access";
import { refreshProjectProgress } from "./progress.service";
import { oid } from "./scope";
import { generateTaskNumber } from "./task.service";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CLOSED_PROJECT = ["COMPLETED", "CANCELLED"];

/** Projects a requester may attach a ticket to: visible to them, open and not archived. */
export async function ticketProjectOptions(user: CurrentUser): Promise<TicketProjectOptionDTO[]> {
  const ctx = await accessContext(user);
  const rows = await Project.find({ $and: [projectVisibilityFilter(ctx), { isArchived: { $ne: true } }, { status: { $nin: CLOSED_PROJECT } }] })
    .select("name code").sort({ name: 1 }).limit(300).lean();
  return rows.map((p: any) => ({ id: p._id.toString(), code: p.code, name: p.name }));
}

/** Open top-level tasks of a project the requester can see. */
export async function ticketTaskOptions(user: CurrentUser, projectId: string): Promise<TicketTaskOptionDTO[]> {
  await assertLinkableProject(user, projectId);
  const rows = await Task.find({ project: oid(projectId), parentTask: null, status: { $nin: ["COMPLETED", "CANCELLED"] } })
    .select("taskNumber title").sort({ createdAt: -1 }).limit(300).lean();
  return rows.map((t: any) => ({ id: t._id.toString(), taskNumber: t.taskNumber, title: t.title }));
}

async function assertLinkableProject(user: CurrentUser, projectId: string) {
  const ctx = await accessContext(user);
  const project: any = await Project.findById(projectId).select("departments isArchived status").lean();
  if (!project || !canViewProject(ctx, project)) throw notFound("Project not found");
  if (project.isArchived || CLOSED_PROJECT.includes(project.status)) {
    throw unprocessable("This project is closed; tickets can't be linked to it", { project: "Choose an open project" });
  }
}

/**
 * Validates the optional project/task pair from the form. A task without a project is taken from the
 * task itself; a task must belong to the chosen project.
 */
export async function resolveWorkLink(user: CurrentUser, projectId?: string | null, taskId?: string | null): Promise<{ project: string | null; task: string | null }> {
  let project = projectId || null;
  if (taskId) {
    const task: any = await Task.findById(taskId).select("project status").lean();
    if (!task || !task.project) throw unprocessable("Task not found", { task: "Choose a task from the list" });
    if (project && task.project.toString() !== project) throw unprocessable("That task belongs to a different project", { task: "Choose a task in the selected project" });
    if (["COMPLETED", "CANCELLED"].includes(task.status)) throw unprocessable("That task is already closed", { task: "Choose an open task" });
    project = task.project.toString();
  }
  if (project) await assertLinkableProject(user, project);
  return { project, task: taskId || null };
}

/**
 * Called when a ticket is submitted. If it names a project but no task, a task is created from the
 * ticket so the work shows up under that project. Idempotent: a ticket only ever gets one.
 */
export async function ensureTicketTask(ticket: any, user: CurrentUser): Promise<void> {
  if (!ticket.project || ticket.task) return;
  const task = await Task.create({
    taskNumber: await generateTaskNumber(),
    title: ticket.title,
    description: `${ticket.description}\n\nRaised from ticket ${ticket.ticketNumber}.`.slice(0, 10000),
    project: ticket.project,
    department: ticket.targetDepartment,
    status: "BACKLOG",
    priority: ticket.priority,
    dueDate: ticket.dueDate ?? null,
    workApproval: { status: "NOT_REQUIRED" },
    approvalRequired: false,
    createdBy: ticket.createdBy,
  });
  await TaskActivity.create({ task: task._id, project: ticket.project, actor: oid(user.id), action: "CREATED", message: `Created from ticket ${ticket.ticketNumber}` });
  // Conditional write so a concurrent submit can't attach a second task.
  const set = await ticket.constructor.updateOne({ _id: ticket._id, task: null }, { $set: { task: task._id, taskAutoCreated: true } });
  if (!set.modifiedCount) {
    await Task.deleteOne({ _id: task._id });
    await TaskActivity.deleteMany({ task: task._id });
    return;
  }
  ticket.task = task._id;
  ticket.taskAutoCreated = true;
  await refreshProjectProgress(ticket.project);
}

/** A rejected or cancelled ticket cancels the task that was created for it (never one that already existed). */
export async function cancelAutoTicketTask(ticket: any, user: CurrentUser, reason: string): Promise<void> {
  if (!ticket.task || !ticket.taskAutoCreated) return;
  const r = await Task.updateOne({ _id: ticket.task, status: { $nin: ["COMPLETED", "CANCELLED"] } }, { $set: { status: "CANCELLED" } });
  if (!r.modifiedCount) return;
  await TaskActivity.create({ task: ticket.task, project: ticket.project, actor: oid(user.id), action: "STATUS_CHANGED", message: `Cancelled: ticket ${ticket.ticketNumber} ${reason}` });
  await refreshProjectProgress(ticket.project);
}
