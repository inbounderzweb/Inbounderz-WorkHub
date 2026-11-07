"use client";

import { PriorityLabel } from "@/components/shared/labels";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  AlarmClock,
  BellRing,
  CheckCircle2,
  ClipboardList,
  FilterX,
  Inbox,
  Loader,
  Plus,
  Search,
  ScanSearch,
  Sparkles,
  Ticket,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { DataPagination } from "@/components/shared/data-pagination";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { StatCard, StatCardSkeleton, type StatTone } from "@/components/shared/stat-card";
import { useDebounce } from "@/hooks/use-debounce";
import { useTicketDepartments } from "@/hooks/use-ticket-options";
import { fetcher, qs } from "@/lib/http";
import { OPEN_TICKET_STATUSES, TASK_PRIORITIES, TICKET_STATUSES, TICKET_STATUS_LABELS, type TicketStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Paginated, TicketListItemDTO, TicketSummaryDTO } from "@/types/dto";
import { CreateTicketDialog } from "./create-ticket-dialog";
import { TicketsTable } from "./tickets-table";

const ALL = "__all";
type Scope = "mine" | "manage";

const MANAGE_CARDS: { key: TicketStatus | "OVERDUE"; label: string; icon: typeof Inbox; tone: StatTone }[] = [
  { key: "NEW", label: "New", icon: Sparkles, tone: "blue" },
  { key: "UNDER_REVIEW", label: "Under review", icon: ScanSearch, tone: "violet" },
  { key: "ASSIGNED", label: "Assigned", icon: UserCheck, tone: "slate" },
  { key: "IN_PROGRESS", label: "In progress", icon: Loader, tone: "blue" },
  { key: "RESOLVED", label: "Resolved", icon: CheckCircle2, tone: "green" },
  { key: "OVERDUE", label: "Overdue", icon: AlarmClock, tone: "red" },
];

