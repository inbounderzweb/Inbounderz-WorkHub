"use client";

import Link from "next/link";
import useSWR from "swr";
import { Ticket } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/http";
import type { TicketSummaryDTO } from "@/types/dto";
import { Panel } from "./panel";

function Line({ label, value, tone }: { label: string; value: number; tone?: "red" | "amber" }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular font-semibold ${tone === "red" && value ? "text-red-600" : tone === "amber" && value ? "text-amber-600" : ""}`}>{value}</span>
    </li>
  );
}

/** Live ticket counts for the dashboards. Shows the sections that apply to the viewer. */
export function TicketsPanel({ title }: { title: string }) {
  const { data, error, mutate } = useSWR<TicketSummaryDTO>("/api/tickets/summary", fetcher);
  return (
    <Panel title={title} description="Cross-department tickets" href="/tickets" bodyClassName="divide-y">
      {error ? (
        <ErrorState message={error.message} onRetry={() => mutate()} className="py-6" />
      ) : !data ? (
        <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
      ) : (
        <>
          {data.queue ? (
            <>
              <Line label="Pending approval" value={data.queue.pendingApproval} tone="amber" />
              <Line label="Unassigned" value={data.queue.unassigned} tone="red" />
              <Line label="Overdue" value={data.queue.overdue} tone="red" />
            </>
          ) : null}
          {data.department ? <Line label="Department tickets open" value={data.department.open} /> : null}
          <Line label="Raised by me · open" value={data.raised.pending + data.raised.clarification + data.raised.inProgress + data.raised.review} />
          <Line label="Waiting for my review" value={data.raised.review} tone="amber" />
          <Line label="Assigned to me · active" value={data.assigned.pending + data.assigned.inProgress + data.assigned.onHold} />
          {!data.raised.total && !data.assigned.total && !data.queue ? (
            <EmptyState icon={Ticket} title="No tickets yet" description="Raise a ticket to ask another department for help." className="py-6" />
          ) : null}
          <li className="list-none px-4 py-2.5 text-xs">
            <Link href="/tickets" className="text-primary hover:underline">Open tickets</Link>
          </li>
        </>
      )}
    </Panel>
  );
}
