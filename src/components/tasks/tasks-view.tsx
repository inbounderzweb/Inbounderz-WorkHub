"use client";

import { day } from "@/lib/dates";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  AlertOctagon,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FilterX,
  GitBranch,
  List,
  ListChecks,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { DataPagination } from "@/components/shared/data-pagination";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { PriorityBadge, TASK_STATUS_COLORS } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useCan } from "@/components/providers/user-provider";
import { useDebounce } from "@/hooks/use-debounce";
import { useDepartmentOptions } from "@/hooks/use-options";
import { useProjectOptions } from "@/hooks/use-work-options";
import { fetcher, qs } from "@/lib/http";
import { TASK_PRIORITIES, TASK_STATUSES, humanize, type TaskStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Paginated, TaskListItemDTO } from "@/types/dto";
import { TaskFormDialog } from "./task-form-dialog";
import { changeStatus, TaskStatusMenu } from "./task-status";

const ALL = "__all";
type View = "list" | "board" | "calendar";

function DueLabel({ t }: { t: TaskListItemDTO }) {
  if (!t.dueDate) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("tabular whitespace-nowrap", t.isOverdue ? "font-medium text-red-600" : "text-muted-foreground")}>
      {t.isOverdue ? "Overdue · " : ""}
      {format(day(t.dueDate), "d MMM")}
    </span>
  );
}

