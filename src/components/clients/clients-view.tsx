"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { Briefcase, GitMerge, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { DataPagination } from "@/components/shared/data-pagination";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { useCan, useCurrentUser } from "@/components/providers/user-provider";
import { useDebounce } from "@/hooks/use-debounce";
import { DEFAULT_PAGE_SIZE, humanize } from "@/lib/constants";
import { fetcher, qs } from "@/lib/http";
import type { ClientDTO, Paginated } from "@/types/dto";
import { ClientStatusBadge } from "./client-badges";
import { ClientFormDialog } from "./client-form-dialog";

export function ClientsView() {
  const me = useCurrentUser();
  const router = useRouter();
  const canCreate = useCan("client:create");
  const canManage = useCan("client:manage");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [createOpen, setCreateOpen] = useState(false);
  const search = useDebounce(q, 300);

  const { data, error, isLoading, mutate } = useSWR<Paginated<ClientDTO>>(`/api/clients${qs({ q: search, status, page, pageSize })}`, fetcher, { keepPreviousData: true });
  const filtersActive = !!(q || status);
  const full = data?.items.some((c) => c.viewLevel === "FULL");
  const showContact = data?.items.some((c) => c.contactPerson !== undefined);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clients"
        description={me.role === "SALES_EXECUTIVE" ? "Clients you own." : me.role === "SUPER_ADMIN" || me.role === "PROJECT_MANAGER" ? "Every client in the organisation." : canCreate ? "Clients you own and clients of the projects you are involved in." : "Clients of the projects you are involved in."}
        actions={
          <>
            {canManage ? (
              <Button variant="outline" asChild>
                <Link href="/clients/duplicate-reviews"><GitMerge /> Duplicate reviews</Link>
              </Button>
            ) : null}
            {canCreate ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> New client
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search clients…" className="bg-card pl-8" aria-label="Search clients" />
        </div>
        <Select value={status || "__all"} onValueChange={(v) => { setStatus(v === "__all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-full bg-card sm:w-40" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All status</SelectItem>
            {["PROSPECT", "ACTIVE", "INACTIVE", ...(me.role === "SUPER_ADMIN" ? ["ARCHIVED"] : [])].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <div className="rounded-xl border bg-card"><ErrorState message={error.message} onRetry={() => mutate()} /></div>
      ) : isLoading && !data ? (
        <TableSkeleton cols={6} />
      ) : !data?.items.length ? (
        <div className="rounded-xl border border-dashed bg-card">
          <EmptyState
            icon={Briefcase}
            title={filtersActive ? "No clients match your search" : "No clients yet"}
            description={!filtersActive && canCreate ? "Add a client to start a project proposal." : undefined}
            action={!filtersActive && canCreate ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus /> New client</Button> : null}
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  {showContact ? <TableHead>Contact</TableHead> : null}
                  {showContact ? <TableHead>Sales owner</TableHead> : null}
                  {full ? <TableHead className="text-right">Projects</TableHead> : null}
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/clients/${c.id}`)}>
                    <TableCell>
                      <Link href={`/clients/${c.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{c.name}</Link>
                      <p className="font-mono text-xs text-muted-foreground">{c.clientCode}{c.businessCategory ? ` · ${c.businessCategory}` : ""}</p>
                    </TableCell>
                    {showContact ? <TableCell>{c.contactPerson || "—"}{c.email ? <p className="text-xs text-muted-foreground">{c.email}</p> : null}</TableCell> : null}
                    {showContact ? <TableCell>{c.salesOwner?.name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell> : null}
                    {full ? <TableCell className="tabular text-right">{c.projectCount ?? "—"}</TableCell> : null}
                    <TableCell><ClientStatusBadge status={c.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DataPagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} label="clients" />
        </>
      )}

      <ClientFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={(c) => { mutate(); router.push(`/clients/${c.id}`); }} />
    </div>
  );
}
