"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { Building2, FolderKanban, ListTodo, MoreHorizontal, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/shared/page-header";
import { DataPagination } from "@/components/shared/data-pagination";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { CardGridSkeleton } from "@/components/shared/skeletons";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useCan, useCurrentUser } from "@/components/providers/user-provider";
import { useDebounce } from "@/hooks/use-debounce";
import { fetcher, qs } from "@/lib/http";
import type { DepartmentDTO, Paginated } from "@/types/dto";
import { DepartmentFormDialog } from "./department-form-dialog";
import { DeleteDepartmentDialog } from "./delete-department-dialog";

const PAGE_SIZE = 12;

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="size-3" /> {label}
      </p>
      <p className="tabular text-base font-semibold">{value}</p>
    </div>
  );
}

export function DepartmentsView() {
  const me = useCurrentUser();
  const canCreate = useCan("department:create");
  const canEdit = useCan("department:update");
  const canDelete = useCan("department:delete");

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounce(q, 300);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentDTO | null>(null);
  const [deleting, setDeleting] = useState<DepartmentDTO | null>(null);

  const { data, error, isLoading, mutate } = useSWR<Paginated<DepartmentDTO>>(
    `/api/departments${qs({ q: search, status, page, pageSize: PAGE_SIZE })}`,
    fetcher,
    { keepPreviousData: true }
  );
  const filtersActive = !!(q || status);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Departments"
        description={me.role === "SUPER_ADMIN" || me.role === "PROJECT_MANAGER" ? "All departments, their leadership and workload." : "Departments you belong to or manage."}
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New department
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search departments…" className="bg-card pl-8" aria-label="Search departments" />
        </div>
        <Select value={status || "__all"} onValueChange={(v) => { setStatus(v === "__all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-full bg-card sm:w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <div className="rounded-xl border bg-card">
          <ErrorState message={error.message} onRetry={() => mutate()} />
        </div>
      ) : isLoading && !data ? (
        <CardGridSkeleton />
      ) : !data?.items.length ? (
        <div className="rounded-xl border border-dashed bg-card">
          <EmptyState
            icon={Building2}
            title={filtersActive ? "No departments match your search" : "No departments yet"}
            description={!filtersActive && canCreate ? "Create departments to organise employees and work." : undefined}
            action={
              !filtersActive && canCreate ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus /> New department
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((d) => (
              <article key={d.id} className="group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition hover:border-primary/40 hover:shadow-sm">
                <div className="h-1" style={{ backgroundColor: d.color }} />
                <div className="flex flex-1 flex-col gap-4 p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: d.color }}>
                      {d.code.slice(0, 3)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/departments/${d.id}`} className="block truncate font-semibold after:absolute after:inset-0 hover:text-primary">
                        {d.name}
                      </Link>
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{d.code}</span>
                        {d.status === "ARCHIVED" ? <span className="rounded-full bg-muted px-1.5 py-px">Archived</span> : null}
                      </p>
                    </div>
                    {canEdit || canDelete ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="relative z-10" aria-label={`Actions for ${d.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEdit ? (
                            <DropdownMenuItem onSelect={() => setEditing(d)}>
                              <Pencil /> Edit
                            </DropdownMenuItem>
                          ) : null}
                          {canDelete ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(d)}>
                                <Trash2 /> Delete
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                  <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{d.description || "No description"}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Metric icon={Users} label="Employees" value={d.employeeCount} />
                    <Metric icon={FolderKanban} label="Projects" value={d.activeProjects} />
                    <Metric icon={ListTodo} label="Open tasks" value={d.openTasks} />
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3">
                    {d.head ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <UserAvatar name={d.head.name} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{d.head.name}</span>
                          <span className="block text-[11px] text-muted-foreground">Department head</span>
                        </span>
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">No head assigned</span>
                    )}
                    {d.teamLeaders.length ? (
                      <span className="flex -space-x-2" title={d.teamLeaders.map((t) => t.name).join(", ")}>
                        {d.teamLeaders.slice(0, 3).map((t) => (
                          <UserAvatar key={t.id} name={t.name} size="sm" className="ring-2 ring-card" />
                        ))}
                      </span>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {data.totalPages > 1 ? (
            <div className="rounded-xl border bg-card">
              <DataPagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} onPageChange={setPage} label="departments" />
            </div>
          ) : null}
        </>
      )}

      <DepartmentFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={() => mutate()} />
      <DepartmentFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} department={editing ?? undefined} onSaved={() => mutate()} />
      <DeleteDepartmentDialog department={deleting} onOpenChange={(o) => !o && setDeleting(null)} onDeleted={() => mutate()} />
    </div>
  );
}
