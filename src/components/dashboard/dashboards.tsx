import { day } from "@/lib/dates";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlarmClock,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FolderKanban,
  ListTodo,
  Loader,
  Ticket,
  Users,
  Bell,
} from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { TaskList } from "@/components/shared/task-list";
import { EmptyState } from "@/components/shared/states";
import { PriorityBadge, ProjectStatusBadge } from "@/components/shared/badges";
import { TicketStatusBadge } from "@/components/tickets/ticket-badges";
import type { TicketListItemDTO } from "@/types/dto";
import { Progress } from "@/components/ui/progress";
import type {
  AdminDashboard as AdminData,
  EmployeeDashboard as EmployeeData,
  ManagerDashboard as ManagerData,
  TeamDashboard as TeamData,
} from "@/services/dashboard.service";
import { cn } from "@/lib/utils";
import { Panel } from "./panel";
import { ActivityFeed } from "./activity-feed";
import { DepartmentPerformanceChart, TaskStatusDonut, WorkloadChart } from "./charts";

const grid4 = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4";

/** Compact list of internal tickets for dashboard panels. */
function TicketPanel({
  title,
  description,
  href,
  items,
  total,
  emptyTitle,
  emptyDescription,
  showRequester = true,
  className,
}: {
  title: string;
  description?: string;
  href: string;
  items: TicketListItemDTO[];
  total?: number;
  emptyTitle: string;
  emptyDescription?: string;
  showRequester?: boolean;
  className?: string;
}) {
  return (
    <Panel title={title} description={description ?? (total ? `${total} in total` : undefined)} href={href} className={className}>
      {items.length ? (
        <ul className="divide-y">
          {items.map((t) => (
            <li key={t.id}>
              <Link href={`/tickets/${t.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {t.awaitingMe ? <span className="size-2 shrink-0 rounded-full bg-primary" title="Waiting for you" /> : null}
                    <span className="truncate">{t.title}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 truncate text-xs text-muted-foreground">
                    <span className="font-mono">{t.ticketNumber}</span>
                    {showRequester ? <span>{t.requester?.name} → {t.targetDepartment?.name}</span> : <span>{t.targetDepartment?.name}{t.assignee ? ` · ${t.assignee.name}` : ""}</span>}
                    <PriorityBadge priority={t.priority} />
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <TicketStatusBadge status={t.status} />
                  <span className={cn("tabular text-xs", t.isOverdue ? "font-medium text-red-600" : "text-muted-foreground")}>
                    {t.isOverdue ? "Overdue · " : "Due "}
                    {format(day(t.dueDate), "d MMM")}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Ticket} title={emptyTitle} description={emptyDescription} className="py-8" />
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

export function AdminDashboardView({ data }: { data: AdminData }) {
  const s = data.stats;
  return (
    <div className="space-y-6">
      <div className={grid4}>
        <StatCard label="Employees" value={s.employees} icon={Users} hint={`${s.activeEmployees} active`} href="/employees" />
        <StatCard label="Departments" value={s.departments} icon={Building2} tone="blue" hint="Active departments" href="/departments" />
        <StatCard label="Active projects" value={s.activeProjects} icon={FolderKanban} tone="violet" hint="Status: Active" href="/projects" />
        <StatCard label="Total tasks" value={s.totalTasks} icon={ListTodo} tone="slate" hint={`${s.inReview} awaiting review`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Pending tasks" value={s.pendingTasks} icon={Clock} tone="amber" hint="Not completed or cancelled" />
        <StatCard label="Overdue tasks" value={s.overdueTasks} icon={AlarmClock} tone="red" hint="Past due date and still open" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Department performance" description="Tasks by department" className="xl:col-span-2" bodyClassName="p-4">
          <DepartmentPerformanceChart data={data.departmentPerformance} />
        </Panel>
        <Panel title="Task status" description="Company-wide distribution" bodyClassName="p-4">
          <TaskStatusDonut data={data.tasksByStatus} />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Department scorecard" description="Completion rate excludes cancelled tasks" className="xl:col-span-2" href="/departments">
          {data.departmentPerformance.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Department</th>
                    <th className="px-4 py-2.5 text-right font-medium">Employees</th>
                    <th className="px-4 py-2.5 text-right font-medium">Open</th>
                    <th className="px-4 py-2.5 text-right font-medium">Overdue</th>
                    <th className="w-48 px-4 py-2.5 font-medium">Completion</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.departmentPerformance.map((d) => (
                    <tr key={d.id} className="hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/departments/${d.id}`} className="flex items-center gap-2 font-medium hover:text-primary">
                          <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                          {d.name}
                        </Link>
                      </td>
                      <td className="tabular px-4 py-2.5 text-right">{d.employees}</td>
                      <td className="tabular px-4 py-2.5 text-right">{d.open}</td>
                      <td className={cn("tabular px-4 py-2.5 text-right", d.overdue && "font-medium text-red-600")}>{d.overdue}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Progress value={d.completionRate} className="h-1.5" />
                          <span className="tabular w-9 text-right text-xs text-muted-foreground">{d.completionRate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Building2} title="No departments yet" className="py-10" />
          )}
        </Panel>
        <Panel title="Recent activity" description="Latest changes across WorkHub" bodyClassName="max-h-[420px] overflow-y-auto scrollbar-thin">
          <ActivityFeed items={data.recentActivity} />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Upcoming deadlines" description="Open tasks due in the next 7 days">
          <TaskList tasks={data.upcomingDeadlines} emptyTitle="No deadlines this week" />
        </Panel>
        <TicketPanel
          title="Tickets awaiting assignment"
          href="/tickets"
          items={data.ticketQueue.items}
          total={data.ticketQueue.total}
          emptyTitle="No new tickets"
          emptyDescription="New and under-review internal requests appear here."
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function ManagerDashboardView({ data }: { data: ManagerData }) {
  const s = data.stats;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Managed projects" value={s.managedProjects} icon={FolderKanban} href="/projects" />
        <StatCard label="Pending tasks" value={s.pendingTasks} icon={Clock} tone="amber" />
        <StatCard label="Awaiting review" value={s.awaitingReview} icon={ClipboardCheck} tone="violet" />
        <StatCard label="Due this week" value={s.upcomingDeadlines} icon={CalendarClock} tone="blue" />
        <StatCard label="Overdue" value={s.overdueTasks} icon={AlarmClock} tone="red" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Project progress" description="Completed ÷ (all tasks − cancelled)" className="xl:col-span-2" href="/projects">
          {data.projects.length ? (
            <ul className="divide-y">
              {data.projects.map((p) => (
                <li key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <Link href={`/projects/${p.id}`} className="flex items-center gap-2 truncate text-sm font-medium hover:text-primary">
                      {p.name} <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {p.completedTasks}/{p.completedTasks + p.openTasks} tasks done
                      {p.endDate ? ` · Due ${format(day(p.endDate), "d MMM yyyy")}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:w-64">
                    <Progress value={p.progress} className="h-1.5" />
                    <span className="tabular w-9 text-right text-xs text-muted-foreground">{p.progress}%</span>
                    <ProjectStatusBadge status={p.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={FolderKanban} title="No managed projects" description="Projects you manage will appear here." className="py-10" />
          )}
        </Panel>
        <Panel title="Task status" description="Across your projects" bodyClassName="p-4">
          <TaskStatusDonut data={data.tasksByStatus} />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Tasks awaiting review" href="/tasks">
          <TaskList tasks={data.reviewQueue} emptyTitle="Nothing to review" />
        </Panel>
        <Panel title="Upcoming deadlines" description="Overdue and due within 7 days">
          <TaskList tasks={data.deadlines} emptyTitle="No upcoming deadlines" />
        </Panel>
        <TicketPanel
          title="New internal tickets"
          description={data.ticketQueue.total ? `${data.ticketQueue.total} waiting for review or assignment` : "Waiting for review or assignment"}
          href="/tickets"
          items={data.ticketQueue.items}
          emptyTitle="No new tickets"
          emptyDescription="You're all caught up."
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function TeamDashboardView({ data }: { data: TeamData }) {
  const s = data.stats;
  const isDept = data.scope === "department";
  return (
    <div className="space-y-6">
      {data.departments.length ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {isDept ? "Departments you head:" : "Departments you lead in:"}
          {data.departments.map((d) => (
            <Link key={d.id} href={`/departments/${d.id}`} className="rounded-full border bg-card px-2.5 py-0.5 font-medium text-foreground hover:border-primary/50">
              {d.name}
            </Link>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={isDept ? "Department employees" : "Team members"} value={s.employees} icon={Users} href="/employees" />
        <StatCard label="Active tasks" value={s.activeTasks} icon={Loader} tone="blue" />
        <StatCard label="Pending reviews" value={s.pendingReviews} icon={ClipboardCheck} tone="violet" />
        <StatCard label="Overdue work" value={s.overdueTasks} icon={AlarmClock} tone="red" />
        <StatCard label="Completed this month" value={s.completedThisMonth} icon={CheckCircle2} tone="green" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Team workload" description="Open tasks per active member" className="xl:col-span-2" bodyClassName="p-4">
          <WorkloadChart data={data.workload} />
        </Panel>
        <Panel title="Task status" bodyClassName="p-4">
          <TaskStatusDonut data={data.tasksByStatus} />
        </Panel>
      </div>

      <div className={cn("grid gap-6", isDept ? "xl:grid-cols-3" : "lg:grid-cols-2")}>
        <Panel title="Pending reviews" description="Tasks submitted for review">
          <TaskList tasks={data.reviewQueue} emptyTitle="Nothing waiting for review" />
        </Panel>
        <Panel title="Overdue work">
          <TaskList tasks={data.overdue} emptyTitle="No overdue work" emptyDescription="Your team is on schedule." />
        </Panel>
        {isDept ? (
          <TicketPanel
            title="Requests to your departments"
            description={data.departmentTickets.total ? `${data.departmentTickets.total} open` : "Open internal tickets"}
            href="/tickets"
            items={data.departmentTickets.items}
            emptyTitle="No open requests"
            emptyDescription="Internal tickets sent to departments you head appear here."
          />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function EmployeeDashboardView({ data }: { data: EmployeeData }) {
  const s = data.stats;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="My open tasks" value={s.myOpenTasks} icon={ListTodo} href="/my-tasks" />
        <StatCard label="Due today" value={s.dueToday} icon={CalendarClock} tone="amber" />
        <StatCard label="In progress" value={s.inProgress} icon={Loader} tone="blue" />
        <StatCard label="Completed" value={s.completed} icon={CheckCircle2} tone="green" />
        <StatCard label="Overdue" value={s.overdue} icon={AlarmClock} tone="red" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="My tasks" description="Open tasks, soonest deadline first" className="xl:col-span-2" href="/my-tasks">
          <TaskList tasks={data.myTasks} showOwner={false} emptyTitle="No open tasks" emptyDescription="Tasks assigned to you will show up here." />
        </Panel>
        <Panel title="Today's deadlines">
          <TaskList tasks={data.todaysDeadlines} showOwner={false} emptyTitle="Nothing due today" />
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Recent notifications" href="/notifications">
          {data.notifications.length ? (
            <ul className="divide-y">
              {data.notifications.map((n) => (
                <li key={n.id} className="flex gap-3 px-4 py-3">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.isRead ? "bg-border" : "bg-primary")} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{n.title}</p>
                    {n.message ? <p className="truncate text-xs text-muted-foreground">{n.message}</p> : null}
                    <p className="text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Bell} title="No notifications" className="py-10" />
          )}
        </Panel>
        <TicketPanel
          title="My tickets"
          description="Open requests you've raised"
          href="/my-tickets"
          items={data.myTickets}
          showRequester={false}
          emptyTitle="No open tickets"
          emptyDescription="Need help from another department? Raise a ticket from My Tickets."
        />
      </div>
    </div>
  );
}
