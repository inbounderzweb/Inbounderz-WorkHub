"use client";

import { Users } from "lucide-react";
import { format } from "date-fns";
import { Panel } from "@/components/dashboard/panel";
import { UserAvatar } from "@/components/shared/user-avatar";
import { day } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TeamWorkloadDTO } from "@/types/dto";
import { AVAILABILITY } from "./ticket-triage";

/** Who is carrying how much. Selecting a person opens their ticket queue below. */
export function TeamWorkload({ rows, selected, onSelect }: { rows: TeamWorkloadDTO[]; selected: string; onSelect: (id: string) => void }) {
  const count = (a: TeamWorkloadDTO["availability"]) => rows.filter((r) => r.availability === a).length;
  const busy = rows.filter((r) => r.activeItems > 0).length;
  const items = rows.reduce((n, r) => n + r.activeItems, 0);
  const multi = new Set(rows.map((r) => r.department)).size > 1;

  return (
    <Panel
      title="Team workload"
      description={`${busy} of ${rows.length} people are occupied · ${items} open item${items === 1 ? "" : "s"} (tickets and project tasks)`}
      action={
        <div className="hidden items-center gap-1.5 text-xs sm:flex">
          {(["AVAILABLE", "LIMITED", "FULL"] as const).map((k) => (
            <span key={k} className={cn("rounded-full border px-2 py-0.5 font-medium", AVAILABILITY[k].chip)}>{count(k)} {AVAILABILITY[k].label.toLowerCase()}</span>
          ))}
        </div>
      }
    >
      {!rows.length ? (
        <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"><Users className="size-4" /> No active employees in your departments yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-3 py-2 font-medium">Tickets</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">Project tasks</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Effort</th>
                <th className="min-w-28 px-3 py-2 font-medium">Load</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const a = AVAILABILITY[r.availability];
                const active = r.id === selected;
                return (
                  <tr key={r.id} className={cn("cursor-pointer hover:bg-muted/40", active && "bg-primary/5")} onClick={() => onSelect(r.id)} aria-selected={active}>
                    <td className="px-4 py-2">
                      <button type="button" className="flex items-center gap-2 text-left focus-visible:outline-none" onClick={(e) => { e.stopPropagation(); onSelect(r.id); }} aria-pressed={active}>
                        <UserAvatar name={r.name} src={r.avatarUrl} size="sm" />
                        <span className="min-w-0">
                          <span className={cn("block truncate font-medium", active && "text-primary")}>{r.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{[r.designation, multi ? r.department : ""].filter(Boolean).join(" · ")}</span>
                        </span>
                      </button>
                    </td>
                    <td className="tabular px-3 py-2">{r.ticketItems}</td>
                    <td className="tabular hidden px-3 py-2 sm:table-cell">{r.taskItems}</td>
                    <td className="tabular hidden px-3 py-2 whitespace-nowrap md:table-cell">
                      {r.openHours}h / {r.capacityHours}h
                      {r.overdue ? <span className="block text-xs font-medium text-red-600">{r.overdue} overdue</span> : r.nextDue ? <span className="block text-xs text-muted-foreground">next {format(day(r.nextDue), "d MMM")}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.min(100, r.loadPercent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.name} load`}>
                        <div className={cn("h-full rounded-full", a.bar)} style={{ width: `${Math.min(100, r.loadPercent)}%` }} />
                      </div>
                      <span className="tabular text-xs text-muted-foreground">{r.activeItems} active · {r.loadPercent}%{r.unestimatedItems ? " (est.)" : ""}</span>
                    </td>
                    <td className="px-3 py-2"><span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", a.chip)}>{a.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
