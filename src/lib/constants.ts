/**
 * Domain constants shared by the server (models, services) and the client (UI).
 * Keep this file free of server-only imports.
 */

export const ROLE_KEYS = [
  "SUPER_ADMIN",
  "PROJECT_MANAGER",
  "DEPARTMENT_HEAD",
  "TEAM_LEADER",
  "EMPLOYEE",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_META: Record<
  RoleKey,
  { name: string; level: number; description: string }
> = {
  SUPER_ADMIN: {
    name: "Super Admin",
    level: 100,
    description: "Full company-wide access, user and system administration.",
  },
  PROJECT_MANAGER: {
    name: "Project Manager",
    level: 80,
    description: "Manages authorized projects, teams, tasks and tickets.",
  },
  DEPARTMENT_HEAD: {
    name: "Department Head",
    level: 60,
    description: "Manages department employees, reviews and approves work.",
  },
  TEAM_LEADER: {
    name: "Team Leader",
    level: 40,
    description: "Distributes subtasks and reviews team progress.",
  },
  EMPLOYEE: {
    name: "Employee",
    level: 10,
    description: "Works on assigned tasks and submits daily updates.",
  },
};

export const USER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const DEPARTMENT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type DepartmentStatus = (typeof DEPARTMENT_STATUSES)[number];

export const PROJECT_STATUSES = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
/** Statuses that count as "in flight" for dashboards and deletion guards. */
export const OPEN_PROJECT_STATUSES: ProjectStatus[] = ["PLANNING", "ACTIVE", "ON_HOLD"];

export const PROJECT_MEMBER_ROLES = [
  "MANAGER",
  "LEAD",
  "MEMBER",
  "REVIEWER",
  "OBSERVER",
] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export const TASK_STATUSES = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "ON_HOLD",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const CLOSED_TASK_STATUSES: TaskStatus[] = ["COMPLETED", "CANCELLED"];
/**
 * Statuses an administrator may switch off. ON_HOLD stays on: internal tickets
 * waiting for information map their task to it.
 */
export const OPTIONAL_TASK_STATUSES: TaskStatus[] = ["BACKLOG"];
export const OPEN_TASK_STATUSES: TaskStatus[] = TASK_STATUSES.filter(
  (s) => !CLOSED_TASK_STATUSES.includes(s)
);
/** Progress buckets (see lib/progress.ts for the full definition). */
export const IN_PROGRESS_BUCKET: TaskStatus[] = ["IN_PROGRESS", "IN_REVIEW", "CHANGES_REQUESTED"];
export const PENDING_BUCKET: TaskStatus[] = ["BACKLOG", "TODO", "ON_HOLD"];
/** Statuses that require every dependency to be resolved first. */
export const DEPENDENCY_GATED_STATUSES: TaskStatus[] = ["IN_PROGRESS", "IN_REVIEW", "COMPLETED"];

export const DAILY_UPDATE_STATUSES = ["SUBMITTED", "APPROVED", "CHANGES_REQUESTED"] as const;
export type DailyUpdateStatus = (typeof DAILY_UPDATE_STATUSES)[number];

/** Who must approve a task submitted for review. */
export const APPROVAL_MODES = ["DEPARTMENT", "PROJECT_MANAGER"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  DEPARTMENT: "Department Head or Team Leader",
  PROJECT_MANAGER: "Project Manager",
};

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const MILESTONE_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "MISSED"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/** Where a task came from. Internal-request tasks are driven by their ticket. */
export const TASK_SOURCE_TYPES = ["project", "internal_ticket"] as const;
export type TaskSourceType = (typeof TASK_SOURCE_TYPES)[number];

/* ----------------------------- Internal tickets ---------------------------- */

export const TICKET_STATUSES = [
  "NEW",
  "UNDER_REVIEW",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_FOR_INFO",
  "RESOLVED",
  "CHANGES_REQUESTED",
  "CLOSED",
  "REJECTED",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
/** Final states: nothing is pending on anyone. */
export const FINAL_TICKET_STATUSES: TicketStatus[] = ["CLOSED", "REJECTED"];
/** States in which the ticket can't be overdue (work delivered or finished). */
export const NOT_OVERDUE_TICKET_STATUSES: TicketStatus[] = ["RESOLVED", "CLOSED", "REJECTED"];
export const OPEN_TICKET_STATUSES: TicketStatus[] = TICKET_STATUSES.filter((s) => !FINAL_TICKET_STATUSES.includes(s));

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  NEW: "New",
  UNDER_REVIEW: "Under Review",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  WAITING_FOR_INFO: "Waiting for Information",
  RESOLVED: "Resolved",
  CHANGES_REQUESTED: "Changes Requested",
  CLOSED: "Closed",
  REJECTED: "Rejected",
};

/** A requester may reopen a closed ticket for this many days after closure. Managers can always reopen. */
export const TICKET_REOPEN_WINDOW_DAYS = 14;

/** Categories created automatically the first time categories are needed. */
export const DEFAULT_TICKET_CATEGORIES: { name: string; description: string; departmentCode?: string }[] = [
  { name: "Design Request", description: "Banners, creatives, UI mock-ups and other design assets", departmentCode: "DSN" },
  { name: "Content Request", description: "Copy, blog posts, product descriptions and editing", departmentCode: "CNT" },
  { name: "Development Support", description: "Help from developers: fixes, integrations, reviews", departmentCode: "DEV" },
  { name: "SEO Request", description: "Audits, keyword research, metadata and on-page SEO", departmentCode: "SEO" },
  { name: "Technical Support", description: "Access, tools, hosting and other technical issues" },
  { name: "General Assistance", description: "Anything that doesn't fit another category" },
];

export const NOTIFICATION_TYPES = [
  "SYSTEM",
  "ACCOUNT",
  "DEPARTMENT",
  "PROJECT",
  "TASK",
  "TICKET",
  "REVIEW",
  "DAILY_UPDATE",
  "REMINDER",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Notification preferences a user can switch off (in-app). Assignments of new
 * work to you are always delivered and can't be muted.
 */
export const NOTIFICATION_PREFS = [
  { key: "project", label: "Project membership", description: "Added to or removed from a project, new projects you manage" },
  { key: "task_activity", label: "Task activity", description: "Status changes, collaborators and blockers on tasks you own or assigned" },
  { key: "task_review", label: "Task reviews", description: "Tasks submitted for your review, approvals and change requests" },
  { key: "ticket_updates", label: "Ticket progress", description: "Updates on tickets you raised or manage (review, started, resolved, closed…)" },
  { key: "comments", label: "Comments", description: "New comments on your tasks and tickets" },
  { key: "daily_update", label: "Daily work updates", description: "Reports submitted for your review and review decisions" },
  { key: "reminders", label: "Deadline reminders", description: "Tasks and projects due soon, and overdue tasks" },
] as const;
export type NotificationPref = (typeof NOTIFICATION_PREFS)[number]["key"];
export const NOTIFICATION_PREF_KEYS = NOTIFICATION_PREFS.map((p) => p.key) as NotificationPref[];

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export function roleName(key: RoleKey | string | undefined | null): string {
  if (!key) return "—";
  return ROLE_META[key as RoleKey]?.name ?? key;
}

const LABEL_OVERRIDES: Record<string, string> = { TODO: "To Do" };

export function humanize(value: string): string {
  if (LABEL_OVERRIDES[value]) return LABEL_OVERRIDES[value];
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
