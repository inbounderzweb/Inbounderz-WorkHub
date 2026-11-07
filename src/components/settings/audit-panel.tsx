"use client";

import { Fragment, useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, FilterX, History, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataPagination } from "@/components/shared/data-pagination";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useDebounce } from "@/hooks/use-debounce";
import { fetcher, qs } from "@/lib/http";
import type { ActivityDTO, Paginated } from "@/types/dto";

const ENTITIES: [string, string][] = [
  ["User", "Users & roles"],
  ["Department", "Departments"],
  ["Project", "Projects & teams"],
  ["Task", "Tasks"],
  ["Ticket", "Tickets"],
  ["TicketCategory", "Ticket categories"],
  ["DailyUpdate", "Daily updates"],
  ["Settings", "Settings & permissions"],
  ["Report", "Report exports"],
];

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export function AuditPanel() {
  const [q, setQ] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const search = useDebounce(q, 300);
  const { data, error, isLoading, mutate } = useSWR<Paginated<ActivityDTO>>(
    `/api/audit-logs${qs({ q: search, entityType, from, to, page, pageSize: 25 })}`,
    fetcher,
    { keepPreviousData: true }
  );
  const filtered = !!(q || entityType || from || to);

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex flex-col gap-2 border-b p-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search actions or summaries…" className="pl-8" aria-label="Search audit log" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={entityType || "__all"} onValueChange={(v) => { setEntityType(v === "__all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Filter by entity"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All entities</SelectItem>
              {ENTITIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" className="sm:w-40" />
          <Input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" className="sm:w-40" />
          {filtered ? <Button variant="ghost" onClick={() => { setQ(""); setEntityType(""); setFrom(""); setTo(""); setPage(1); }}><FilterX /> Clear</Button> : null}
        </div>
      </div>
      {error ? (
        <ErrorState message={error.message} onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <TableSkeleton rows={8} cols={4} />
      ) : !data?.items.length ? (
        <EmptyState icon={History} title={filtered ? "No entries match your filters" : "No audit entries"} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-8 pl-4" />
                  <TableHead>When</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="hidden md:table-cell">Action</TableHead>
                  <TableHead className="pr-4">Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((a) => {
                  const changes = a.changes ? Object.entries(a.changes) : [];
                  const expanded = open === a.id;
                  return (
                    <Fragment key={a.id}>
                      <TableRow className={changes.length ? "cursor-pointer" : undefined} onClick={() => changes.length && setOpen(expanded ? null : a.id)}>
                        <TableCell className="pl-4">
                          {changes.length ? (
                            <button type="button" aria-expanded={expanded} aria-label={expanded ? "Hide details" : "Show details"} className="text-muted-foreground">
                              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            </button>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap text-muted-foreground" title={a.createdAt}>{format(new Date(a.createdAt), "d MMM yyyy, HH:mm:ss")}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2"><UserAvatar name={a.actor?.name ?? "System"} size="sm" /><span className="max-w-36 truncate text-sm">{a.actor?.name ?? "System"}</span></span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{a.action}</code>
                          <span className="ml-2 text-xs text-muted-foreground">{a.entityType}{a.entityId ? ` · ${a.entityId.slice(-6)}` : ""}</span>
                        </TableCell>
                        <TableCell className="max-w-md truncate pr-4 text-sm">{a.summary}</TableCell>
                      </TableRow>
                      {expanded ? (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell />
                          <TableCell colSpan={4} className="pr-4">
                            <dl className="grid gap-1 py-1 text-xs sm:grid-cols-[180px_1fr]">
                              {changes.map(([field, c]) => (
                                <Fragment key={field}>
                                  <dt className="font-medium">{field}</dt>
                                  <dd className="break-all text-muted-foreground"><span className="line-through">{show(c.from)}</span> → <span className="text-foreground">{show(c.to)}</span></dd>
                                </Fragment>
                              ))}
                            </dl>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <DataPagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} onPageChange={setPage} label="entries" />
        </>
      )}
    </div>
  );
}
