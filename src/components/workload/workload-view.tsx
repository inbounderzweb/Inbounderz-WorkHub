"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, ArrowDown, ArrowUp, FilterX, Gauge, Minus, Search, UserCheck, UserMinus, Users, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Panel } from "@/components/dashboard/panel";
import { DataPagination } from "@/components/shared/data-pagination";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher, qs } from "@/lib/http";
import { cn } from "@/lib/utils";
import type { EmployeeWorkloadDTO, WorkloadCategory, WorkloadEmployeesDTO, WorkloadOverviewDTO, WorkloadPeriod } from "@/types/dto";
import { EmployeeDrawer } from "./employee-drawer";
import { CATEGORY } from "./meta";
import { DepartmentChart, DistributionChart, TrendChart, UtilizationChart } from "./workload-charts";
import { WorkloadSettingsDialog } from "./workload-settings-dialog";

const ALL = "__all";

const CARDS: { key: WorkloadCategory | "TOTAL"; icon: typeof Users }[] = [
  { key: "TOTAL", icon: UsersRound },
  { key: "NONE", icon: UserMinus },
  { key: "LOW", icon: UserCheck },
  { key: "MODERATE", icon: Users },
  { key: "HIGH", icon: Gauge },
  { key: "OVERLOADED", icon: AlertTriangle },
];

function Delta({ now, before, good }: { now: number; before: number | undefined; good: "up" | "down" | "none" }) {
  if (before === undefined) return null;
  const d = now - before;
  if (!d) return <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Minus className="size-3" />same as before</span>;
  const better = good === "none" ? null : (d > 0) === (good === "up");
  return (
    <span className={cn("inline-flex items-center gap-0.5", better === null ? "text-muted-foreground" : better ? "text-emerald-600" : "text-red-600")}>
      {d > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}{Math.abs(d)} vs previous
    </span>
  );
}

