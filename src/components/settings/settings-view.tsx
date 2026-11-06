"use client";

import { useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { Check, History, Minus, Search, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { DataPagination } from "@/components/shared/data-pagination";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { RoleBadge } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useDebounce } from "@/hooks/use-debounce";
import { fetcher, qs } from "@/lib/http";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import type { RoleKey } from "@/lib/constants";
import type { ActivityDTO, Paginated } from "@/types/dto";

type RoleOverview = {
  id: string;
  key: RoleKey;
  name: string;
  description: string;
  level: number;
  permissions: { key: Permission; label: string }[];
  users: number;
  activeUsers: number;
};

const GROUPS: { label: string; prefix: string[] }[] = [
  { label: "Employees", prefix: ["employee:"] },
  { label: "Departments", prefix: ["department:"] },
  { label: "Projects & tasks", prefix: ["project:", "task:", "ticket:", "daily-update:"] },
  { label: "Reports & system", prefix: ["report:", "audit:", "settings:"] },
];

function RolesPanel() {
  const { data, error, isLoading, mutate } = useSWR<RoleOverview[]>("/api/roles", fetcher);
  if (error) return <ErrorState message={error.message} onRetry={() => mutate()} />;
  if (isLoading || !data) return <TableSkeleton rows={8} cols={6} />;

  const allPerms = Object.keys(PERMISSIONS) as Permission[];
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {data.map((r) => (
          <div key={r.id} className="rounded-xl border bg-card p-4 shadow-xs">
            <RoleBadge role={r.key} name={r.name} />
            <p className="tabular mt-3 text-2xl font-semibold">{r.users}</p>
            <p className="text-xs text-muted-foreground">{r.activeUsers} active users</p>
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Permission matrix</p>
          <p className="text-xs text-muted-foreground">Enforced on the server for every request. Defined in code and synced to the roles collection.</p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="min-w-64 pl-4">Permission</TableHead>
                {data.map((r) => (
                  <TableHead key={r.key} className="text-center whitespace-nowrap">{r.name}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {GROUPS.map((g) => (
                <GroupRows key={g.label} label={g.label} perms={allPerms.filter((p) => g.prefix.some((x) => p.startsWith(x)))} roles={data} />
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function GroupRows({ label, perms, roles }: { label: string; perms: Permission[]; roles: RoleOverview[] }) {
  return (
    <>
      <TableRow className="bg-muted/20 hover:bg-muted/20">
        <TableCell colSpan={roles.length + 1} className="pl-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </TableCell>
      </TableRow>
      {perms.map((p) => (
        <TableRow key={p}>
          <TableCell className="pl-4">
            <p className="text-sm">{PERMISSIONS[p]}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{p}</p>
          </TableCell>
          {roles.map((r) => (
            <TableCell key={r.key} className="text-center">
              {r.permissions.some((x) => x.key === p) ? (
                <Check className="mx-auto size-4 text-primary" aria-label="Allowed" />
              ) : (
                <Minus className="mx-auto size-4 text-muted-foreground/40" aria-label="Not allowed" />
              )}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function AuditPanel() {
  const [q, setQ] = useState("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounce(q, 300);
  const { data, error, isLoading, mutate } = useSWR<Paginated<ActivityDTO>>(
    `/api/audit-logs${qs({ q: search, entityType, page, pageSize: 20 })}`,
    fetcher,
    { keepPreviousData: true }
  );

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search actions or summaries…" className="pl-8" aria-label="Search audit log" />
        </div>
        <Select value={entityType || "__all"} onValueChange={(v) => { setEntityType(v === "__all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by entity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All entities</SelectItem>
            <SelectItem value="User">Users</SelectItem>
            <SelectItem value="Department">Departments</SelectItem>
            <SelectItem value="Project">Projects</SelectItem>
            <SelectItem value="Task">Tasks</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {error ? (
        <ErrorState message={error.message} onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <TableSkeleton rows={8} cols={4} />
      ) : !data?.items.length ? (
        <EmptyState icon={History} title="No audit entries" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead className="hidden md:table-cell">Action</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="pl-4 text-xs whitespace-nowrap text-muted-foreground">{format(new Date(a.createdAt), "d MMM yyyy, HH:mm")}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <UserAvatar name={a.actor?.name ?? "System"} size="sm" />
                      <span className="max-w-36 truncate text-sm">{a.actor?.name ?? "System"}</span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{a.action}</code>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-sm">{a.summary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DataPagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} onPageChange={setPage} label="entries" />
        </>
      )}
    </div>
  );
}

export function SettingsView() {
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Roles, permissions and the system audit trail." />
      <Tabs defaultValue="roles" className="gap-4">
        <TabsList>
          <TabsTrigger value="roles">
            <ShieldCheck /> Roles & permissions
          </TabsTrigger>
          <TabsTrigger value="audit">
            <History /> Audit log
          </TabsTrigger>
        </TabsList>
        <TabsContent value="roles">
          <RolesPanel />
        </TabsContent>
        <TabsContent value="audit">
          <AuditPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
