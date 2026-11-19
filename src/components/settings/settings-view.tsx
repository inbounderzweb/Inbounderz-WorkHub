"use client";

import { useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { Check, History, Lock, Minus, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
import { api, fetcher, qs } from "@/lib/http";
import { cn } from "@/lib/utils";
import { LOCKED_PERMISSIONS, PERMISSIONS, type Permission } from "@/lib/permissions";
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
  editable: boolean;
};

type Pending = { role: RoleOverview; permission: Permission; allowed: boolean };

const GROUPS: { label: string; prefix: string[] }[] = [
  { label: "Employees", prefix: ["employee:"] },
  { label: "Departments", prefix: ["department:"] },
  { label: "Projects & tasks", prefix: ["project:", "task:", "ticket:", "daily-update:"] },
  { label: "Clients", prefix: ["client:"] },
  { label: "Reports & system", prefix: ["report:", "audit:", "settings:"] },
];

function RolesPanel() {
  const { data, error, isLoading, mutate } = useSWR<RoleOverview[]>("/api/roles", fetcher);
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  if (error) return <ErrorState message={error.message} onRetry={() => mutate()} />;
  if (isLoading || !data) return <TableSkeleton rows={8} cols={6} />;

  const allPerms = Object.keys(PERMISSIONS) as Permission[];

  async function apply() {
    if (!pending) return;
    setSaving(true);
    try {
      await api("/api/roles/permissions", { method: "PATCH", body: { role: pending.role.key, permission: pending.permission, allowed: pending.allowed } });
      await mutate();
      toast.success(`${pending.allowed ? "Granted" : "Revoked"} "${PERMISSIONS[pending.permission]}" ${pending.allowed ? "to" : "from"} ${pending.role.name}`);
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change the permission");
    } finally {
      setSaving(false);
    }
  }

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
      {/* overflow-clip (not hidden/auto) keeps the rounded corners without creating a scroll container, so the header row can stick to the page. */}
      <div className="overflow-clip rounded-xl border bg-card shadow-xs">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Permission matrix</p>
          <p className="text-xs text-muted-foreground">Enforced on the server for every request. Click a cell to grant or revoke a permission; you&rsquo;ll be asked to confirm. Super Admin and the settings/audit permissions are fixed.</p>
        </div>
        <div>
          {/* Plain <table>: the shared Table wraps itself in an overflow container, which would stop the header sticking. */}
          <table className="w-full caption-bottom text-sm">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky top-16 z-10 min-w-64 bg-muted pl-4">Permission</TableHead>
                {data.map((r) => (
                  <TableHead key={r.key} className="sticky top-16 z-10 bg-muted text-center whitespace-nowrap">{r.name}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {GROUPS.map((g) => (
                <GroupRows key={g.label} label={g.label} perms={allPerms.filter((p) => g.prefix.some((x) => p.startsWith(x)))} roles={data} onToggle={(role, permission, allowed) => setPending({ role, permission, allowed })} />
              ))}
            </TableBody>
          </table>
        </div>
      </div>
      <AlertDialog open={!!pending} onOpenChange={(o) => !o && !saving && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.allowed ? "Grant this permission?" : "Revoke this permission?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? (
                <>
                  Every <strong>{pending.role.name}</strong> ({pending.role.activeUsers} active {pending.role.activeUsers === 1 ? "user" : "users"}) will {pending.allowed ? "be able to" : "no longer be able to"}{" "}
                  <strong>{PERMISSIONS[pending.permission].toLowerCase()}</strong> <span className="font-mono text-xs">({pending.permission})</span>. It takes effect on their next request and is recorded in the audit log.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <Button variant={pending?.allowed ? "default" : "destructive"} onClick={apply} disabled={saving}>
              {saving ? <Spinner /> : null}
              {pending?.allowed ? "Grant access" : "Revoke access"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GroupRows({ label, perms, roles, onToggle }: { label: string; perms: Permission[]; roles: RoleOverview[]; onToggle: (role: RoleOverview, permission: Permission, allowed: boolean) => void }) {
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
          {roles.map((r) => {
            const allowed = r.permissions.some((x) => x.key === p);
            const locked = !r.editable || LOCKED_PERMISSIONS.includes(p);
            const icon = allowed ? <Check className="size-4 text-primary" aria-hidden /> : <Minus className="size-4 text-muted-foreground/40" aria-hidden />;
            return (
              <TableCell key={r.key} className="text-center">
                {locked ? (
                  <span className="relative mx-auto flex size-8 items-center justify-center" title={r.editable ? "Reserved for Super Admin" : "Super Admin permissions are fixed"}>
                    {icon}
                    <span className="sr-only">{allowed ? "Allowed" : "Not allowed"} (fixed)</span>
                    {!allowed && r.editable ? <Lock className="absolute -right-0.5 -bottom-0.5 size-2.5 text-muted-foreground/50" aria-hidden /> : null}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onToggle(r, p, !allowed)}
                    className={cn("mx-auto flex size-8 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", allowed ? "hover:bg-primary/10" : "")}
                    aria-label={`${allowed ? "Revoke" : "Grant"} ${PERMISSIONS[p]} ${allowed ? "from" : "to"} ${r.name}`}
                    aria-pressed={allowed}
                  >
                    {icon}
                  </button>
                )}
              </TableCell>
            );
          })}
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
            <SelectItem value="Role">Roles & permissions</SelectItem>
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