function FilterSelect({
  value,
  onChange,
  label,
  allLabel,
  className,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  allLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger className={cn("w-full sm:w-44", className)} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
}

export function TicketsView({ scope }: { scope: Scope }) {
  const router = useRouter();
  const manage = scope === "manage";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(manage ? "" : "open");
  const [department, setDepartment] = useState("");
  const [requester, setRequester] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState("");
  const [sort, setSort] = useState(manage ? "-createdAt" : "-updatedAt");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const search = useDebounce(q, 300);

  // "Waiting for me" (requester): work to review, or a question to answer.
  const statusParam = status === "open" ? OPEN_TICKET_STATUSES.join(",") : status === "attention" ? "RESOLVED,WAITING_FOR_INFO" : status;
  const params = { scope, q: search, status: statusParam, department, requester, assignee, priority, due, sort, page, pageSize };
  const { data, error, isLoading, mutate } = useSWR<Paginated<TicketListItemDTO>>(`/api/tickets${qs(params)}`, fetcher, { keepPreviousData: true });
  const { data: summary, mutate: mutateSummary } = useSWR<TicketSummaryDTO>(`/api/tickets/summary${qs({ scope })}`, fetcher);
  const { data: departments } = useTicketDepartments();

  const items = useMemo(() => data?.items ?? [], [data]);
  const filtersActive = !!(q || (manage ? status : status !== "open") || department || requester || assignee || priority || due);
  const reset = () => {
    setQ(""); setStatus(manage ? "" : "open"); setDepartment(""); setRequester(""); setAssignee(""); setPriority(""); setDue(""); setPage(1);
  };
  const set = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };

  function cardFilter(key: TicketStatus | "OVERDUE") {
    if (key === "OVERDUE") {
      setStatus(""); setDue(due === "overdue" ? "" : "overdue");
    } else {
      setDue(""); setStatus(status === key ? "" : key);
    }
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={manage ? "Ticket Management" : "My Tickets"}
        description={manage ? "Review internal requests, assign them to the right department member and track delivery." : "Requests you've raised with other departments."}
        actions={<Button onClick={() => setCreateOpen(true)}><Plus /> Raise ticket</Button>}
      />

      {manage ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {MANAGE_CARDS.map((c) => {
            const value = !summary ? null : c.key === "OVERDUE" ? summary.overdue : summary.counts[c.key];
            const active = c.key === "OVERDUE" ? due === "overdue" : status === c.key;
            return value === null ? (
              <StatCardSkeleton key={c.key} />
            ) : (
              <button
                key={c.key}
                type="button"
                onClick={() => cardFilter(c.key)}
                className={cn("rounded-xl text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", active && "ring-2 ring-primary/60")}
                aria-pressed={active}
              >
                <StatCard label={c.label} value={value} icon={c.icon} tone={c.tone} />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {summary ? (
            <>
              <button type="button" className="rounded-xl text-left" onClick={() => { setStatus("open"); setPage(1); }}>
                <StatCard label="Open tickets" value={summary.open} icon={Ticket} tone="blue" hint="Not closed or rejected" />
              </button>
              <button type="button" className="rounded-xl text-left" onClick={() => { setStatus("attention"); setPage(1); }}>
                <StatCard label="Waiting for you" value={summary.awaitingMe} icon={BellRing} tone="amber" hint="Info requests and work to review" />
              </button>
              <button type="button" className="rounded-xl text-left" onClick={() => { setStatus("CLOSED"); setPage(1); }}>
                <StatCard label="Closed" value={summary.counts.CLOSED} icon={CheckCircle2} tone="green" hint="Completed and confirmed" />
              </button>
            </>
          ) : (
            [0, 1, 2].map((i) => <StatCardSkeleton key={i} />)
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex flex-col gap-2 border-b p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search title, ticket number or category…" className="pl-8" aria-label="Search tickets" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <FilterSelect value={status} onChange={set(setStatus)} label="Status" allLabel="All statuses">
              <SelectItem value="open">Open</SelectItem>
              {!manage ? <SelectItem value="attention">Waiting for me</SelectItem> : null}
              {TICKET_STATUSES.map((s) => <SelectItem key={s} value={s}>{TICKET_STATUS_LABELS[s]}</SelectItem>)}
            </FilterSelect>
            <FilterSelect value={department} onChange={set(setDepartment)} label="Department" allLabel="All departments">
              {departments?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </FilterSelect>
            {manage ? (
              <>
                <FilterSelect value={requester} onChange={set(setRequester)} label="Requester" allLabel="All requesters">
                  {summary?.requesters.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </FilterSelect>
                <FilterSelect value={assignee} onChange={set(setAssignee)} label="Assigned employee" allLabel="Any assignee">
                  <SelectItem value="none">Unassigned</SelectItem>
                  {summary?.assignees.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </FilterSelect>
                <FilterSelect value={priority} onChange={set(setPriority)} label="Priority" allLabel="All priorities" className="sm:w-36">
                  {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}><PriorityLabel value={p} /></SelectItem>)}
                </FilterSelect>
              </>
            ) : null}
            <FilterSelect value={due} onChange={set(setDue)} label="Due date" allLabel="Any due date" className="sm:w-36">
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="today">Due today</SelectItem>
              <SelectItem value="week">Next 7 days</SelectItem>
            </FilterSelect>
            <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Sort"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="-createdAt">Newest first</SelectItem>
                <SelectItem value="createdAt">Oldest first</SelectItem>
                <SelectItem value="dueDate">Due soonest</SelectItem>
                <SelectItem value="priority">Highest priority</SelectItem>
                <SelectItem value="-updatedAt">Recently updated</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive ? <Button variant="ghost" onClick={reset}><FilterX /> Clear</Button> : null}
          </div>
        </div>

        {error ? (
          <ErrorState message={error.message} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <TableSkeleton rows={6} cols={7} />
        ) : !items.length ? (
          <EmptyState
            icon={manage ? ClipboardList : Ticket}
            title={filtersActive ? "No tickets match your filters" : manage ? "No tickets in your queue" : "You haven't raised any tickets"}
            description={
              filtersActive
                ? "Try adjusting the filters."
                : manage
                  ? "New requests from employees appear here for review and assignment."
                  : "Need something from another department — a banner, copy, a fix? Raise a ticket and track it here."
            }
            action={
              filtersActive ? <Button variant="outline" size="sm" onClick={reset}>Clear filters</Button> : <Button size="sm" onClick={() => setCreateOpen(true)}><Plus /> Raise ticket</Button>
            }
          />
        ) : (
          <>
            <div className={isLoading ? "opacity-60" : undefined}>
              <TicketsTable items={items} variant={scope} />
            </div>
            <DataPagination
              page={data!.page}
              pageSize={data!.pageSize}
              total={data!.total}
              totalPages={data!.totalPages}
              onPageChange={setPage}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              label="tickets"
            />
          </>
        )}
      </div>

      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(t) => {
          mutate();
          mutateSummary();
          router.push(`/tickets/${t.id}`);
        }}
      />
    </div>
  );
}
