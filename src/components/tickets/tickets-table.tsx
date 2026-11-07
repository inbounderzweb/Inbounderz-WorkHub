"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PriorityBadge } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { day } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TicketListItemDTO } from "@/types/dto";
import { DeptChip, TicketStatusBadge } from "./ticket-badges";

export function TicketDue({ t }: { t: Pick<TicketListItemDTO, "dueDate" | "isOverdue"> }) {
  return (
    <span className={cn("tabular whitespace-nowrap", t.isOverdue ? "font-medium text-red-600" : "text-muted-foreground")}>
      {t.isOverdue ? "Overdue · " : ""}
      {format(day(t.dueDate), "d MMM yyyy")}
    </span>
  );
}

function Person({ user, empty = "—" }: { user: TicketListItemDTO["assignee"]; empty?: string }) {
  if (!user) return <span className="text-sm text-muted-foreground">{empty}</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <UserAvatar name={user.name} size="sm" />
      <span className="max-w-32 truncate text-sm">{user.name}</span>
    </span>
  );
}

/** Ticket table. `variant` picks the columns: the requester's view or the management queue. */
export function TicketsTable({ items, variant }: { items: TicketListItemDTO[]; variant: "mine" | "manage" }) {
  const router = useRouter();
  const manage = variant === "manage";
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className="pl-4">Ticket</TableHead>
          {manage ? <TableHead className="hidden md:table-cell">Requester</TableHead> : null}
          {manage ? <TableHead className="hidden xl:table-cell">From</TableHead> : null}
          <TableHead className="hidden lg:table-cell">{manage ? "To" : "Department"}</TableHead>
          <TableHead className="hidden sm:table-cell">Priority</TableHead>
          <TableHead>Due</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden md:table-cell">Assigned to</TableHead>
          <TableHead className="hidden pr-4 xl:table-cell">Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((t) => (
          <TableRow key={t.id} className="cursor-pointer" onClick={() => router.push(`/tickets/${t.id}`)}>
            <TableCell className="max-w-[340px] pl-4">
              <Link href={`/tickets/${t.id}`} onClick={(e) => e.stopPropagation()} className="block min-w-0">
                <span className="flex items-center gap-2">
                  {t.awaitingMe ? <span className="size-2 shrink-0 rounded-full bg-primary" title="Waiting for you" /> : null}
                  <span className="truncate font-medium hover:text-primary">{t.title}</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{t.ticketNumber}</span>
                  <span className="truncate">{t.category.name}</span>
                  {t.project ? <span className="hidden truncate lg:inline">· {t.project.code}</span> : null}
                </span>
              </Link>
            </TableCell>
            {manage ? <TableCell className="hidden md:table-cell"><Person user={t.requester} /></TableCell> : null}
            {manage ? <TableCell className="hidden max-w-40 xl:table-cell"><DeptChip dept={t.requestingDepartment} /></TableCell> : null}
            <TableCell className="hidden max-w-40 lg:table-cell"><DeptChip dept={t.targetDepartment} /></TableCell>
            <TableCell className="hidden sm:table-cell"><PriorityBadge priority={t.priority} /></TableCell>
            <TableCell className="text-sm"><TicketDue t={t} /></TableCell>
            <TableCell><TicketStatusBadge status={t.status} /></TableCell>
            <TableCell className="hidden md:table-cell"><Person user={t.assignee} empty="Unassigned" /></TableCell>
            <TableCell className="tabular hidden pr-4 text-sm whitespace-nowrap text-muted-foreground xl:table-cell">
              {format(new Date(t.createdAt), "d MMM yyyy")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
