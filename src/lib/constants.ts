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
export const OPEN_TASK_STATUSES: TaskStatus[] = TASK_STATUSES.filter(
  (s) => !CLOSED_TASK_STATUSES.includes(s)
);
/** Progress buckets (see lib/progress.ts for the full definition). */
export const IN_PROGRESS_BUCKET: TaskStatus[] = ["IN_PROGRESS", "IN_REVIEW", "CHANGES_REQUESTED"];
export const PENDING_BUCKET: TaskStatus[] = ["BACKLOG", "TODO", "ON_HOLD"];
/** Statuses that require every dependency to be resolved first. */
export const DEPENDENCY_GATED_STATUSES: TaskStatus[] = ["IN_PROGRESS", "IN_REVIEW", "COMPLETED"];

/** Who must approve a task submitted for review. */
export const APPROVAL_MODES = ["DEPARTMENT", "PROJECT_MANAGER"] as const;
export const WORK_APPROVAL_STATUSES = ["NOT_REQUIRED", "PENDING", "APPROVED", "CHANGES_REQUESTED"] as const;
export type WorkApprovalStatus = (typeof WORK_APPROVAL_STATUSES)[number];
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  DEPARTMENT: "Department Head or Team Leader",
  PROJECT_MANAGER: "Project Manager",
};

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const MILESTONE_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "MISSED"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "SYSTEM",
  "ACCOUNT",
  "DEPARTMENT",
  "PROJECT",
  "TASK",
  "TICKET",
  "REVIEW",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

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
  if (TICKET_STATUS_LABELS[value]) return TICKET_STATUS_LABELS[value];
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* Cross-department tickets                                            */
/* ------------------------------------------------------------------ */

export const TICKET_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "UNDER_REVIEW",
  "PENDING_CLARIFICATION",
  "APPROVED",
  "UNASSIGNED",
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "SUBMITTED_FOR_REVIEW",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_CLOSED_STATUSES: TicketStatus[] = ["COMPLETED", "REJECTED", "CANCELLED"];
/** Waiting on the target department's Project Manager. */
export const TICKET_TRIAGE_STATUSES: TicketStatus[] = ["PENDING_APPROVAL", "UNDER_REVIEW", "UNASSIGNED"];
/** Counts against an employee's capacity. */
export const TICKET_ACTIVE_WORK_STATUSES: TicketStatus[] = ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"];
export const TICKET_STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Pending Approval",
  SUBMITTED_FOR_REVIEW: "Review Pending",
};

/**
 * State of the deliverable review, independent of the ticket status. `NONE` = no work submitted yet.
 * Rejected work goes back to the assignee (ticket status IN_PROGRESS) with CHANGES_REQUESTED.
 */
export const REVIEW_STATUSES = ["NONE", "PENDING", "CHANGES_REQUESTED", "APPROVED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  NONE: "Not submitted",
  PENDING: "Pending review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
};
/** A review that has been waiting this long counts as overdue in the review queue. */
export const REVIEW_OVERDUE_HOURS = 48;

export const TICKET_CATEGORIES = ["Design", "Development", "Content", "Marketing", "Support", "Other"] as const;

/** Suggested deliverable types. Any other type can be typed in; these are only suggestions. */
export const DELIVERABLE_TYPES = [
  "Video",
  "Reel",
  "Photo",
  "Product Image",
  "Social Media Post",
  "Story",
  "Banner",
  "Poster",
  "Flyer",
  "Logo",
  "Brochure",
  "Thumbnail",
  "Web Page",
  "Blog Article",
  "Email Template",
] as const;
export const DELIVERABLE_LIMIT = 20;
export const DELIVERABLE_MAX_QUANTITY = 1000;
/**
 * Derived from the quantities, never stored, so it can't disagree with them.
 * COMPLETED only once the full quantity is verified by the reviewer.
 */
export const DELIVERABLE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "AWAITING_VERIFICATION", "COMPLETED"] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export const DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  AWAITING_VERIFICATION: "Awaiting verification",
  COMPLETED: "Completed",
};

/** Workload model used when a Project Manager picks an assignee. */
export const EMPLOYEE_CAPACITY_ITEMS = 5;
export const EMPLOYEE_CAPACITY_HOURS = 40;
export type Availability = "AVAILABLE" | "LIMITED" | "FULL";
