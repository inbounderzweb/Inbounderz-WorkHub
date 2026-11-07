"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { addDays, format } from "date-fns";
import { AlertOctagon, ChevronLeft, ChevronRight, ClipboardList, Clock, Download, FilterX, Paperclip, Plus, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { DataPagination } from "@/components/shared/data-pagination";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { StatCard } from "@/components/shared/stat-card";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useSettings } from "@/components/providers/user-provider";
import { useDebounce } from "@/hooks/use-debounce";
import { fetcher, qs } from "@/lib/http";
import { formatDay } from "@/lib/dates";
import { todayIn } from "@/lib/settings-types";
import { cn } from "@/lib/utils";
import type { DailySummaryDTO, DailyUpdateDTO, Paginated } from "@/types/dto";
import { DailyStatusBadge, DailyUpdateDetailSheet } from "./daily-update-detail";
import { DailyUpdateFormDialog } from "./daily-update-form";

const ALL = "__all";
type Tab = "mine" | "team" | "summary";
type ListResp = Paginated<DailyUpdateDTO> & { canSeeTeam: boolean };

function ReportsTable({ items, team, onOpen }: { items: DailyUpdateDTO[]; team: boolean; onOpen: (id: string) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className="pl-4">Date</TableHead>
          {team ? <TableHead>Employee</TableHead> : null}
          <TableHead>Work</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Hours</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden pr-4 lg:table-cell">Reviewed by</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((r) => (
          <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
            <TableCell className="tabular pl-4 text-sm whitespace-nowrap">{formatDay(r.date, "EEE d MMM")}</TableCell>
            {team ? (
              <TableCell>
                <span className="flex items-center gap-2"><UserAvatar name={r.user?.name ?? "?"} size="sm" /><span className="max-w-32 truncate text-sm">{r.user?.name}</span></span>
              </TableCell>
            ) : null}
            <TableCell className="max-w-[180px] sm:max-w-[420px]">
              <button type="button" className="block w-full min-w-0 text-left" onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}>
                <span className="block truncate text-sm font-medium">{r.workCompleted}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{r.project?.code} · {r.project?.name}</span>
                  {r.task ? <span className="font-mono">{r.task.taskNumber}</span> : null}
                  {r.blockers ? <span className="inline-flex items-center gap-0.5 font-medium text-red-600"><AlertOctagon className="size-3" /> Blocker</span> : null}
                  {r.attachmentCount ? <span className="inline-flex items-center gap-0.5"><Paperclip className="size-3" />{r.attachmentCount}</span> : null}
                </span>
              </button>
            </TableCell>
            <TableCell className="tabular hidden text-right text-sm sm:table-cell">{r.hoursSpent}</TableCell>
            <TableCell><DailyStatusBadge status={r.status} /></TableCell>
            <TableCell className="hidden pr-4 text-sm text-muted-foreground lg:table-cell">{r.reviewedBy?.name ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SummaryPanel({ scope, today }: { scope: "mine" | "team"; today: string }) {
  const [view, setView] = useState<"day" | "week">("week");
  const [date, setDate] = useState(today);
  const { data, error, isLoading, mutate } = useSWR<DailySummaryDTO>(`/api/daily-updates/summary${qs({ view, date, scope })}`, fetcher, { keepPreviousData: true });
  const shift = (n: number) => setDate(format(addDays(new Date(`${date}T00:00:00`), n * (view === "week" ? 7 : 1)), "yyyy-MM-dd"));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v as "day" | "week")}>
          <TabsList><TabsTrigger value="day">Daily</TabsTrigger><TabsTrigger value="week">Weekly</TabsTrigger></TabsList>
        </Tabs>
        <Button variant="outline" size="icon-sm" onClick={() => shift(-1)} aria-label="Previous period"><ChevronLeft /></Button>
        <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40" aria-label="Date" />
        <Button variant="outline" size="icon-sm" onClick={() => shift(1)} disabled={date >= today} aria-label="Next period"><ChevronRight /></Button>
        <Button variant="ghost" size="sm" onClick={() => setDate(today)}>Today</Button>
        {data ? <span className="text-sm text-muted-foreground">{data.from === data.to ? formatDay(data.from, "EEEE d MMM yyyy") : `${formatDay(data.from, "d MMM")} – ${formatDay(data.to, "d MMM yyyy")}`}</span> : null}
      </div>
      {error ? (
        <ErrorState message={error.message} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <TableSkeleton rows={5} cols={5} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Reports" value={data.totals.reports} icon={ClipboardList} />
            <StatCard label="Hours logged" value={data.totals.hours} icon={Clock} tone="blue" />
            <StatCard label={scope === "team" ? "Employees reporting" : "Awaiting review"} value={scope === "team" ? data.totals.employees : data.totals.pending} icon={Users} tone="violet" />
            <StatCard label="Reports with blockers" value={data.totals.blockers} icon={AlertOctagon} tone="red" />
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
            {data.rows.length ? (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-4">Employee</TableHead>
                    {view === "week" ? data.days.map((d) => <TableHead key={d} className="text-right">{formatDay(d, "EEE d")}</TableHead>) : null}
                    <TableHead className="hidden text-right sm:table-cell">Hours</TableHead>
                    <TableHead className="text-right">Reports</TableHead>
                    <TableHead className="pr-4">Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.user.id}>
                      <TableCell className="pl-4">
                        <span className="flex items-center gap-2"><UserAvatar name={r.user.name} size="sm" /><span><span className="block text-sm font-medium">{r.user.name}</span><span className="block text-xs text-muted-foreground">{r.department ?? ""}</span></span></span>
                      </TableCell>
                      {view === "week" ? data.days.map((d) => <TableCell key={d} className={cn("tabular text-right text-sm", !r.hoursByDay[d] && "text-muted-foreground/50")}>{r.hoursByDay[d] || "–"}</TableCell>) : null}
                      <TableCell className="tabular text-right font-medium">{r.hours}</TableCell>
                      <TableCell className="tabular text-right">{r.reports}</TableCell>
                      <TableCell className="pr-4 text-xs whitespace-nowrap">
                        <span className="text-emerald-700">{r.approved} approved</span>
                        {r.pending ? <span className="text-violet-700"> · {r.pending} pending</span> : null}
                        {r.changesRequested ? <span className="text-orange-700"> · {r.changesRequested} changes</span> : null}
                        {r.blockers ? <span className="text-red-600"> · {r.blockers} blocker{r.blockers === 1 ? "" : "s"}</span> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState icon={ClipboardList} title="No reports in this period" className="py-10" />
            )}
          </div>
          {scope === "team" && data.missing.length ? (
            <div className="rounded-xl border bg-card p-4 shadow-xs">
              <p className="text-sm font-medium">No report {view === "week" ? "this week" : "on this day"} ({data.missing.length})</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.missing.map((u) => (
                  <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/30 py-0.5 pr-2.5 pl-0.5 text-xs"><UserAvatar name={u.name} size="sm" />{u.name}</span>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function DailyUpdatesView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const settings = useSettings();
  const today = todayIn(settings?.company.timezone ?? "UTC");
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "mine");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DailyUpdateDTO | null>(null);
  const search = useDebounce(q, 300);
  const { mutate: globalMutate } = useSWRConfig();
  const openId = params.get("report");
  const scope = tab === "team" ? "team" : "mine";

  const listKey = tab === "summary" ? null : `/api/daily-updates${qs({ scope, status, from, to, q: search, page, pageSize: 20 })}`;
  const { data, error, isLoading, mutate } = useSWR<ListResp>(listKey, fetcher, { keepPreviousData: true });
  // Ask once whether the user has a team view (reviewer / overseer).
  const { data: probe } = useSWR<ListResp>("/api/daily-updates?scope=mine&pageSize=1", fetcher);
  const canSeeTeam = !!(data?.canSeeTeam ?? probe?.canSeeTeam);

  const setOpen = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("report", id);
    else sp.delete("report");
    router.replace(`${pathname}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  };
  const filtersActive = !!(status || from || to || q);
  const reset = () => { setStatus(""); setFrom(""); setTo(""); setQ(""); setPage(1); };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Daily Work Updates"
        description="Report what you worked on each day. Department Heads review reports; Project Managers see reports on their projects."
        actions={
          <>
            <Button variant="outline" asChild><a href="/api/reports/export?dataset=daily-updates" download><Download /> Export CSV</a></Button>
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> Submit report</Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); setPage(1); }}>
        <TabsList>
          <TabsTrigger value="mine">My reports</TabsTrigger>
          {canSeeTeam ? <TabsTrigger value="team">Team reports</TabsTrigger> : null}
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "summary" ? (
        <SummaryPanel scope={canSeeTeam ? "team" : "mine"} today={today} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search work, pending items or blockers…" className="pl-8" aria-label="Search reports" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Select value={status || ALL} onValueChange={(v) => { setStatus(v === ALL ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-full sm:w-44" aria-label="Status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value="SUBMITTED">Awaiting review</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="CHANGES_REQUESTED">Changes requested</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" value={from} max={to || today} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" className="sm:w-40" />
              <Input type="date" value={to} min={from || undefined} max={today} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" className="sm:w-40" />
              {filtersActive ? <Button variant="ghost" onClick={reset}><FilterX /> Clear</Button> : null}
            </div>
          </div>
          {error ? (
            <ErrorState message={error.message} onRetry={() => mutate()} />
          ) : isLoading && !data ? (
            <TableSkeleton rows={6} cols={5} />
          ) : !data?.items.length ? (
            <EmptyState
              icon={ClipboardList}
              title={filtersActive ? "No reports match your filters" : tab === "team" ? "No team reports yet" : "You haven't submitted any reports"}
              description={filtersActive ? "Try adjusting the filters." : tab === "team" ? "Reports from your team appear here for review." : "Submit a short report of what you worked on today."}
              action={filtersActive ? <Button variant="outline" size="sm" onClick={reset}>Clear filters</Button> : tab === "mine" ? <Button size="sm" onClick={() => setFormOpen(true)}><Plus /> Submit report</Button> : null}
            />
          ) : (
            <>
              <div className={isLoading ? "opacity-60" : undefined}><ReportsTable items={data.items} team={tab === "team"} onOpen={setOpen} /></div>
              <DataPagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} onPageChange={setPage} label="reports" />
            </>
          )}
        </div>
      )}

      <DailyUpdateFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        report={editing}
        onSaved={(id) => { mutate(); globalMutate(`/api/daily-updates/${id}`); setOpen(id); }}
        onOpenExisting={(id) => setOpen(id)}
      />
      <DailyUpdateDetailSheet
        id={openId}
        onOpenChange={(o) => !o && setOpen(null)}
        onEdit={(r) => { setEditing(r); setFormOpen(true); }}
        onChanged={() => mutate()}
      />
    </div>
  );
}
