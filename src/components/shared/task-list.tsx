import { day } from "@/lib/dates";
import Link from "next/link";
import { format } from "date-fns";
import { CalendarClock } from "lucide-react";
import type { TaskSummaryDTO } from "@/types/dto";
import { cn } from "@/lib/utils";
import { PriorityBadge, TaskStatusBadge } from "./badges";
import { UserAvatar } from "./user-avatar";
import { EmptyState } from "./states";
import { InternalRequestBadge } from "@/components/tickets/ticket-badges";

export function TaskList({
  tasks,
  emptyTitle = "No tasks",
  emptyDescription,
  showOwner = true,
}: {
  tasks: TaskSummaryDTO[];
  emptyTitle?: string;
  emptyDescription?: string;
  showOwner?: boolean;
}) {
  if (!tasks.length) {
    return <EmptyState icon={CalendarClock} title={emptyTitle} description={emptyDescription} className="py-8" />;
  }
  return (
    <ul className="divide-y">
      {tasks.map((t) => (
        <li key={t.id}>
          <Link href={t.ticket ? `/tickets/${t.ticket.id}?from=task` : `/tasks/${t.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
          {showOwner && t.owner ? <UserAvatar name={t.owner.name} size="sm" /> : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{t.title}</p>
            <p className="flex flex-wrap items-center gap-x-2 truncate text-xs text-muted-foreground">
              {t.ticket ? <InternalRequestBadge ticketNumber={t.ticket.ticketNumber} /> : t.project ? <span className="font-mono">{t.project.code}</span> : null}
              {showOwner && t.owner ? <span>{t.owner.name}</span> : null}
              <PriorityBadge priority={t.priority} />
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <TaskStatusBadge status={t.status} />
            {t.dueDate ? (
              <span className={cn("tabular text-xs", t.isOverdue ? "font-medium text-red-600" : "text-muted-foreground")}>
                {t.isOverdue ? "Overdue · " : "Due "}
                {format(day(t.dueDate), "d MMM")}
              </span>
            ) : null}
          </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
