"use client";

import { useSettings } from "@/components/providers/user-provider";
import { TASK_STATUSES, humanize, type TaskPriority, type TaskStatus } from "@/lib/constants";

/** Display labels configured under Settings → Workflow (falls back to the built-in names). */
export function useLabels() {
  const s = useSettings();
  return {
    status: (v: TaskStatus) => s?.taskStatuses[v]?.label ?? humanize(v),
    priority: (v: TaskPriority) => s?.priorities[v]?.label ?? humanize(v),
    /** Statuses currently offered (switched-off optional statuses are hidden in filters and boards). */
    statuses: TASK_STATUSES.filter((v) => s?.taskStatuses[v]?.enabled !== false),
  };
}

export function TaskStatusLabel({ value }: { value: TaskStatus }) {
  return <>{useLabels().status(value)}</>;
}

export function PriorityLabel({ value }: { value: TaskPriority }) {
  return <>{useLabels().priority(value)}</>;
}
