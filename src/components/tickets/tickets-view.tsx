"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { ArrowRight, ChevronDown, ChevronUp, ChevronsUp, GripVertical, ClipboardList, FilterX, History, Hourglass, Inbox, MessageCircleQuestion, PlayCircle, Plus, Search, Send, Ticket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataPagination } from "@/components/shared/data-pagination";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { StatCard, StatCardSkeleton, type StatTone } from "@/components/shared/stat-card";
import { TableSkeleton } from "@/components/shared/skeletons";
import { PriorityBadge, TicketStatusBadge, DepartmentChip } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useDepartmentOptions } from "@/hooks/use-options";
import { day } from "@/lib/dates";
import { ApiClientError, api, fetcher, qs } from "@/lib/http";
import { TASK_PRIORITIES, TICKET_CLOSED_STATUSES, TICKET_STATUSES, humanize } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Paginated, TicketDTO, TeamWorkloadDTO, TicketSummaryDTO } from "@/types/dto";
import { TeamWorkload } from "./team-workload";
import { TicketFormDialog } from "./ticket-form-dialog";

const ALL = "__all";
type View = "open" | "closed";
type Scope = "raised" | "assigned" | "employee" | "queue" | "department" | "all";

type Bucket = { label: string; status: string; count: number; icon: typeof Inbox; tone: StatTone };

function buckets(scope: Scope, s: TicketSummaryDTO): Bucket[] {
  if (scope === "raised")
    return [
      { label: "Pending approval", status: "PENDING_APPROVAL", count: s.raised.pending, icon: Hourglass, tone: "amber" },
      { label: "Pending clarification", status: "PENDING_CLARIFICATION", count: s.raised.clarification, icon: MessageCircleQuestion, tone: "red" },
      { label: "In progress", status: "IN_PROGRESS", count: s.raised.inProgress, icon: PlayCircle, tone: "blue" },
      { label: "Needs your review", status: "SUBMITTED_FOR_REVIEW", count: s.raised.review, icon: Send, tone: "violet" },
    ];
  if (scope === "assigned")
    return [
      { label: "Pending (not started)", status: "ASSIGNED", count: s.assigned.pending, icon: ClipboardList, tone: "amber" },
      { label: "In progress", status: "IN_PROGRESS", count: s.assigned.inProgress, icon: PlayCircle, tone: "blue" },
      { label: "On hold", status: "ON_HOLD", count: s.assigned.onHold, icon: Hourglass, tone: "slate" },
      { label: "Submitted for review", status: "SUBMITTED_FOR_REVIEW", count: s.assigned.review, icon: Send, tone: "violet" },
    ];
  if (scope === "queue" && s.queue)
    return [
      { label: "Pending approval", status: "PENDING_APPROVAL", count: s.queue.pendingApproval, icon: Hourglass, tone: "amber" },
      { label: "Under review", status: "UNDER_REVIEW", count: s.queue.underReview, icon: ClipboardList, tone: "violet" },
      { label: "Waiting on requester", status: "PENDING_CLARIFICATION", count: s.queue.clarification, icon: MessageCircleQuestion, tone: "red" },
      { label: "Unassigned", status: "UNASSIGNED", count: s.queue.unassigned, icon: Inbox, tone: "red" },
    ];
  return [];
}

function Due({ t }: { t: TicketDTO }) {
  const d = t.expectedCompletion ?? t.dueDate;
  if (!d) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("tabular whitespace-nowrap", t.isOverdue ? "font-medium text-red-600" : "text-muted-foreground")}>
      {t.isOverdue ? "Overdue · " : ""}
      {format(day(d), "d MMM")}
    </span>
  );
}

/**
 * `assignedOnly` + `fixedView` are used by My Tasks, which shows the viewer's assigned work as two
 * separate lists (active / completed). The Tickets page is about requests, so it has no "assigned to me" tab.
 */
