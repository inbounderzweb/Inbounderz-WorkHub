import "server-only";
import type { Types } from "mongoose";
import { IN_PROGRESS_BUCKET, OPEN_TASK_STATUSES, PENDING_BUCKET } from "@/lib/constants";
import { Project, Task } from "@/models";
import { oid } from "./scope";

/**
 * Project progress — one definition used everywhere:
 *
 *   Every task in the project counts as one unit, including subtasks.
 *   completion % = completed ÷ (total − cancelled), rounded; 0 when nothing counts.
 *   in progress  = In Progress + In Review + Changes Requested
 *   pending      = Backlog + To Do + On Hold
 *   overdue      = open (not completed/cancelled) with a due date in the past
 */
export type ProgressStats = {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  cancelled: number;
  overdue: number;
  percent: number;
};

export const EMPTY_PROGRESS: ProgressStats = {
  total: 0,
  completed: 0,
  inProgress: 0,
  pending: 0,
  cancelled: 0,
  overdue: 0,
  percent: 0,
};

export async function progressFor(projectIds: Types.ObjectId[]): Promise<Map<string, ProgressStats>> {
  if (!projectIds.length) return new Map();
  const now = new Date();
  const rows = await Task.aggregate<{
    _id: Types.ObjectId;
    total: number;
    completed: number;
    cancelled: number;
    inProgress: number;
    pending: number;
    overdue: number;
  }>([
    { $match: { project: { $in: projectIds } } },
    {
      $group: {
        _id: "$project",
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $in: ["$status", IN_PROGRESS_BUCKET] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $in: ["$status", PENDING_BUCKET] }, 1, 0] } },
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
  ]);
  const map = new Map<string, ProgressStats>();
  for (const r of rows) {
    const denominator = r.total - r.cancelled;
    map.set(r._id.toString(), {
      total: r.total,
      completed: r.completed,
      inProgress: r.inProgress,
      pending: r.pending,
      cancelled: r.cancelled,
      overdue: r.overdue,
      percent: denominator > 0 ? Math.round((r.completed / denominator) * 100) : 0,
    });
  }
  return map;
}

/** Recalculates and caches Project.progress (used for list sorting). */
export async function refreshProjectProgress(projectId: Types.ObjectId | string | null | undefined): Promise<void> {
  if (!projectId) return;
  const id = projectId.toString();
  const stats = (await progressFor([oid(id)])).get(id) ?? EMPTY_PROGRESS;
  await Project.updateOne({ _id: id }, { $set: { progress: stats.percent } });
}