function TaskMeta({ t }: { t: TaskListItemDTO }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      {t.isBlocked ? <span className="inline-flex items-center gap-0.5 font-medium text-red-600"><AlertOctagon className="size-3" /> Blocked</span> : null}
      {t.checklist.total ? <span className="inline-flex items-center gap-0.5"><ListChecks className="size-3" /> {t.checklist.done}/{t.checklist.total}</span> : null}
      {t.subtaskCount ? <span className="inline-flex items-center gap-0.5"><GitBranch className="size-3" /> {t.subtaskCount}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */

function ListView({ items, scope, onChanged }: { items: TaskListItemDTO[]; scope: "mine" | "all"; onChanged: () => void }) {
  const router = useRouter();
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className="pl-4">Task</TableHead>
          <TableHead className="hidden lg:table-cell">Project</TableHead>
          <TableHead className="hidden xl:table-cell">Department</TableHead>
          <TableHead className="hidden md:table-cell">{scope === "mine" ? "Assigned by" : "Owner"}</TableHead>
          <TableHead className="hidden sm:table-cell">Priority</TableHead>
          <TableHead>Due</TableHead>
          <TableHead className="pr-4">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((t) => {
          const person = scope === "mine" ? t.assignedBy : t.owner;
          return (
            <TableRow key={t.id} className="cursor-pointer" onClick={() => router.push(`/tasks/${t.id}`)}>
              <TableCell className="max-w-[340px] pl-4">
                <Link href={`/tasks/${t.id}`} onClick={(e) => e.stopPropagation()} className="block min-w-0">
                  <span className="block truncate font-medium hover:text-primary">{t.title}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{t.taskNumber}</span>
                    {t.parentTask ? <span className="truncate">↳ {t.parentTask.taskNumber}</span> : null}
                    <TaskMeta t={t} />
                  </span>
                </Link>
              </TableCell>
              <TableCell className="hidden max-w-48 truncate text-sm lg:table-cell">{t.project?.name ?? "—"}</TableCell>
              <TableCell className="hidden xl:table-cell">
                {t.department ? (
                  <span className="inline-flex items-center gap-1.5 text-sm"><span className="size-2 rounded-full" style={{ backgroundColor: t.department.color }} />{t.department.name}</span>
                ) : "—"}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {person ? <span className="flex items-center gap-2"><UserAvatar name={person.name} size="sm" /><span className="max-w-32 truncate text-sm">{person.name}</span></span> : "—"}
              </TableCell>
              <TableCell className="hidden sm:table-cell"><PriorityBadge priority={t.priority} /></TableCell>
              <TableCell className="text-sm"><DueLabel t={t} /></TableCell>
              <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                <TaskStatusMenu taskId={t.id} status={t.status} allowed={t.allowedStatuses} onChanged={onChanged} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/* ------------------------------------------------------------------ */

function BoardView({ items, onChanged, hideClosed }: { items: TaskListItemDTO[]; onChanged: () => void; hideClosed: boolean }) {
  const [dragging, setDragging] = useState<TaskListItemDTO | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const columns = TASK_STATUSES.filter((s) => !(hideClosed && s === "CANCELLED"));

  async function drop(status: TaskStatus) {
    const t = dragging;
    setDragging(null);
    setOver(null);
    if (!t || t.status === status) return;
    if (!t.allowedStatuses.includes(status)) return;
    if (await changeStatus(t.id, status)) onChanged();
  }

  return (
    <div className="flex gap-3 overflow-x-auto p-3 scrollbar-thin">
      {columns.map((status) => {
        const cards = items.filter((t) => t.status === status);
        const droppable = !!dragging && dragging.status !== status && dragging.allowedStatuses.includes(status);
        return (
          <section
            key={status}
            onDragOver={(e) => {
              if (droppable) {
                e.preventDefault();
                setOver(status);
              }
            }}
            onDragLeave={() => setOver((o) => (o === status ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              drop(status);
            }}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30 transition-colors",
              dragging && !droppable && dragging.status !== status && "opacity-50",
              droppable && "border-dashed border-primary/60",
              over === status && "bg-accent"
            )}
            aria-label={`${humanize(status)} column`}
          >
            <header className="flex items-center justify-between px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: TASK_STATUS_COLORS[status] }} />
                {humanize(status)}
              </span>
              <span className="tabular rounded-full bg-background px-2 text-xs text-muted-foreground">{cards.length}</span>
            </header>
            <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
              {cards.map((t) => (
                <Link
                  key={t.id}
                  href={`/tasks/${t.id}`}
                  draggable={t.allowedStatuses.length > 0}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(t);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  className={cn(
                    "block space-y-2 rounded-lg border bg-card p-3 shadow-xs transition hover:border-primary/40",
                    t.allowedStatuses.length && "cursor-grab active:cursor-grabbing",
                    dragging?.id === t.id && "opacity-50"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">{t.taskNumber}</span>
                    <PriorityBadge priority={t.priority} />
                  </div>
                  <p className="line-clamp-2 text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.project?.name}</p>
                  <div className="flex items-center justify-between gap-2">
                    <TaskMeta t={t} />
                    <span className="flex items-center gap-2 text-xs">
                      <DueLabel t={t} />
                      {t.owner ? <UserAvatar name={t.owner.name} size="sm" /> : null}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CalendarView({ items, month, setMonth }: { items: TaskListItemDTO[]; month: Date; setMonth: (d: Date) => void }) {
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) });
  const noDue = items.filter((t) => !t.dueDate).length;
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => setMonth(subMonths(month, 1))} aria-label="Previous month"><ChevronLeft /></Button>
          <Button variant="outline" size="icon-sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><ChevronRight /></Button>
          <Button variant="ghost" size="sm" onClick={() => setMonth(new Date())}>Today</Button>
        </div>
        <p className="font-semibold">{format(month, "MMMM yyyy")}</p>
        <p className="hidden text-xs text-muted-foreground sm:block">{noDue ? `${noDue} without due date not shown` : "By due date"}</p>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-7 overflow-hidden rounded-lg border">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="border-b bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground">{d}</div>
          ))}
          {days.map((d) => {
            const dayTasks = items.filter((t) => t.dueDate && isSameDay(day(t.dueDate), d));
            return (
              <div key={d.toISOString()} className={cn("min-h-28 border-b border-l p-1.5 [&:nth-child(7n+1)]:border-l-0", !isSameMonth(d, month) && "bg-muted/30")}>
                <span className={cn("mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs", isToday(d) ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground")}>
                  {format(d, "d")}
                </span>
                <div className="space-y-1">
                  {dayTasks.slice(0, 4).map((t) => (
                    <Link
                      key={t.id}
                      href={`/tasks/${t.id}`}
                      className="block truncate rounded border-l-2 bg-card px-1.5 py-0.5 text-[11px] shadow-xs hover:bg-accent"
                      style={{ borderLeftColor: TASK_STATUS_COLORS[t.status] }}
                      title={`${t.taskNumber} · ${t.title} (${humanize(t.status)})`}
                    >
                      {t.title}
                    </Link>
                  ))}
                  {dayTasks.length > 4 ? <p className="px-1 text-[11px] text-muted-foreground">+{dayTasks.length - 4} more</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function TasksView({
  scope,
  projectId,
  embedded = false,
  canCreateInProject,
}: {
  scope: "mine" | "all";
  /** Lock the explorer to one project (project detail page). */
  projectId?: string;
  embedded?: boolean;
  canCreateInProject?: boolean;
}) {
  const canManage = useCan("task:manage");
  const [view, setView] = useState<View>("list");
  const [q, setQ] = useState("");
  const [project, setProject] = useState(projectId ?? "");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState("");
  const [sort, setSort] = useState("dueDate");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [month, setMonth] = useState(() => new Date());
  const [createOpen, setCreateOpen] = useState(false);
  const search = useDebounce(q, 300);

  const statusParam = status === "open" ? TASK_STATUSES.filter((s) => s !== "COMPLETED" && s !== "CANCELLED").join(",") : status;
  const params = {
    scope,
    q: search,
    project,
    department,
    status: statusParam,
    priority,
    due: view === "calendar" ? "" : due,
    sort,
    ...(view === "list"
      ? { page, pageSize }
      : view === "board"
        ? { page: 1, pageSize: 300 }
        : {
            page: 1,
            pageSize: 300,
            from: format(startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), "yyyy-MM-dd"),
            to: format(endOfWeek(endOfMonth(month), { weekStartsOn: 1 }), "yyyy-MM-dd"),
          }),
  };
  const { data, error, isLoading, mutate } = useSWR<Paginated<TaskListItemDTO>>(`/api/tasks${qs(params)}`, fetcher, { keepPreviousData: true });
  const { data: projects } = useProjectOptions(!projectId);
  const { data: departments } = useDepartmentOptions();
  const canCreate = projectId ? !!canCreateInProject : canManage && !!projects?.some((p) => p.taskDepartments.length);

  const filtersActive = !!(q || (!projectId && project) || department || status || priority || due);
  const reset = () => {
    setQ(""); if (!projectId) setProject(""); setDepartment(""); setStatus(""); setPriority(""); setDue(""); setPage(1);
  };
  const set = (fn: (v: string) => void) => (v: string) => { fn(v === ALL ? "" : v); setPage(1); };
  const items = useMemo(() => data?.items ?? [], [data]);

  return (
    <div className="space-y-5">
      {!embedded ? (
        <PageHeader
          title={scope === "mine" ? "My Tasks" : "All Tasks"}
          description={scope === "mine" ? "Tasks you own or collaborate on." : "Tasks across the projects and departments you manage."}
          actions={canCreate ? <Button onClick={() => setCreateOpen(true)}><Plus /> New task</Button> : null}
        />
      ) : null}

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex flex-col gap-2 border-b p-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search title or task number…" className="pl-8" aria-label="Search tasks" />
            </div>
            <div className="flex items-center gap-2">
              <Tabs value={view} onValueChange={(v) => setView(v as View)}>
                <TabsList>
                  <TabsTrigger value="list" aria-label="List view"><List /> <span className="hidden sm:inline">List</span></TabsTrigger>
                  <TabsTrigger value="board" aria-label="Kanban board"><Columns3 /> <span className="hidden sm:inline">Board</span></TabsTrigger>
                  <TabsTrigger value="calendar" aria-label="Calendar view"><CalendarDays /> <span className="hidden sm:inline">Calendar</span></TabsTrigger>
                </TabsList>
              </Tabs>
              {embedded && canCreate ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus /> New task</Button> : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {!projectId ? (
              <Select value={project || ALL} onValueChange={set(setProject)}>
                <SelectTrigger className="w-full sm:w-48" aria-label="Project"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All projects</SelectItem>
                  {projects?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : null}
            <Select value={department || ALL} onValueChange={set(setDepartment)}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Department"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {departments?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status || ALL} onValueChange={set(setStatus)}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All status</SelectItem>
                <SelectItem value="open">Open (not closed)</SelectItem>
                {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priority || ALL} onValueChange={set(setPriority)}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All priorities</SelectItem>
                {TASK_PRIORITIES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            {view !== "calendar" ? (
              <Select value={due || ALL} onValueChange={set(setDue)}>
                <SelectTrigger className="w-full sm:w-36" aria-label="Due date"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any due date</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="today">Due today</SelectItem>
                  <SelectItem value="week">Next 7 days</SelectItem>
                  <SelectItem value="none">No due date</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {view === "list" ? (
              <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
                <SelectTrigger className="w-full sm:w-40" aria-label="Sort"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dueDate">Due soonest</SelectItem>
                  <SelectItem value="priority">Highest priority</SelectItem>
                  <SelectItem value="-updatedAt">Recently updated</SelectItem>
                  <SelectItem value="-createdAt">Newest</SelectItem>
                  <SelectItem value="title">Title A–Z</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {filtersActive ? <Button variant="ghost" onClick={reset}><FilterX /> Clear</Button> : null}
          </div>
        </div>

        {error ? (
          <ErrorState message={error.message} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <TableSkeleton rows={6} cols={6} />
        ) : !items.length && view !== "calendar" ? (
          <EmptyState
            icon={ListChecks}
            title={filtersActive ? "No tasks match your filters" : scope === "mine" ? "No tasks assigned to you" : "No tasks yet"}
            description={filtersActive ? "Try adjusting the filters." : scope === "mine" ? "When someone assigns you a task, it shows up here and you'll get a notification." : undefined}
            action={filtersActive ? <Button variant="outline" size="sm" onClick={reset}>Clear filters</Button> : canCreate ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus /> New task</Button> : null}
          />
        ) : view === "list" ? (
          <>
            <div className={isLoading ? "opacity-60" : undefined}>
              <ListView items={items} scope={scope} onChanged={() => mutate()} />
            </div>
            <DataPagination page={data!.page} pageSize={data!.pageSize} total={data!.total} totalPages={data!.totalPages} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} label="tasks" />
          </>
        ) : view === "board" ? (
          <BoardView items={items} onChanged={() => mutate()} hideClosed={status !== "CANCELLED"} />
        ) : (
          <CalendarView items={items} month={month} setMonth={setMonth} />
        )}
      </div>

      <TaskFormDialog open={createOpen} onOpenChange={setCreateOpen} projectId={projectId} onSaved={() => mutate()} />
    </div>
  );
}
