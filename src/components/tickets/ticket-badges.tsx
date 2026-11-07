import { Inbox } from "lucide-react";
import { TICKET_STATUS_LABELS, type TicketStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

const base = "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const STYLES: Record<TicketStatus, string> = {
  NEW: "border-sky-200 bg-sky-50 text-sky-700",
  UNDER_REVIEW: "border-indigo-200 bg-indigo-50 text-indigo-700",
  ASSIGNED: "border-slate-200 bg-slate-50 text-slate-700",
  IN_PROGRESS: "border-blue-200 bg-blue-50 text-blue-700",
  WAITING_FOR_INFO: "border-amber-200 bg-amber-50 text-amber-800",
  RESOLVED: "border-violet-200 bg-violet-50 text-violet-700",
  CHANGES_REQUESTED: "border-orange-200 bg-orange-50 text-orange-700",
  CLOSED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  REJECTED: "border-slate-200 bg-slate-100 text-slate-500",
};

export const TICKET_STATUS_COLORS: Record<TicketStatus, string> = {
  NEW: "#0ea5e9",
  UNDER_REVIEW: "#6366f1",
  ASSIGNED: "#94a3b8",
  IN_PROGRESS: "#3b82f6",
  WAITING_FOR_INFO: "#f59e0b",
  RESOLVED: "#8b5cf6",
  CHANGES_REQUESTED: "#f97316",
  CLOSED: "#16a34a",
  REJECTED: "#cbd5e1",
};

export function TicketStatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <span className={cn(base, STYLES[status], className)}>
      <span className="size-1.5 rounded-full" style={{ backgroundColor: TICKET_STATUS_COLORS[status] }} />
      {TICKET_STATUS_LABELS[status]}
    </span>
  );
}

/** Marks a task that is the work item of an internal department ticket. */
export function InternalRequestBadge({ ticketNumber, className }: { ticketNumber: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-md border border-fuchsia-200 bg-fuchsia-50 px-1.5 py-px text-[11px] font-medium whitespace-nowrap text-fuchsia-700", className)}
      title={`Internal request ${ticketNumber}`}
    >
      <Inbox className="size-3" />
      Internal Request · <span className="font-mono">{ticketNumber}</span>
    </span>
  );
}

export function DeptChip({ dept }: { dept: { name: string; color: string } | null }) {
  if (!dept) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm">
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: dept.color }} />
      <span className="truncate">{dept.name}</span>
    </span>
  );
}
