"use client";

import { useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import {
  AlarmClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  FolderKanban,
  Gauge,
  Inbox,
  ListTodo,
  Loader,
  Timer,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, EmptyState } from "@/components/shared/states";
import { StatCard, StatCardSkeleton } from "@/components/shared/stat-card";
import { Panel } from "@/components/dashboard/panel";
import { TaskStatusDonut } from "@/components/dashboard/charts";
import { useTicketDepartments } from "@/hooks/use-ticket-options";
import { fetcher, qs } from "@/lib/http";
import { day } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ReportsDTO, TaskStats, TicketStats } from "@/services/report.service";
import { DailyHoursChart, ProjectCompletionChart, StackedWorkChart, TicketStatusChart, TrendChart } from "./report-charts";

type Section = "company" | "project" | "department" | "personal";
const ALL = "__all";
const fmtHours = (h: number | null) => (h == null ? "—" : h < 1 ? "< 1 h" : h < 48 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} d`);

function TaskTiles({ s, scope }: { s: TaskStats; scope: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatCard label="Total tasks" value={s.total} icon={ListTodo} tone="slate" hint={scope} />
      <StatCard label="Completed" value={s.completed} icon={CheckCircle2} tone="green" hint={`${s.completionRate}% completion rate`} />
      <StatCard label="Pending" value={s.pending} icon={Clock} tone="amber" hint="Not completed or cancelled" />
      <StatCard label="In progress" value={s.inProgress} icon={Loader} tone="blue" hint={`${s.inReview} in review`} />
      <StatCard label="Overdue" value={s.overdue} icon={AlarmClock} tone="red" hint="Open and past due" />
    </div>
  );
}

function TicketTiles({ t, label }: { t: TicketStats; label: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label={label} value={t.total} icon={Inbox} tone="violet" hint={`${t.open} open · ${t.closed} closed`} />
      <StatCard label="Overdue tickets" value={t.overdue} icon={AlarmClock} tone="red" />
      <StatCard label="Avg. time to assign" value={fmtHours(t.avgHoursToAssign)} icon={UserCheck} tone="blue" hint="Raised → first assignment" />
      <StatCard label="Avg. time to close" value={fmtHours(t.avgHoursToClose)} icon={Timer} tone="green" hint="Raised → confirmed closed" />
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>;
}

function StatusDonutCard({ data, title }: { data: ReportsDTO["personal"]["statusDistribution"]; title: string }) {
  return (
    <Panel title={title} bodyClassName="p-4">
      <TaskStatusDonut data={data} />
    </Panel>
  );
}

export function ReportsView() {
  const [months, setMonths] = useState(6);
  const [department, setDepartment] = useState("");
  const [section, setSection] = useState<Section | null>(null);
  const { data, error, isLoading, mutate } = useSWR<ReportsDTO>(`/api/reports${qs({ months, department })}`, fetcher, { keepPreviousData: true });
  const { data: departments } = useTicketDepartments(!!data?.sections.company);

  const available: { key: Section; label: string }[] = data
    ? [
        ...(data.sections.company ? [{ key: "company" as const, label: "Company" }] : []),
        ...(data.sections.project ? [{ key: "project" as const, label: "My projects" }] : []),
        ...(data.sections.department ? [{ key: "department" as const, label: "My department" }] : []),
        { key: "personal" as const, label: "My work" },
      ]
    : [];
  const active = section && available.some((a) => a.key === section) ? section : available[0]?.key;
  const exports = [
    { key: "tasks", label: "Tasks" },
    { key: "projects", label: "Projects" },
    { key: "tickets", label: "Internal tickets" },
    { key: "daily-updates", label: "Daily work updates" },
    ...(data && (data.sections.company || data.sections.project || data.sections.department)
      ? [{ key: "departments", label: "Department performance" }, { key: "workload", label: "Employee workload" }]
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports & Analytics"
        description={data ? `Calculated live from WorkHub data · ${format(new Date(data.generatedAt), "d MMM yyyy, HH:mm")}` : "Calculated live from WorkHub data"}
        actions={
          <>
            <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
              <SelectTrigger className="w-40" aria-label="Trend period"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Last 3 months</SelectItem>
                <SelectItem value="6">Last 6 months</SelectItem>
                <SelectItem value="12">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline"><Download /> Export CSV</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Only data you can access</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {exports.map((e) => (
                  <DropdownMenuItem key={e.key} asChild>
                    <a href={`/api/reports/export?dataset=${e.key}`} download>{e.label}</a>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {available.length > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={active} onValueChange={(v) => setSection(v as Section)}>
            <TabsList>{available.map((a) => <TabsTrigger key={a.key} value={a.key}>{a.label}</TabsTrigger>)}</TabsList>
          </Tabs>
          {active === "company" ? (
            <Select value={department || ALL} onValueChange={(v) => setDepartment(v === ALL ? "" : v)}>
              <SelectTrigger className="w-52" aria-label="Department"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {departments?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border bg-card"><ErrorState message={error.message} onRetry={() => mutate()} /></div>
      ) : isLoading && !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <StatCardSkeleton key={i} />)}</div>
      ) : !data ? null : (
        <div className={cn("space-y-5", isLoading && "opacity-60")}>
          {active === "company" && data.company ? (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Projects" value={data.company.projects.total} icon={FolderKanban} hint={data.company.projects.byStatus.filter((s) => s.count).map((s) => `${s.count} ${s.status.toLowerCase().replace("_", " ")}`).join(" · ")} />
                <StatCard label="Average progress" value={`${data.company.projects.averageProgress}%`} icon={Gauge} tone="green" hint="Across non-archived projects" />
                <StatCard label="Open tickets" value={data.company.tickets.open} icon={Inbox} tone="violet" hint={`${data.company.tickets.total} raised in total`} />
                <StatCard label="Active employees with work" value={data.company.workload.filter((w) => w.open).length} icon={UserCheck} tone="blue" hint="Owners of open tasks (top 15 shown)" />
              </div>
              <TaskTiles s={data.company.tasks} scope={department ? "Selected department" : "Company-wide"} />
              <div className="grid gap-5 xl:grid-cols-3">
                <ProjectCompletionChart data={data.company.projectCompletion} title="Project completion (open projects)" className="xl:col-span-2" />
                <StatusDonutCard data={data.company.statusDistribution} title="Task status distribution" />
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <StackedWorkChart title="Department workload" description="Tasks per department" data={data.company.departments.map((d) => ({ name: d.name, completed: d.completed, open: d.open, overdue: d.overdue }))} nameLabel="Department" />
                <StackedWorkChart title="Employee task distribution" description="Top 15 owners by open tasks" data={data.company.workload} nameLabel="Employee" />
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <TrendChart data={data.company.trend} />
                <TicketStatusChart data={data.company.tickets.byStatus} />
              </div>
              <TicketTiles t={data.company.tickets} label="Internal tickets" />
              <Panel title="Department performance" description="Completion rate excludes cancelled tasks">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="pl-4">Department</TableHead>
                        <TableHead className="text-right">Tasks</TableHead>
                        <TableHead className="text-right">Completed</TableHead>
                        <TableHead className="text-right">Open</TableHead>
                        <TableHead className="text-right">Overdue</TableHead>
                        <TableHead className="pr-4 text-right">Completion</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.company.departments.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="pl-4"><span className="inline-flex items-center gap-2"><span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />{d.name}</span></TableCell>
                          <TableCell className="tabular text-right">{d.total}</TableCell>
                          <TableCell className="tabular text-right">{d.completed}</TableCell>
                          <TableCell className="tabular text-right">{d.open}</TableCell>
                          <TableCell className={cn("tabular text-right", d.overdue && "font-medium text-red-600")}>{d.overdue}</TableCell>
                          <TableCell className="tabular pr-4 text-right">{d.completionRate}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Panel>
            </>
          ) : null}

          {active === "project" && data.project ? (
            <>
              <TaskTiles s={data.project.tasks} scope={`${data.project.projects.length} managed project(s)`} />
              <div className="grid gap-5 xl:grid-cols-3">
                <ProjectCompletionChart data={data.project.projects} title="Managed project progress" className="xl:col-span-2" />
                <StatusDonutCard data={data.project.statusDistribution} title="Task status (managed projects)" />
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <StackedWorkChart title="Department task performance" description="Tasks in your projects, per department" data={data.project.departments.map((d) => ({ name: d.name, completed: d.completed, open: d.open, overdue: d.overdue }))} nameLabel="Department" />
                <TrendChart data={data.project.trend} />
              </div>
              <Heading>Internal tickets you manage</Heading>
              <TicketTiles t={data.project.tickets} label="Tickets in scope" />
              <div className="grid gap-5 xl:grid-cols-2">
                <Panel title="Ticket assignment performance" description="Per assignee (current and past assignments)">
                  {data.project.tickets.assignees.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="pl-4">Assignee</TableHead>
                          <TableHead className="text-right">Assigned</TableHead>
                          <TableHead className="text-right">Active</TableHead>
                          <TableHead className="text-right">Closed</TableHead>
                          <TableHead className="pr-4 text-right">Avg. to close</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.project.tickets.assignees.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="pl-4">{a.name}</TableCell>
                            <TableCell className="tabular text-right">{a.assigned}</TableCell>
                            <TableCell className="tabular text-right">{a.active}</TableCell>
                            <TableCell className="tabular text-right">{a.closed}</TableCell>
                            <TableCell className="tabular pr-4 text-right">{fmtHours(a.avgHoursToClose)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : <EmptyState icon={Inbox} title="No tickets assigned yet" className="py-8" />}
                </Panel>
                <TicketStatusChart data={data.project.tickets.byStatus} />
              </div>
              <Panel title="Project deadlines" description="Open projects and milestones, soonest first">
                {data.project.deadlines.length ? (
                  <ul className="divide-y">
                    {data.project.deadlines.map((d, i) => (
                      <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <span className="w-20 shrink-0 text-xs text-muted-foreground uppercase">{d.type}</span>
                        <span className="min-w-0 flex-1 truncate font-medium">{d.title}{d.type === "milestone" ? <span className="font-normal text-muted-foreground"> · {d.project}</span> : null}</span>
                        <span className={cn("tabular shrink-0 text-xs", d.overdue ? "font-medium text-red-600" : "text-muted-foreground")}>{d.overdue ? "Overdue · " : ""}{format(day(d.date), "d MMM yyyy")}</span>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState icon={FolderKanban} title="No upcoming deadlines" className="py-8" />}
              </Panel>
            </>
          ) : null}

          {active === "department" && data.department ? (
            <>
              <p className="text-sm text-muted-foreground">Departments: {data.department.departments.map((d) => d.name).join(", ")}</p>
              <TaskTiles s={data.department.tasks} scope="Department tasks" />
              <div className="grid gap-5 xl:grid-cols-3">
                <StackedWorkChart title="Employee workload" description="Tasks per employee in your departments" data={data.department.workload} nameLabel="Employee" />
                <StatusDonutCard data={data.department.statusDistribution} title="Department task status" />
              </div>
              <Heading>Internal requests received</Heading>
              <TicketTiles t={data.department.ticketsReceived} label="Requests received" />
              <div className="grid gap-5 xl:grid-cols-2">
                <TicketStatusChart data={data.department.ticketsReceived.byStatus} title="Requests received by status" />
                <TrendChart data={data.department.trend} />
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Daily reports (30 days)" value={data.department.dailyUpdates.reports} icon={ClipboardList} />
                <StatCard label="Hours reported" value={data.department.dailyUpdates.hours} icon={Clock} tone="blue" />
                <StatCard label="Awaiting your review" value={data.department.dailyUpdates.pendingReview} icon={ClipboardList} tone="violet" href="/daily-updates?tab=team" />
                <StatCard label="Employees reporting" value={data.department.dailyUpdates.employeesReporting} icon={UserCheck} tone="green" />
              </div>
            </>
          ) : null}

          {active === "personal" ? (
            <>
              <TaskTiles s={data.personal.stats} scope="Tasks you own" />
              <div className="grid gap-5 xl:grid-cols-3">
                <div className="xl:col-span-2"><TrendChart data={data.personal.trend} /></div>
                <StatusDonutCard data={data.personal.statusDistribution} title="My task status" />
              </div>
              <div className="grid gap-5 xl:grid-cols-3">
                <div className="xl:col-span-2"><DailyHoursChart data={data.personal.dailyHours} /></div>
                <Panel title="Daily reports" bodyClassName="divide-y" href="/daily-updates">
                  {[
                    ["Submitted in total", data.personal.reports.total],
                    ["Approved", data.personal.reports.approved],
                    ["Awaiting review", data.personal.reports.pending],
                    ["Changes requested", data.personal.reports.changesRequested],
                    ["Hours reported", data.personal.reports.hours],
                  ].map(([k, v]) => (
                    <div key={k as string} className="flex justify-between px-4 py-2.5 text-sm"><span className="text-muted-foreground">{k}</span><span className="tabular font-medium">{v}</span></div>
                  ))}
                </Panel>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