function Utilization({ r }: { r: EmployeeWorkloadDTO }) {
  const m = CATEGORY[r.category];
  return (
    <div className="min-w-28">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.min(100, r.utilization)} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.name} utilization`}>
        <div className={cn("h-full rounded-full", m.bar)} style={{ width: `${Math.min(100, r.utilization)}%` }} />
      </div>
      <span className="tabular text-xs text-muted-foreground" title={r.estimated ? `${r.unestimatedItems} item(s) have no estimate and are counted at the default hours` : undefined}>
        {r.estimated && r.activeItems ? "~" : ""}{r.utilization}% · {r.workloadHours}h/{r.capacityHours}h
      </span>
    </div>
  );
}

export function WorkloadView() {
  const [period, setPeriod] = useState<WorkloadPeriod>("week");
  const [department, setDepartment] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState<WorkloadCategory | "">("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("highest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [open, setOpen] = useState<string | null>(null);

  const base = { period, department, project };
  const { data: overview, error: overviewError, mutate: mutateOverview } = useSWR<WorkloadOverviewDTO>(`/api/workload${qs(base)}`, fetcher, { keepPreviousData: true, refreshInterval: 60_000 });
  const { data, error, isLoading, mutate } = useSWR<WorkloadEmployeesDTO>(`/api/workload/employees${qs({ ...base, status, q, sort, page, pageSize })}`, fetcher, { keepPreviousData: true, refreshInterval: 60_000 });

  const filtersActive = !!(department || project || status || q);
  const reset = () => { setDepartment(""); setProject(""); setStatus(""); setQ(""); setPage(1); };
  const pick = (fn: (v: string) => void) => (v: string) => { fn(v === ALL ? "" : v); setPage(1); };
  const setCategory = (c: WorkloadCategory | "") => { setStatus(c); setPage(1); };
  const items = data?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Workload"
        description="Who is free, who is busy and who is overloaded, based on estimated hours of active work against working hours."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={period} onValueChange={(v) => { setPeriod(v as WorkloadPeriod); setPage(1); }}>
              <TabsList aria-label="Reporting period"><TabsTrigger value="week">Weekly</TabsTrigger><TabsTrigger value="month">Monthly</TabsTrigger></TabsList>
            </Tabs>
            {overview?.canConfigure ? <WorkloadSettingsDialog settings={overview.settings} onSaved={() => { void mutateOverview(); void mutate(); }} /> : null}
          </div>
        }
      />

      {overviewError ? <ErrorState message={overviewError.message} onRetry={() => mutateOverview()} /> : null}

      {/* Summary cards: each one filters the table */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {CARDS.map(({ key, icon: Icon }) => {
          const total = overview?.total ?? 0;
          const value = key === "TOTAL" ? total : (overview?.counts[key] ?? 0);
          const prev = key === "TOTAL" ? overview?.previousTotal : overview?.previous?.[key];
          const active = key !== "TOTAL" && status === key;
          const meta = key === "TOTAL" ? null : CATEGORY[key];
          return (
            <button
              key={key}
              type="button"
              disabled={!overview}
              onClick={() => setCategory(key === "TOTAL" || active ? "" : key)}
              aria-pressed={active}
              className={cn("rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:bg-accent/30 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", active && "ring-2 ring-primary/60")}
            >
              {!overview ? <Skeleton className="h-16" /> : (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">{meta ? meta.card : "Total Employees"}</p>
                    <p className="tabular text-2xl font-semibold tracking-tight">{value}</p>
                    <p className="text-xs text-muted-foreground">{key === "TOTAL" ? `${overview.capacityHours}h capacity each` : `${total ? Math.round((value / total) * 100) : 0}% of employees`}</p>
                    <p className="text-[11px]"><Delta now={value} before={prev} good={key === "NONE" || key === "LOW" ? "none" : key === "HIGH" || key === "OVERLOADED" ? "down" : "none"} /></p>
                  </div>
                  <span className="mt-0.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta?.color ?? "var(--primary)" }} />
                  <Icon className="sr-only" />
                </div>
              )}
            </button>
          );
        })}
      </div>
      {overview?.previous ? <p className="-mt-3 text-[11px] text-muted-foreground">Comparison is against one {period} ago, rebuilt from assignment and completion history. On-hold and review weighting can&apos;t be replayed, so it is approximate.</p> : null}

      {/* Charts */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Workload distribution" description="Click a segment to filter the table">
          <div className="p-4">{overview ? <DistributionChart counts={overview.counts} total={overview.total} selected={status} onSelect={setCategory} /> : <Skeleton className="h-48" />}</div>
        </Panel>
        <Panel title="Department comparison" description="Employees by workload level. Click a bar to filter by department">
          <div className="p-4">{overview ? <DepartmentChart rows={overview.departments} selected={department} onSelect={(id) => { setDepartment(id); setPage(1); }} /> : <Skeleton className="h-48" />}</div>
        </Panel>
        <Panel title="Individual utilization" description={`Top ${data?.chart.length ?? 0} of the filtered list · dashed line = 100% of capacity`}>
          <div className="p-4">{data ? <UtilizationChart rows={data.chart} onOpen={setOpen} /> : <Skeleton className="h-48" />}</div>
        </Panel>
        <Panel title="Workload trend" description={period === "week" ? "Last 8 weeks" : "Last 6 months"}>
          <div className="p-4">{overview ? <TrendChart data={overview.trend} /> : <Skeleton className="h-48" />}</div>
        </Panel>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search employee name…" className="pl-8" aria-label="Search employees" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={department || ALL} onValueChange={pick(setDepartment)}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Department"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>All departments</SelectItem>{overview?.filters.departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={project || ALL} onValueChange={pick(setProject)}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Project"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>All projects</SelectItem>{overview?.filters.projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={status || ALL} onValueChange={(v) => setCategory(v === ALL ? "" : (v as WorkloadCategory))}>
              <SelectTrigger className="w-full sm:w-48" aria-label="Workload status"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>All workload levels</SelectItem>{(Object.keys(CATEGORY) as WorkloadCategory[]).map((c) => <SelectItem key={c} value={c}>{CATEGORY[c].label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Sort"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="highest">Highest workload</SelectItem>
                <SelectItem value="lowest">Lowest workload</SelectItem>
                <SelectItem value="available">Most free capacity</SelectItem>
                <SelectItem value="overdue">Most overdue</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive ? <Button variant="ghost" onClick={reset}><FilterX /> Clear</Button> : null}
          </div>
        </div>
        {project ? <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">Filtered by project: only that project&apos;s tasks are counted. Tickets don&apos;t belong to projects, so they are left out.</p> : null}

        {error ? <ErrorState message={error.message} onRetry={() => mutate()} /> : isLoading && !data ? <TableSkeleton rows={6} cols={8} /> : !items.length ? (
          <EmptyState icon={Users} title={filtersActive ? "No employees match your filters" : "No employees in your scope"} description={filtersActive ? "Try adjusting the filters." : "Employees show up here once they belong to a department or project you manage."} action={filtersActive ? <Button variant="outline" size="sm" onClick={reset}>Clear filters</Button> : null} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Employee</TableHead>
                  <TableHead className="hidden lg:table-cell">Department</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Pending</TableHead>
                  <TableHead className="hidden text-right md:table-cell">In progress</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">On hold</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">Review</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Overdue</TableHead>
                  <TableHead>Utilization</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead className="pr-4 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4">
                      <button type="button" onClick={() => setOpen(r.id)} className="flex items-center gap-2 text-left hover:text-primary focus-visible:outline-none">
                        <UserAvatar name={r.name} src={r.avatarUrl} size="sm" />
                        <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block truncate text-xs text-muted-foreground">{r.designation}</span></span>
                      </button>
                    </TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{r.department?.name ?? "—"}</TableCell>
                    <TableCell className="tabular text-right font-medium">{r.activeItems}<span className="block text-[11px] font-normal text-muted-foreground">{r.ticketItems}T · {r.taskItems}P</span></TableCell>
                    <TableCell className="tabular hidden text-right md:table-cell">{r.pending}</TableCell>
                    <TableCell className="tabular hidden text-right md:table-cell">{r.inProgress}</TableCell>
                    <TableCell className="tabular hidden text-right xl:table-cell">{r.onHold}</TableCell>
                    <TableCell className="tabular hidden text-right xl:table-cell">{r.review}</TableCell>
                    <TableCell className={cn("tabular hidden text-right sm:table-cell", r.overdue ? "font-medium text-red-600" : "text-muted-foreground")}>{r.overdue}</TableCell>
                    <TableCell><Utilization r={r} /></TableCell>
                    <TableCell><span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", CATEGORY[r.category].chip)}>{CATEGORY[r.category].label}</span></TableCell>
                    <TableCell className="pr-4">
                      <span className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setOpen(r.id)}>Details</Button>
                        <Button variant="outline" size="sm" asChild><Link href="/tickets?scope=queue">Assign</Link></Button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataPagination page={data!.page} pageSize={data!.pageSize} total={data!.total} totalPages={data!.totalPages} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} label="employees" />
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">T = tickets assigned, P = project tasks owned. Collaborating on a task doesn&apos;t add to someone&apos;s load; completed and cancelled work is never counted. &quot;~&quot; marks utilization that includes work without an estimate.</p>

      <EmployeeDrawer employeeId={open} period={period} onClose={() => setOpen(null)} />
    </div>
  );
}
