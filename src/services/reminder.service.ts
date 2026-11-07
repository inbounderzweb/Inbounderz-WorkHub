import "server-only";
import { CLOSED_TASK_STATUSES, OPEN_PROJECT_STATUSES } from "@/lib/constants";
import { deliverReminders, type ReminderDoc } from "@/lib/notify";
import { getSystemSettings } from "@/lib/settings";
import { Counter, Project, ProjectMember, Task } from "@/models";

/* eslint-disable @typescript-eslint/no-explicit-any */

const day = (d: Date) => d.toISOString().slice(0, 10);
const SWEEP_EVERY_MS = 10 * 60 * 1000;

export type SweepResult = { taskDueSoon: number; taskOverdue: number; projectDueSoon: number };

/**
 * Creates deadline reminders:
 *  - task due within `taskDueSoonHours` → owner
 *  - task overdue → owner and whoever assigned it
 *  - open project ending within `projectDueSoonDays` → project manager(s)
 * Every reminder carries a dedupeKey (unique index), so running the sweep
 * repeatedly — from several servers at once — never duplicates a reminder.
 * Recipients are only people who already have access to the record.
 */
export async function runReminderSweep(now = new Date()): Promise<SweepResult> {
  const s = await getSystemSettings();
  const soon = new Date(now.getTime() + s.reminders.taskDueSoonHours * 3600 * 1000);
  const open = { $nin: CLOSED_TASK_STATUSES };
  const fields = "taskNumber title owner assignedBy dueDate linkedTicket";
  const [dueSoon, overdue, projects] = await Promise.all([
    Task.find({ status: open, owner: { $ne: null }, dueDate: { $gte: now, $lte: soon } }).select(fields).limit(5000).lean(),
    Task.find({ status: open, owner: { $ne: null }, dueDate: { $lt: now } }).select(fields).limit(5000).lean(),
    Project.find({
      status: { $in: OPEN_PROJECT_STATUSES },
      isArchived: { $ne: true },
      endDate: { $gte: now, $lte: new Date(now.getTime() + s.reminders.projectDueSoonDays * 86400 * 1000) },
    })
      .select("name code manager endDate")
      .lean(),
  ]);

  const link = (t: any) => (t.linkedTicket ? `/tickets/${t.linkedTicket}` : `/tasks/${t._id}`);
  const soonDocs: ReminderDoc[] = dueSoon.map((t: any) => ({
    recipient: t.owner.toString(),
    title: "Task due soon",
    message: `${t.taskNumber} · ${t.title} is due ${day(t.dueDate)}`,
    link: link(t),
    entityType: "Task",
    entityId: t._id,
    dedupeKey: `task-due-soon:${t._id}:${day(t.dueDate)}:${t.owner}`,
  }));
  const overdueDocs: ReminderDoc[] = overdue.flatMap((t: any) =>
    [...new Set([t.owner, t.assignedBy].filter(Boolean).map(String))].map((r) => ({
      recipient: r,
      title: r === t.owner.toString() ? "Task overdue" : "Task you assigned is overdue",
      message: `${t.taskNumber} · ${t.title} was due ${day(t.dueDate)}`,
      link: link(t),
      entityType: "Task",
      entityId: t._id,
      dedupeKey: `task-overdue:${t._id}:${day(t.dueDate)}:${r}`,
    }))
  );
  const managers = await ProjectMember.find({ project: { $in: projects.map((p) => p._id) }, projectRole: "MANAGER", isActive: true })
    .select("project user")
    .lean();
  const projectDocs: ReminderDoc[] = projects.flatMap((p: any) =>
    [...new Set([p.manager, ...managers.filter((m) => m.project.toString() === p._id.toString()).map((m) => m.user)].filter(Boolean).map(String))].map((r) => ({
      recipient: r,
      title: "Project deadline approaching",
      message: `${p.code} · ${p.name} ends ${day(p.endDate)}`,
      link: `/projects/${p._id}`,
      entityType: "Project",
      entityId: p._id,
      dedupeKey: `project-due:${p._id}:${day(p.endDate)}:${r}`,
    }))
  );

  const [a, b, c] = await Promise.all([deliverReminders(soonDocs), deliverReminders(overdueDocs), deliverReminders(projectDocs)]);
  return { taskDueSoon: a, taskOverdue: b, projectDueSoon: c };
}

/**
 * Runs the sweep at most once per 10 minutes across all server instances (a
 * database lock), so reminders arrive even without an external scheduler.
 */
export async function maybeRunReminderSweep(): Promise<void> {
  const now = Date.now();
  if (globalThis.__workhubLastSweep && now - globalThis.__workhubLastSweep < SWEEP_EVERY_MS) return;
  globalThis.__workhubLastSweep = now;
  try {
    // Acquire: only matches when the lock is older than the interval (or missing → upsert).
    await Counter.findOneAndUpdate(
      { _id: "lock:reminder-sweep", seq: { $lt: now - SWEEP_EVERY_MS } },
      { $set: { seq: now } },
      { upsert: true }
    );
  } catch (err: any) {
    if (err?.code === 11000) return; // another instance swept recently
    throw err;
  }
  await runReminderSweep().catch((err) => console.error("[reminders] sweep failed", err));
}

declare global {
  var __workhubLastSweep: number | undefined;
}
