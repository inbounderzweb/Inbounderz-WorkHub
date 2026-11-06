import { cn } from "@/lib/utils";
import { humanize, type RoleKey, type TaskPriority, type TaskStatus, type UserStatus, type ProjectStatus } from "@/lib/constants";

const base = "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const ROLE_STYLES: Record<RoleKey, string> = {
  SUPER_ADMIN: "border-emerald-200 bg-emerald-50 text-emerald-800",
  PROJECT_MANAGER: "border-sky-200 bg-sky-50 text-sky-800",
  DEPARTMENT_HEAD: "border-violet-200 bg-violet-50 text-violet-800",
  TEAM_LEADER: "border-amber-200 bg-amber-50 text-amber-800",
  EMPLOYEE: "border-slate-200 bg-slate-50 text-slate-700",
};

export function RoleBadge({ role, name, className }: { role: RoleKey | null | undefined; name?: string; className?: string }) {
  if (!role) return <span className="text-muted-foreground">—</span>;
  return <span className={cn(base, ROLE_STYLES[role], className)}>{name ?? humanize(role)}</span>;
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const active = status === "ACTIVE";
  return (
    <span
      className={cn(
        base,
        active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"
      )}
    >
      <span className={cn("size-1.5 rounded-full", active ? "bg-emerald-500" : "bg-slate-400")} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  TODO: "border-slate-200 bg-slate-50 text-slate-700",
  IN_PROGRESS: "border-sky-200 bg-sky-50 text-sky-700",
  IN_REVIEW: "border-violet-200 bg-violet-50 text-violet-700",
  BLOCKED: "border-red-200 bg-red-50 text-red-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-slate-200 bg-slate-100 text-slate-500",
};

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  TODO: "#94a3b8",
  IN_PROGRESS: "#0ea5e9",
  IN_REVIEW: "#8b5cf6",
  BLOCKED: "#ef4444",
  COMPLETED: "#16a34a",
  CANCELLED: "#cbd5e1",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <span className={cn(base, TASK_STATUS_STYLES[status])}>{humanize(status)}</span>;
}

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  LOW: "text-slate-500",
  MEDIUM: "text-sky-600",
  HIGH: "text-amber-600",
  URGENT: "text-red-600",
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", PRIORITY_STYLES[priority])}>
      <span className="size-1.5 rounded-full bg-current" />
      {humanize(priority)}
    </span>
  );
}

const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  PLANNING: "border-slate-200 bg-slate-50 text-slate-700",
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ON_HOLD: "border-amber-200 bg-amber-50 text-amber-700",
  COMPLETED: "border-sky-200 bg-sky-50 text-sky-700",
  CANCELLED: "border-slate-200 bg-slate-100 text-slate-500",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={cn(base, PROJECT_STATUS_STYLES[status])}>{humanize(status)}</span>;
}

export function DepartmentChip({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{name}</span>
    </span>
  );
}
