"use client";

import { PriorityLabel } from "@/components/shared/labels";
import { day } from "@/lib/dates";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { format, isPast } from "date-fns";
import { Archive, FilterX, FolderKanban, Plus, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { DataPagination } from "@/components/shared/data-pagination";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { PriorityBadge, ProjectStatusBadge } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useCan } from "@/components/providers/user-provider";
import { useDebounce } from "@/hooks/use-debounce";
import { useDepartmentOptions } from "@/hooks/use-options";
import { fetcher, qs } from "@/lib/http";
import { PROJECT_STATUSES, TASK_PRIORITIES, humanize } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Paginated, ProjectDTO } from "@/types/dto";
import { ProjectFormDialog } from "./project-form-dialog";

const ALL = "__all";

export function ProjectsView() {
  const router = useRouter();
  const canCreate = useCan("project:manage");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [department, setDepartment] = useState("");
  const [archived, setArchived] = useState("");
  const [sort, setSort] = useState("-createdAt");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [createOpen, setCreateOpen] = useState(false);
  const search = useDebounce(q, 300);

  const { data, error, isLoading, mutate } = useSWR<Paginated<ProjectDTO>>(
    `/api/projects${qs({ q: search, status, priority, department, archived, sort, page, pageSize })}`,
    fetcher,
    { keepPreviousData: true }
  );
  const { data: departments } = useDepartmentOptions();
  const filtersActive = !!(q || status || priority || department || archived);
  const set = (fn: (v: string) => void) => (v: string) => {
    fn(v === ALL ? "" : v);
    setPage(1);
  };
  const reset = () => {
    setQ(""); setStatus(""); setPriority(""); setDepartment(""); setArchived(""); setPage(1);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        description="Client and internal projects, their teams and delivery progress."
        actions={canCreate ? <Button onClick={() => setCreateOpen(true)}><Plus /> New project</Button> : null}
      />

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, project ID or client…" className="pl-8" aria-label="Search projects" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Select value={status || ALL} onValueChange={set(setStatus)}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All status</SelectItem>
                {PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priority || ALL} onValueChange={set(setPriority)}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All priorities</SelectItem>
                {TASK_PRIORITIES.map((s) => <SelectItem key={s} value={s}><PriorityLabel value={s} /></SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={department || ALL} onValueChange={set(setDepartment)}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Department"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {departments?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={archived || ALL} onValueChange={set(setArchived)}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Archived"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Not archived</SelectItem>
                <SelectItem value="include">Include archived</SelectItem>
                <SelectItem value="only">Archived only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Sort"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="-createdAt">Newest first</SelectItem>
                <SelectItem value="endDate">Deadline soonest</SelectItem>
                <SelectItem value="name">Name A–Z</SelectItem>
                <SelectItem value="-progress">Most progress</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive ? <Button variant="ghost" onClick={reset}><FilterX /> Clear</Button> : null}
          </div>
        </div>

        {error ? (
          <ErrorState message={error.message} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <TableSkeleton rows={6} cols={6} />
        ) : !data?.items.length ? (
          <EmptyState
            icon={FolderKanban}
            title={filtersActive ? "No projects match your filters" : "No projects yet"}
            description={filtersActive ? "Try adjusting the filters." : canCreate ? "Create a project, choose departments and allocate your team." : "Projects you are allocated to will appear here."}
            action={filtersActive ? <Button variant="outline" size="sm" onClick={reset}>Clear filters</Button> : canCreate ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus /> New project</Button> : null}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Project</TableHead>
                  <TableHead className="hidden lg:table-cell">Manager</TableHead>
                  <TableHead className="hidden xl:table-cell">Departments</TableHead>
                  <TableHead className="hidden md:table-cell">Progress</TableHead>
                  <TableHead className="hidden sm:table-cell">Deadline</TableHead>
                  <TableHead className="pr-4">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={isLoading ? "opacity-60" : undefined}>
                {data.items.map((p) => {
                  const late = p.endDate && isPast(new Date(p.endDate)) && !["COMPLETED", "CANCELLED"].includes(p.status);
                  return (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                      <TableCell className="pl-4">
                        <Link href={`/projects/${p.id}`} className="block min-w-0" onClick={(e) => e.stopPropagation()}>
                          <span className="flex items-center gap-2">
                            <span className="max-w-[260px] truncate font-medium hover:text-primary">{p.name}</span>
                            {p.isArchived ? <Archive className="size-3.5 text-muted-foreground" aria-label="Archived" /> : null}
                          </span>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{p.code}</span>
                            {p.client ? <span className="truncate">· {p.client}</span> : null}
                            <span className="flex items-center gap-0.5">· <Users className="size-3" /> {p.memberCount}</span>
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {p.manager ? (
                          <span className="flex items-center gap-2">
                            <UserAvatar name={p.manager.name} size="sm" />
                            <span className="max-w-32 truncate text-sm">{p.manager.name}</span>
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <div className="flex max-w-56 flex-wrap gap-1">
                          {p.departments.map((d) => (
                            <span key={d.id} className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px]">
                              <span className="size-1.5 rounded-full" style={{ backgroundColor: d.color }} />{d.code}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex w-40 items-center gap-2">
                          <Progress value={p.progress.percent} className="h-1.5" />
                          <span className="tabular w-9 text-right text-xs text-muted-foreground">{p.progress.percent}%</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {p.progress.completed}/{p.progress.total - p.progress.cancelled} done
                          {p.progress.overdue ? <span className="text-red-600"> · {p.progress.overdue} overdue</span> : null}
                        </p>
                      </TableCell>
                      <TableCell className={cn("hidden text-sm sm:table-cell", late ? "font-medium text-red-600" : "text-muted-foreground")}>
                        {p.endDate ? format(day(p.endDate), "d MMM yyyy") : "—"}
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="flex flex-col items-start gap-1">
                          <ProjectStatusBadge status={p.status} />
                          <PriorityBadge priority={p.priority} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataPagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} label="projects" />
          </>
        )}
      </div>

      <ProjectFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={(p) => { mutate(); router.push(`/projects/${p.id}`); }} />
    </div>
  );
}
