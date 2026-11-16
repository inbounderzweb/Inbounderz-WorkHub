"use client";

import Link from "next/link";
import useSWR from "swr";
import { format } from "date-fns";
import { CalendarClock, CheckCircle2, Clock, Ticket, ListChecks } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/states";
import { PriorityBadge } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { day } from "@/lib/dates";
import { fetcher } from "@/lib/http";
import { humanize } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { WorkloadDetailDTO, WorkloadItemDTO, WorkloadPeriod } from "@/types/dto";
import { CATEGORY } from "./meta";

function Item({ i }: { i: WorkloadItemDTO }) {
  const Icon = i.type === "TICKET" ? Ticket : ListChecks;
  return (
    <li className="space-y-1.5 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <Link href={i.link} className="min-w-0 hover:text-primary">
          <span className="flex items-center gap-1.5 text-sm font-medium"><Icon className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{i.title}</span></span>
          <span className="block truncate text-xs text-muted-foreground"><span className="font-mono">{i.number}</span>{i.project ? ` · ${i.project}` : ""} · {humanize(i.status)}</span>
        </Link>
        <PriorityBadge priority={i.priority} />
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, i.share)}%` }} /></div>
        <span className="tabular whitespace-nowrap">
          {i.estimatedHours != null ? `${i.countedHours}h` : `~${i.countedHours}h (no estimate)`} · {i.share}% of capacity
        </span>
        {i.dueDate ? <span className={cn("tabular whitespace-nowrap", i.overdue && "font-medium text-red-600")}>{i.overdue ? "Overdue · " : "Due "}{format(day(i.dueDate), "d MMM")}</span> : null}
      </div>
    </li>
  );
}

/** What is using one person's capacity, item by item. */
export function EmployeeDrawer({ employeeId, period, onClose }: { employeeId: string | null; period: WorkloadPeriod; onClose: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<WorkloadDetailDTO>(employeeId ? `/api/workload/employees/${employeeId}?period=${period}` : null, fetcher);
  const e = data?.employee;
  const meta = e ? CATEGORY[e.category] : null;

  return (
    <Sheet open={!!employeeId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-3">
            {e ? <UserAvatar name={e.name} src={e.avatarUrl} /> : null}
            <span className="min-w-0">
              <span className="block truncate">{e?.name ?? "Workload"}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">{e ? [e.designation, e.department?.name].filter(Boolean).join(" · ") : ""}</span>
            </span>
          </SheetTitle>
          <SheetDescription className="sr-only">Current workload breakdown</SheetDescription>
        </SheetHeader>

        {error ? <ErrorState message={error.message} onRetry={() => mutate()} /> : isLoading || !data || !e || !meta ? (
          <div className="space-y-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
        ) : (
          <div className="space-y-5 p-4">
            <section className="space-y-2 rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", meta.chip)}>{meta.label}</span>
                <span className="tabular text-2xl font-semibold">{e.estimated && e.activeItems ? "~" : ""}{e.utilization}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.min(100, e.utilization)} aria-valuemin={0} aria-valuemax={100}>
                <div className={cn("h-full rounded-full", meta.bar)} style={{ width: `${Math.min(100, e.utilization)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {e.workloadHours}h of work against {e.capacityHours}h available this {period} · <span className="font-medium text-foreground">{e.availableHours}h free</span>
                {e.estimated ? ` · ${e.unestimatedItems} item${e.unestimatedItems === 1 ? " has" : "s have"} no estimate and ${e.unestimatedItems === 1 ? "is" : "are"} counted at the default hours, so this is an estimate.` : ""}
              </p>
            </section>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Active", value: e.activeItems, sub: `${e.ticketItems} tickets · ${e.taskItems} tasks` },
                { label: "Overdue", value: e.overdue, tone: e.overdue ? "text-red-600" : "" },
                { label: "In progress", value: e.inProgress, sub: `${e.pending} pending` },
                { label: "Done · 30 days", value: data.completedLast30Days },
              ].map((x) => (
                <div key={x.label} className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">{x.label}</p>
                  <p className={cn("tabular text-xl font-semibold", x.tone)}>{x.value}</p>
                  {x.sub ? <p className="truncate text-[11px] text-muted-foreground">{x.sub}</p> : null}
                </div>
              ))}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Priority mix</h3>
              <div className="flex flex-wrap gap-2 text-xs">
                {(["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map((p) => (
                  <span key={p} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1"><PriorityBadge priority={p} /><span className="tabular font-medium">{data.priorities[p]}</span></span>
                ))}
              </div>
            </section>

            <section>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Clock className="size-4 text-muted-foreground" /> What is using capacity</h3>
              {data.items.length ? <ul className="divide-y">{data.items.map((i) => <Item key={`${i.type}${i.id}`} i={i} />)}</ul> : (
                <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-600" /> No active tasks. Fully available.</p>
              )}
            </section>

            {data.upcoming.length ? (
              <section>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold"><CalendarClock className="size-4 text-muted-foreground" /> Upcoming deadlines (14 days)</h3>
                <ul className="divide-y">{data.upcoming.map((i) => <Item key={`u${i.type}${i.id}`} i={i} />)}</ul>
              </section>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
