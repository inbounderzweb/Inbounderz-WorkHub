import "server-only";
import { CLOSED_TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/constants";
import type { DepartmentRef, TaskSummaryDTO, UserRef } from "@/types/dto";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : d ? String(d) : null);

export const idOf = (v: any): string | null => {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v._id) return v._id.toString();
  return v.toString();
};

/** Maps a populated user ref; returns null when not populated or missing. */
export function toUserRef(u: any): UserRef | null {
  if (!u || typeof u !== "object" || !("name" in u)) return null;
  return {
    id: u._id.toString(),
    name: u.name,
    email: u.email ?? "",
    avatarUrl: u.avatarUrl ?? "",
    designation: u.designation ?? "",
  };
}

export function toDepartmentRef(d: any): DepartmentRef | null {
  if (!d || typeof d !== "object" || !("name" in d)) return null;
  return { id: d._id.toString(), name: d.name, code: d.code ?? "", color: d.color ?? "#16a34a" };
}

export function isOverdue(task: { status: string; dueDate?: Date | null }): boolean {
  return (
    !!task.dueDate &&
    task.dueDate.getTime() < Date.now() &&
    !CLOSED_TASK_STATUSES.includes(task.status as TaskStatus)
  );
}

export function toTaskSummary(t: any): TaskSummaryDTO {
  return {
    id: t._id.toString(),
    title: t.title,
    status: t.status as TaskStatus,
    priority: t.priority as TaskPriority,
    dueDate: iso(t.dueDate),
    owner: toUserRef(t.owner),
    project:
      t.project && typeof t.project === "object" && "name" in t.project
        ? { id: t.project._id.toString(), name: t.project.name, code: t.project.code }
        : null,
    isOverdue: isOverdue(t),
    ticket:
      t.linkedTicket && typeof t.linkedTicket === "object" && "ticketNumber" in t.linkedTicket
        ? { id: t.linkedTicket._id.toString(), ticketNumber: t.linkedTicket.ticketNumber }
        : null,
  };
}

export const USER_REF_FIELDS = "name email avatarUrl designation";
export const DEPT_REF_FIELDS = "name code color";
