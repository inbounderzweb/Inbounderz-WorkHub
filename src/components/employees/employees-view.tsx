"use client";

import { day } from "@/lib/dates";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { Eye, FilterX, MoreHorizontal, Pencil, Power, Search, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { TableSkeleton } from "@/components/shared/skeletons";
import { DepartmentChip, RoleBadge, UserStatusBadge } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useCan, useCurrentUser } from "@/components/providers/user-provider";
import { useDebounce } from "@/hooks/use-debounce";
import { useDepartmentOptions } from "@/hooks/use-options";
import { fetcher, qs } from "@/lib/http";
import { DEFAULT_PAGE_SIZE, ROLE_KEYS, ROLE_META } from "@/lib/constants";
import { ASSIGNABLE_ROLES } from "@/lib/permissions";
import type { EmployeeDTO, Paginated } from "@/types/dto";
import { EmployeeFormDialog } from "./employee-form-dialog";
import { EmployeeStatusDialog } from "./employee-actions";

const ALL = "__all";

export type EmployeeFilters = { department?: string };

/**
 * Employee directory. When `lockedDepartment` is set (department detail page),
 * the department filter is fixed and the header is omitted.
 */
export function EmployeesView({
  lockedDepartment,
  embedded = false,
  extraRowActions,
}: {
  lockedDepartment?: string;
  embedded?: boolean;
  extraRowActions?: (e: EmployeeDTO, refresh: () => void) => React.ReactNode;
}) {
  const me = useCurrentUser();
  const canCreate = useCan("employee:create");
  const canStatus = useCan("employee:status");

  const [q, setQ] = useState("");
  const [department, setDepartment] = useState(lockedDepartment ?? "");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("-createdAt");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const search = useDebounce(q, 300);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeDTO | null>(null);
  const [statusTarget, setStatusTarget] = useState<EmployeeDTO | null>(null);

  const key = `/api/employees${qs({ q: search, department, role, status, sort, page, pageSize })}`;
  const { data, error, isLoading, mutate } = useSWR<Paginated<EmployeeDTO>>(key, fetcher, { keepPreviousData: true });
  const { data: departments } = useDepartmentOptions(!lockedDepartment);

  const filtersActive = !!(q || (!lockedDepartment && department) || role || status);
  const resetFilters = () => {
    setQ("");
    if (!lockedDepartment) setDepartment("");
    setRole("");
    setStatus("");
    setPage(1);
  };
  const onFilter = (setter: (v: string) => void) => (v: string) => {
    setter(v === ALL ? "" : v);
    setPage(1);
  };

  // Mirrors server rules so we only offer actions that will succeed.
  const canManageRow = (e: EmployeeDTO) =>
    e.id !== me.id &&
    (me.role === "SUPER_ADMIN" ||
      (me.role === "DEPARTMENT_HEAD" && !!e.role && ASSIGNABLE_ROLES[me.role].includes(e.role.key) && !!e.department));

  return (
    <div className="space-y-5">
      {!embedded ? (
        <PageHeader
          title="Employees"
          description={
            me.role === "SUPER_ADMIN" || me.role === "PROJECT_MANAGER"
              ? "Everyone at Inbounderz, their departments, roles and reporting lines."
              : "Employees in the departments and teams you manage."
          }
          actions={
            canCreate ? (
              <Button onClick={() => setCreateOpen(true)}>
                <UserPlus /> Add employee
              </Button>
            ) : null
          }
        />
      ) : null}

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, email, ID, phone…"
              className="pl-8"
              aria-label="Search employees"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {!lockedDepartment ? (
              <Select value={department || ALL} onValueChange={onFilter(setDepartment)}>
                <SelectTrigger className="w-full sm:w-44" aria-label="Filter by department">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All departments</SelectItem>
                  <SelectItem value="none">No department</SelectItem>
                  {departments?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Select value={role || ALL} onValueChange={onFilter(setRole)}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Filter by role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All roles</SelectItem>
                {ROLE_KEYS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_META[r].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status || ALL} onValueChange={onFilter(setStatus)}>
              <SelectTrigger className="w-full sm:w-32" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All status</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="-createdAt">Newest first</SelectItem>
                <SelectItem value="createdAt">Oldest first</SelectItem>
                <SelectItem value="name">Name A–Z</SelectItem>
                <SelectItem value="-name">Name Z–A</SelectItem>
                <SelectItem value="-joiningDate">Recently joined</SelectItem>
                <SelectItem value="employeeId">Employee ID</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive ? (
              <Button variant="ghost" onClick={resetFilters} className="col-span-2 sm:col-span-1">
                <FilterX /> Clear
              </Button>
            ) : null}
          </div>
        </div>

        {error ? (
          <ErrorState message={error.message} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <TableSkeleton rows={pageSize > 10 ? 10 : pageSize} cols={6} />
        ) : !data?.items.length ? (
          <EmptyState
            icon={Users}
            title={filtersActive ? "No employees match your filters" : "No employees yet"}
            description={filtersActive ? "Try adjusting the search or filters." : canCreate ? "Add your first employee to get started." : undefined}
            action={
              filtersActive ? (
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : canCreate && !embedded ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <UserPlus /> Add employee
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Employee</TableHead>
                  <TableHead className="hidden md:table-cell">Employee ID</TableHead>
                  {!lockedDepartment ? <TableHead className="hidden lg:table-cell">Department</TableHead> : null}
                  <TableHead className="hidden sm:table-cell">Role</TableHead>
                  <TableHead className="hidden xl:table-cell">Reports to</TableHead>
                  <TableHead className="hidden xl:table-cell">Joined</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12 pr-4">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={isLoading ? "opacity-60 transition-opacity" : undefined}>
                {data.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="pl-4">
                      <Link href={`/employees/${e.id}`} className="group flex items-center gap-3">
                        <UserAvatar name={e.name} src={e.avatarUrl} />
                        <span className="min-w-0">
                          <span className="block max-w-[220px] truncate font-medium group-hover:text-primary">{e.name}</span>
                          <span className="block max-w-[220px] truncate text-xs text-muted-foreground">{e.designation || e.email}</span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">{e.employeeId}</TableCell>
                    {!lockedDepartment ? (
                      <TableCell className="hidden lg:table-cell">
                        {e.department ? <DepartmentChip name={e.department.name} color={e.department.color} /> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    ) : null}
                    <TableCell className="hidden sm:table-cell">
                      <RoleBadge role={e.role?.key} name={e.role?.name} />
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {e.reportingManager ? <span className="text-sm">{e.reportingManager.name}</span> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                      {e.joiningDate ? format(day(e.joiningDate), "d MMM yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      <UserStatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${e.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem asChild>
                            <Link href={`/employees/${e.id}`}>
                              <Eye /> View profile
                            </Link>
                          </DropdownMenuItem>
                          {canManageRow(e) ? (
                            <DropdownMenuItem onSelect={() => setEditing(e)}>
                              <Pencil /> Edit
                            </DropdownMenuItem>
                          ) : null}
                          {canManageRow(e) && canStatus ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant={e.status === "ACTIVE" ? "destructive" : "default"} onSelect={() => setStatusTarget(e)}>
                                <Power /> {e.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                              </DropdownMenuItem>
                            </>
                          ) : null}
                          {extraRowActions?.(e, () => mutate())}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataPagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              onPageChange={setPage}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
              label="employees"
            />
          </>
        )}
      </div>

      <EmployeeFormDialog open={createOpen} onOpenChange={setCreateOpen} defaultDepartmentId={lockedDepartment} onSaved={() => mutate()} />
      <EmployeeFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} employee={editing ?? undefined} onSaved={() => mutate()} />
      <EmployeeStatusDialog employee={statusTarget} onOpenChange={(o) => !o && setStatusTarget(null)} onDone={() => mutate()} />
    </div>
  );
}
