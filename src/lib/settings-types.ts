import type { TaskPriority, TaskStatus } from "./constants";

/** Settings safe to send to every signed-in browser (labels, company profile, policies). */
export type PublicSettings = {
  company: { name: string; legalName: string; email: string; phone: string; website: string; address: string; timezone: string };
  taskStatuses: Record<TaskStatus, { label: string; enabled: boolean }>;
  priorities: Record<TaskPriority, { label: string; responseDays: number }>;
  defaultPriority: TaskPriority;
  dailyUpdates: { backdateDays: number; maxHoursPerDay: number };
};

/** Default "required within" days per priority, used to suggest a ticket's completion date. */
export const DEFAULT_PRIORITY_RESPONSE_DAYS: Record<TaskPriority, number> = { LOW: 10, MEDIUM: 5, HIGH: 3, URGENT: 1 };

/** yyyy-MM-dd for "now" in a timezone (falls back to UTC for an invalid zone). */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
