"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { AlarmClock, ClipboardCheck, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataPagination } from "@/components/shared/data-pagination";
import { PageHeader } from "@/components/shared/page-header";
import { DepartmentChip } from "@/components/shared/badges";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useDebounce } from "@/hooks/use-debounce";
import { fetcher, qs } from "@/lib/http";
import { REVIEW_OVERDUE_HOURS } from "@/lib/constants";
import type { Paginated, ReviewQueueRowDTO } from "@/types/dto";
import { ReviewStatusBadge } from "./review-status-badge";

const FILTERS = [
  { value: "all", label: "All reviews" },
  { value: "pending", label: "Pending review" },
  { value: "changes", label: "Changes requested" },
  { value: "approved", label: "Approved" },
  { value: "overdue", label: "Overdue reviews" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

function Person({ name }: { name: string | null }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-2">
      <UserAvatar name={name} size="sm" />
      <span className="max-w-32 truncate text-sm">{name}</span>
    </span>
  );
}

/**
 * Reviews routed to you, plus (for Project Managers) the reviews of tickets you triage. The Review button
 * only appears for the assigned reviewer and administrators; the server enforces this independently.
 */
export function ReviewQueue() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const search = useDebounce(q, 300);
  const { data, error, isLoading, mutate } = useSWR<Paginated<ReviewQueueRowDTO>>(
    `/api/tickets/reviews${qs({ filter, q: search, page, pageSize })}`,
    fetcher,
    { keepPreviousData: true, refreshInterval: 30_000 }
  );
  const items = data?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Review queue" description="Finished work waiting for a reviewer's decision. Rejected work returns to the assignee and comes back here to the same reviewer." />

      <div className="rounded-xl border bg-card shadow-xs">
        <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={filter} onValueChange={(v) => { setFilter(v as Filter); setPage(1); }}>
            <TabsList className="h-auto flex-wrap">
              {FILTERS.map((f) => <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <div className="relative w-full lg:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search ticket or title…" className="pl-8" aria-label="Search reviews" />
          </div>
        </div>

        {error ? (
          <ErrorState message={error.message} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <TableSkeleton rows={6} cols={7} />
        ) : !items.length ? (
          <EmptyState
            icon={ClipboardCheck}
            title={search || filter !== "all" ? "No reviews match" : "Nothing to review"}
            description={filter === "overdue" ? `Reviews waiting longer than ${REVIEW_OVERDUE_HOURS} hours appear here.` : "When an assignee submits work and you are its reviewer, it appears here."}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Ticket</TableHead>
                  <TableHead className="hidden lg:table-cell">Department</TableHead>
                  <TableHead className="hidden md:table-cell">Assigned to</TableHead>
                  <TableHead className="hidden md:table-cell">Reviewer</TableHead>
                  <TableHead className="hidden sm:table-cell">Submitted</TableHead>
                  <TableHead>Review status</TableHead>
                  <TableHead className="pr-4 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[320px] pl-4">
                      <Link href={`/tickets/${r.id}`} className="block truncate font-medium hover:text-primary">{r.title}</Link>
                      <span className="font-mono text-xs text-muted-foreground">{r.ticketNumber}</span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{r.targetDepartment ? <DepartmentChip name={r.targetDepartment.name} color={r.targetDepartment.color} /> : "—"}</TableCell>
                    <TableCell className="hidden md:table-cell"><Person name={r.assignee?.name ?? null} /></TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Person name={r.reviewerName} />
                      {r.legacyReviewer ? <span className="text-[11px] text-muted-foreground">requester (no reviewer assigned)</span> : null}
                    </TableCell>
                    <TableCell className="tabular hidden whitespace-nowrap text-sm text-muted-foreground sm:table-cell">{r.submittedAt ? format(new Date(r.submittedAt), "d MMM yyyy, HH:mm") : "—"}</TableCell>
                    <TableCell>
                      <span className="flex flex-col items-start gap-1">
                        <ReviewStatusBadge status={r.reviewStatus} />
                        {r.isOverdue ? <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><AlarmClock className="size-3" /> Overdue</span> : null}
                      </span>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {r.canReview ? (
                        <Button size="sm" asChild><Link href={`/tickets/${r.id}`}>Review</Link></Button>
                      ) : (
                        <Button size="sm" variant="ghost" asChild><Link href={`/tickets/${r.id}`}>View</Link></Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataPagination page={data!.page} pageSize={data!.pageSize} total={data!.total} totalPages={data!.totalPages} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} label="reviews" />
          </>
        )}
      </div>
    </div>
  );
}
