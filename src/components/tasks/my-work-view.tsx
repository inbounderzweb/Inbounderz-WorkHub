"use client";

import { useState } from "react";
import useSWR from "swr";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TicketsView } from "@/components/tickets/tickets-view";
import { fetcher } from "@/lib/http";
import type { Paginated, TaskListItemDTO, TicketDTO } from "@/types/dto";
import { TasksView } from "./tasks-view";

/** Personal project tasks and assigned tickets, each retaining its own workflow. */
export function MyWorkView({ initialTaskCount, initialTicketCount }: { initialTaskCount: number; initialTicketCount: number }) {
  const [selection, setSelection] = useState<string | null>(null);
  const { data: tasks } = useSWR<Paginated<TaskListItemDTO>>("/api/tasks?scope=mine&pageSize=1", fetcher, { refreshInterval: 30_000 });
  const { data: tickets } = useSWR<Paginated<TicketDTO>>("/api/tickets?scope=assigned&view=open&pageSize=1", fetcher, { refreshInterval: 30_000 });
  const { data: done } = useSWR<Paginated<TicketDTO>>("/api/tickets?scope=assigned&view=closed&pageSize=1", fetcher, { refreshInterval: 30_000 });
  const taskCount = tasks?.total ?? initialTaskCount;
  const ticketCount = tickets?.total ?? initialTicketCount;
  const doneCount = done?.total ?? 0;
  const tab = selection ?? (taskCount === 0 && ticketCount > 0 ? "tickets" : "tasks");

  return <div className="space-y-5">
    <PageHeader title="My Tasks" description="Project tasks you own or collaborate on, and cross-department tickets assigned to you. Finished tickets move to their own tab." />
    <Tabs value={tab} onValueChange={setSelection} className="space-y-4">
      <TabsList aria-label="My assigned work">
        <TabsTrigger value="tasks">Project tasks <span className="tabular ml-1 rounded-full bg-muted px-1.5 text-xs">{taskCount}</span></TabsTrigger>
        <TabsTrigger value="tickets">Active tickets <span className="tabular ml-1 rounded-full bg-muted px-1.5 text-xs">{ticketCount}</span></TabsTrigger>
        <TabsTrigger value="done">Completed tickets <span className="tabular ml-1 rounded-full bg-muted px-1.5 text-xs">{doneCount}</span></TabsTrigger>
      </TabsList>
      <TabsContent value="tasks"><TasksView scope="mine" embedded /></TabsContent>
      <TabsContent value="tickets"><TicketsView initialScope="assigned" embedded assignedOnly fixedView="open" /></TabsContent>
      <TabsContent value="done"><TicketsView initialScope="assigned" embedded assignedOnly fixedView="closed" /></TabsContent>
    </Tabs>
  </div>;
}