export function TicketsView({ initialScope = "raised", embedded = false, assignedOnly = false, fixedView }: { initialScope?: Scope; embedded?: boolean; assignedOnly?: boolean; fixedView?: View }) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>(assignedOnly ? "assigned" : initialScope);
  const [q, setQ] = useState("");
  const [view, setViewState] = useState<View>(fixedView ?? "open");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [department, setDepartment] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [sort, setSort] = useState(fixedView === "closed" ? "-updatedAt" : assignedOnly || initialScope === "assigned" ? "manager" : "-createdAt");
  const [employee, setEmployee] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: summary, mutate: mutateSummary } = useSWR<TicketSummaryDTO>("/api/tickets/summary", fetcher, { refreshInterval: embedded ? 30_000 : 0 });
  const { data: departments } = useDepartmentOptions();
  const { data: queues } = useSWR<TeamWorkloadDTO[]>(scope === "employee" ? "/api/tickets/queues" : null, fetcher, { refreshInterval: 30_000 });
  const employeeId = scope === "employee" ? (queues?.some((x) => x.id === employee) ? employee : ((queues?.find((x) => x.ticketItems > 0) ?? queues?.[0])?.id ?? "")) : "";
  const params = { scope, assignee: employeeId, view, q, status, priority, department, overdue: overdue ? "1" : "", sort, page, pageSize };
  const waitingForEmployee = scope === "employee" && !employeeId;
  const { data, error, isLoading, mutate } = useSWR<Paginated<TicketDTO>>(waitingForEmployee ? null : `/api/tickets${qs(params)}`, fetcher, {
    keepPreviousData: true,
    // The assignee must see a manager's re-ordering without refreshing; managers see each other's changes too.
    refreshInterval: embedded || scope === "assigned" || scope === "employee" ? 30_000 : 0,
  });

  const tabs = useMemo(() => {
    const t: { value: Scope; label: string; count?: number }[] = [
      { value: "raised", label: "Raised by me" },
    ];
    if (summary?.queue) {
      t.push({ value: "queue", label: "Approval queue", count: summary.queue.pendingApproval + summary.queue.underReview + summary.queue.unassigned });
      t.push({ value: "employee", label: "Employee queues" });
    }
    if (summary?.department) t.push({ value: "department", label: "Department", count: summary.department.open });
    return t;
  }, [summary]);
  const isAdmin = !!summary?.queue && !!summary?.department;
  const closedView = view === "closed";
  const cards = summary && !closedView ? buckets(scope, summary) : [];
  const mineCounts = summary && (scope === "raised" || scope === "assigned") ? summary[scope] : null;
  const activeCount = mineCounts ? mineCounts.total - mineCounts.closed : undefined;
  const filtersActive = !!(q || status || priority || department || overdue);
  const reset = () => { setQ(""); setStatus(""); setPriority(""); setDepartment(""); setOverdue(false); setPage(1); };
  const ordered = (sc: Scope) => sc === "assigned" || sc === "employee";
  const changeScope = (sc: Scope) => { setScope(sc); reset(); setSort(ordered(sc) && view === "open" ? "manager" : sort === "manager" ? "-createdAt" : sort); };
  const setView = (v: View) => { setViewState(v); setStatus(""); setSort(v === "closed" ? "-updatedAt" : ordered(scope) ? "manager" : "-createdAt"); setPage(1); };
  const statusOptions = TICKET_STATUSES.filter((s) => (TICKET_CLOSED_STATUSES as readonly string[]).includes(s) === closedView && (s !== "DRAFT" || scope === "raised"));
  const refresh = () => { void mutate(); void mutateSummary(); };
  const set = (fn: (v: string) => void) => (v: string) => { fn(v === ALL ? "" : v); setPage(1); };
  const items = data?.items ?? [];
  const manual = sort === "manager" && ordered(scope) && !closedView;
  const anyReorder = manual && items.some((t) => t.canReorder);
  const showArrows = scope === "employee" || anyReorder;

  const moveTo = async (id: string, position: number | null) => {
    if (!position || moving) return;
    setMoving(true);
    try {
      await api(`/api/tickets/${id}/reorder`, { method: "POST", body: { position } });
      await mutate();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't change the order");
      await mutate();
    } finally {
      setMoving(false);
      setDragId(null);
      setOverId(null);
    }
  };
  const showPerson = scope === "assigned" ? "createdBy" : "assignee";

  return (
    <div className="space-y-5">
      {!embedded ? <PageHeader
        title="Tickets"
        description="Requests within and across departments. The selected Project Manager reviews the request and assigns the work."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus /> Raise ticket</Button>}
      /> : null}

      {!assignedOnly && summary && summary.assigned.total - summary.assigned.closed > 0 ? (
        <Link href="/my-tasks" className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-xs hover:bg-muted/40">
          <span><span className="font-medium">{summary.assigned.total - summary.assigned.closed} ticket{summary.assigned.total - summary.assigned.closed === 1 ? "" : "s"} assigned to you.</span> <span className="text-muted-foreground">Work on them from My Tasks.</span></span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      ) : null}

      {summary && cards.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {cards.map((c) => (
            <button key={c.status} type="button" onClick={() => { setStatus(status === c.status ? "" : c.status); setPage(1); }} className={cn("rounded-xl text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", status === c.status && "ring-2 ring-primary/60")} aria-pressed={status === c.status}>
              <StatCard label={c.label} value={c.count} icon={c.icon} tone={c.tone} />
            </button>
          ))}
        </div>
      ) : !summary && !closedView ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}</div>
      ) : null}

      {scope === "employee" && queues ? <TeamWorkload rows={queues} selected={employeeId} onSelect={(id) => { setEmployee(id); setPage(1); }} /> : null}

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="space-y-2 border-b p-3">
          {!assignedOnly ? <Tabs value={scope} onValueChange={(v) => changeScope(v as Scope)}>
            <TabsList className="h-auto flex-wrap">
              {tabs.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                  {t.count ? <span className="tabular ml-1.5 rounded-full bg-muted px-1.5 text-[11px]">{t.count}</span> : null}
                </TabsTrigger>
              ))}
              {isAdmin ? <TabsTrigger value="all">All tickets</TabsTrigger> : null}
            </TabsList>
          </Tabs> : null}
          {!fixedView ? <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList aria-label="Ticket list">
              <TabsTrigger value="open">Active{activeCount !== undefined ? <span className="tabular ml-1.5 rounded-full bg-muted px-1.5 text-[11px]">{activeCount}</span> : null}</TabsTrigger>
              <TabsTrigger value="closed"><History className="size-3.5" />Completed &amp; closed{mineCounts ? <span className="tabular ml-1.5 rounded-full bg-muted px-1.5 text-[11px]">{mineCounts.closed}</span> : null}</TabsTrigger>
            </TabsList>
          </Tabs> : null}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search title or ticket number…" className="pl-8" aria-label="Search tickets" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {scope !== "raised" && scope !== "assigned" && scope !== "employee" ? (
                <Select value={department || ALL} onValueChange={set(setDepartment)}>
                  <SelectTrigger className="w-full sm:w-44" aria-label="Department"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All departments</SelectItem>
                    {departments?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : null}
              <Select value={status || ALL} onValueChange={set(setStatus)}>
                <SelectTrigger className="w-full sm:w-48" aria-label="Status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All status</SelectItem>
                  {statusOptions.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={priority || ALL} onValueChange={set(setPriority)}>
                <SelectTrigger className="w-full sm:w-36" aria-label="Priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All priorities</SelectItem>
                  {TASK_PRIORITIES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
                </SelectContent>
              </Select>
              {!closedView ? <Button variant={overdue ? "default" : "outline"} onClick={() => { setOverdue(!overdue); setPage(1); }} aria-pressed={overdue}>Overdue</Button> : null}
              <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
                <SelectTrigger className="w-full sm:w-40" aria-label="Sort"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ordered(scope) && !closedView ? <SelectItem value="manager">Manager priority</SelectItem> : null}
                  <SelectItem value="priority">Priority level</SelectItem>
                  <SelectItem value="-createdAt">Newest</SelectItem>
                  <SelectItem value="createdAt">Oldest</SelectItem>
                  <SelectItem value="dueDate">Due date</SelectItem>
                  <SelectItem value="-updatedAt">Recently updated</SelectItem>
                </SelectContent>
              </Select>
              {filtersActive ? <Button variant="ghost" onClick={reset}><FilterX /> Clear</Button> : null}
            </div>
          </div>
        </div>

        {error ? (
          <ErrorState message={error.message} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <TableSkeleton rows={6} cols={6} />
        ) : !items.length ? (
          <EmptyState
            icon={Ticket}
            title={filtersActive ? "No tickets match your filters" : closedView ? "No completed tickets yet" : scope === "employee" ? "No open tickets in this queue" : scope === "queue" ? "Nothing waiting for approval" : scope === "assigned" ? "No tickets assigned to you" : "No tickets yet"}
            description={
              filtersActive ? "Try adjusting the filters."
              : closedView ? "Completed, rejected and cancelled tickets are kept here for reference."
              : scope === "queue" ? "New requests to your department will appear here for review."
              : scope === "assigned" ? "A ticket reaches you only after the Project Manager approves and assigns it."
              : "Need help from your own department or another department? Raise a ticket and their Project Manager will take it from there."
            }
            action={filtersActive ? <Button variant="outline" size="sm" onClick={reset}>Clear filters</Button> : scope === "raised" ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus /> Raise ticket</Button> : null}
          />
        ) : (
          <>
            {manual ? (
              <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                {anyReorder
                  ? `Drag the handle or use the arrows to set the order${scope === "employee" ? " in this employee's queue" : ""}. Position and priority are independent, and the assignee sees this order.`
                  : "Ordered by your Project Manager. Work from the top."}
              </p>
            ) : null}
            <div className={cn(isLoading || moving ? "opacity-60" : undefined)}>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {manual ? <TableHead className="w-[1%] pl-3 whitespace-nowrap">#</TableHead> : null}
                    <TableHead className={manual ? undefined : "pl-4"}>Ticket</TableHead>
                    <TableHead className="hidden lg:table-cell">Departments</TableHead>
                    <TableHead className="hidden md:table-cell">{showPerson === "createdBy" ? "Raised by" : "Assignee"}</TableHead>
                    <TableHead className="hidden sm:table-cell">Priority</TableHead>
                    <TableHead>{closedView ? "Closed" : "Due"}</TableHead>
                    <TableHead className={showArrows && manual ? undefined : "pr-4"}>Status</TableHead>
                    {manual && showArrows ? <TableHead className="w-[1%] pr-3 text-right"><span className="sr-only">Move</span></TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((t) => {
                    const person = showPerson === "createdBy" ? t.createdBy : t.assignee;
                    return (
                      <TableRow
                        key={t.id}
                        className={cn("cursor-pointer", manual && t.queuePosition === 1 && "bg-primary/[0.04]", dragId === t.id && "opacity-40", overId === t.id && dragId !== t.id && "bg-primary/10 shadow-[inset_0_2px_0_0_var(--color-primary)]")}
                        onClick={() => router.push(`/tickets/${t.id}`)}
                        draggable={manual && t.canReorder && !moving}
                        onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); }}
                        onDragOver={(e) => { if (dragId && manual && t.canReorder) { e.preventDefault(); if (overId !== t.id) setOverId(t.id); } }}
                        onDrop={(e) => { e.preventDefault(); if (dragId && dragId !== t.id) void moveTo(dragId, t.queuePosition); else { setDragId(null); setOverId(null); } }}
                        onDragEnd={() => { setDragId(null); setOverId(null); }}
                      >
                        {manual ? (
                          <TableCell className="pl-3">
                            <span className="flex items-center gap-1">
                              {t.canReorder ? <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing" aria-hidden /> : null}
                              <span className={cn("tabular grid size-6 place-items-center rounded-full text-xs font-semibold", t.queuePosition === 1 ? "bg-primary text-primary-foreground" : t.queuePosition && t.queuePosition <= 3 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")} title={t.queuePosition === 1 ? "Next up" : `Position ${t.queuePosition}`}>{t.queuePosition ?? "–"}</span>
                            </span>
                          </TableCell>
                        ) : null}
                        <TableCell className={cn("max-w-[360px]", !manual && "pl-4")}>
                          <Link href={`/tickets/${t.id}`} onClick={(e) => e.stopPropagation()} className="block min-w-0">
                            <span className="block truncate font-medium hover:text-primary">{t.title}</span>
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-mono">{t.ticketNumber}</span>
                              <span>{t.category}</span>
                              {t.deliverableSummary ? (
                                <span className="tabular-nums" title={`${t.deliverableSummary.completed} of ${t.deliverableSummary.requested} items done, ${t.deliverableSummary.verified} verified`}>
                                  {t.deliverableSummary.verified}/{t.deliverableSummary.requested} verified
                                </span>
                              ) : null}
                              {manual && t.queuePosition === 1 ? <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">Next up</span> : null}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <span className="flex items-center gap-1.5 text-sm">
                            {t.requestingDepartment ? <DepartmentChip name={t.requestingDepartment.name} color={t.requestingDepartment.color} /> : <span className="text-muted-foreground">—</span>}
                            <ArrowRight className="size-3.5 text-muted-foreground" />
                            {t.targetDepartment ? <DepartmentChip name={t.targetDepartment.name} color={t.targetDepartment.color} /> : null}
                            {t.additionalDepartments.map((d) => <span key={d.id} className="flex items-center gap-1.5"><span className="text-muted-foreground">+</span><DepartmentChip name={d.name} color={d.color} /></span>)}
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {person ? <span className="flex items-center gap-2"><UserAvatar name={person.name} size="sm" /><span className="max-w-32 truncate text-sm">{person.name}</span></span> : <span className="text-muted-foreground">{showPerson === "assignee" ? "Unassigned" : "—"}</span>}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell"><PriorityBadge priority={t.priority} /></TableCell>
                        <TableCell className="text-sm">{closedView ? <span className="tabular whitespace-nowrap text-muted-foreground">{format(new Date(t.updatedAt), "d MMM yyyy")}</span> : <Due t={t} />}</TableCell>
                        <TableCell className={showArrows && manual ? undefined : "pr-4"}><TicketStatusBadge status={t.status} /></TableCell>
                        {manual && showArrows ? (
                          <TableCell className="pr-3" onClick={(e) => e.stopPropagation()}>
                            {t.canReorder && t.queuePosition ? (
                              <span className="flex justify-end gap-0.5">
                                <Button variant="ghost" size="icon" className="size-7" disabled={moving || t.queuePosition <= 1} onClick={() => void moveTo(t.id, 1)} aria-label="Move to top" title="Move to top"><ChevronsUp /></Button>
                                <Button variant="ghost" size="icon" className="size-7" disabled={moving || t.queuePosition <= 1} onClick={() => void moveTo(t.id, t.queuePosition! - 1)} aria-label="Move up" title="Move up"><ChevronUp /></Button>
                                <Button variant="ghost" size="icon" className="size-7" disabled={moving || t.queuePosition >= t.queueSize} onClick={() => void moveTo(t.id, t.queuePosition! + 1)} aria-label="Move down" title="Move down"><ChevronDown /></Button>
                              </span>
                            ) : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <DataPagination page={data!.page} pageSize={data!.pageSize} total={data!.total} totalPages={data!.totalPages} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} label="tickets" />
          </>
        )}
      </div>

      {!assignedOnly ? <TicketFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={(t) => { refresh(); router.push(`/tickets/${t.id}`); }} /> : null}
    </div>
  );
}
