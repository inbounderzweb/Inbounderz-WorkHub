import { day } from "@/lib/dates";
import { differenceInCalendarDays, eachMonthOfInterval, format, max, min, startOfMonth } from "date-fns";
import { CalendarRange, Diamond } from "lucide-react";
import Link from "next/link";
import { TASK_STATUS_COLORS } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/states";
import type { ProjectDetailDTO } from "@/types/dto";

/**
 * Lightweight Gantt-style timeline: project span, today marker, milestones and
 * top-level tasks (start → due). Pure CSS, no chart library needed.
 */
export function ProjectTimeline({ project }: { project: ProjectDetailDTO }) {
  const dates: Date[] = [];
  const push = (d: string | null) => d && dates.push(day(d));
  push(project.startDate);
  push(project.endDate);
  project.milestones.forEach((m) => push(m.dueDate));
  project.timeline.forEach((t) => {
    push(t.startDate);
    push(t.dueDate);
  });
  if (dates.length < 2) {
    return <EmptyState icon={CalendarRange} title="Not enough dates for a timeline" description="Add a start date and deadline, or give tasks start and due dates." className="py-8" />;
  }

  const start = startOfMonth(min(dates));
  const end = max(dates);
  const span = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const pos = (d: string | Date) => `${(differenceInCalendarDays(typeof d === "string" ? day(d) : d, start) / span) * 100}%`;
  const width = (a: string, b: string) => `${Math.max(0.8, ((differenceInCalendarDays(day(b), day(a)) + 1) / span) * 100)}%`;
  const today = new Date();
  const showToday = today >= start && today <= end;
  const months = eachMonthOfInterval({ start, end });

  return (
    <div className="overflow-x-auto p-4">
      <div className="min-w-[640px]">
        <div className="relative ml-48 h-6 border-b text-[11px] text-muted-foreground">
          {months.map((m) => (
            <span key={m.toISOString()} className="absolute top-0 border-l pl-1" style={{ left: pos(m) }}>{format(m, "MMM yy")}</span>
          ))}
        </div>
        <div className="relative">
          {showToday ? (
            <div className="pointer-events-none absolute top-0 bottom-0 z-10 ml-48 w-[calc(100%-12rem)]">
              <div className="absolute top-0 bottom-0 w-px bg-red-500/70" style={{ left: pos(today) }}>
                <span className="absolute -top-0.5 -translate-x-1/2 rounded bg-red-500 px-1 text-[10px] text-white">Today</span>
              </div>
            </div>
          ) : null}

          {project.startDate && project.endDate ? (
            <div className="flex items-center border-b py-2">
              <span className="w-48 shrink-0 truncate pr-3 text-sm font-medium">Project</span>
              <div className="relative h-5 flex-1">
                <div className="absolute h-5 rounded bg-primary/15 ring-1 ring-primary/30" style={{ left: pos(project.startDate), width: width(project.startDate, project.endDate) }} />
              </div>
            </div>
          ) : null}

          {project.milestones.filter((m) => m.dueDate).length ? (
            <div className="flex items-center border-b py-2">
              <span className="w-48 shrink-0 truncate pr-3 text-sm font-medium">Milestones</span>
              <div className="relative h-5 flex-1">
                {project.milestones.filter((m) => m.dueDate).map((m) => (
                  <span key={m.id} className="absolute -translate-x-1/2" style={{ left: pos(m.dueDate!) }} title={`${m.title} · ${format(day(m.dueDate!), "d MMM yyyy")}`}>
                    <Diamond className={m.status === "COMPLETED" ? "size-4 fill-primary text-primary" : "size-4 fill-amber-400 text-amber-500"} />
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {project.timeline.map((t) => {
            const s = t.startDate ?? t.dueDate!;
            const e = t.dueDate ?? t.startDate!;
            return (
              <div key={t.id} className="flex items-center py-1.5 hover:bg-muted/30">
                <Link href={`/tasks/${t.id}`} className="w-48 shrink-0 truncate pr-3 text-sm hover:text-primary" title={t.title}>
                  <span className="font-mono text-[11px] text-muted-foreground">{t.taskNumber}</span> {t.title}
                </Link>
                <div className="relative h-4 flex-1">
                  <div
                    className="absolute h-4 rounded-sm"
                    style={{ left: pos(s), width: width(s, e), backgroundColor: TASK_STATUS_COLORS[t.status] }}
                    title={`${t.title}${t.owner ? ` · ${t.owner}` : ""} · ${format(day(s), "d MMM")} → ${format(day(e), "d MMM")}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
