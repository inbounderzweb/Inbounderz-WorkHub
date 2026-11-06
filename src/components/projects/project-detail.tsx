"use client";

import { day } from "@/lib/dates";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { format, isPast } from "date-fns";
import { toast } from "sonner";
import {
  AlarmClock,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CheckCircle2,
  Info,
  ListTodo,
  Loader,
  Pencil,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Panel } from "@/components/dashboard/panel";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataPagination } from "@/components/shared/data-pagination";
import { DetailSkeleton } from "@/components/shared/skeletons";
import { ErrorState } from "@/components/shared/states";
import { PriorityBadge, ProjectStatusBadge } from "@/components/shared/badges";
import { StatCard } from "@/components/shared/stat-card";
import { UserAvatar } from "@/components/shared/user-avatar";
import { AttachmentsPanel } from "@/components/shared/attachments-panel";
import { TasksView } from "@/components/tasks/tasks-view";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { api, ApiClientError, fetcher, qs } from "@/lib/http";
import { APPROVAL_MODE_LABELS } from "@/lib/constants";
import type { ActivityDTO, Paginated, ProjectDetailDTO } from "@/types/dto";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectMilestones } from "./project-milestones";
import { ProjectTeam } from "./project-team";
import { ProjectTimeline } from "./project-timeline";

function ProjectActivity({ projectId }: { projectId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSWR<Paginated<ActivityDTO>>(`/api/projects/${projectId}/activity${qs({ page, pageSize: 20 })}`, fetcher, { keepPreviousData: true });
  if (isLoading && !data) return <div className="p-6 text-sm text-muted-foreground">Loading activity…</div>;
  return (
    <>
      <ActivityFeed items={data?.items ?? []} />
      {data && data.totalPages > 1 ? <DataPagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} onPageChange={setPage} label="events" /> : null}
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

export function ProjectDetail({ id }: { id: string }) {
  const { data: p, error, isLoading, mutate } = useSWR<ProjectDetailDTO>(`/api/projects/${id}`, fetcher);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [tasksVersion, setTasksVersion] = useState(0);

  if (error) {
    return (
      <div className="rounded-xl border bg-card">
        <ErrorState
          title={error.status === 404 ? "Project not found" : "Couldn't load this project"}
          message={error.status === 404 ? "It doesn't exist or you aren't allocated to it." : error.message}
          onRetry={error.status === 404 ? undefined : () => mutate()}
        />
      </div>
    );
  }
  if (isLoading || !p) return <DetailSkeleton />;

  const pg = p.progress;
  const countable = pg.total - pg.cancelled;
  const late = p.endDate && isPast(new Date(p.endDate)) && !["COMPLETED", "CANCELLED"].includes(p.status);
  const refresh = () => {
    mutate();
    setTasksVersion((v) => v + 1);
  };

  return (
    <div className="space-y-6">
      <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Projects
      </Link>

      {p.isArchived ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <Archive className="size-4" /> This project is archived and read-only.
        </div>
      ) : null}

      <section className="rounded-xl border bg-card p-5 shadow-xs">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="font-mono text-xs text-muted-foreground">{p.code}{p.client ? ` · ${p.client}` : ""}</p>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{p.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <ProjectStatusBadge status={p.status} />
              <PriorityBadge priority={p.priority} />
              {p.departments.map((d) => (
                <span key={d.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: d.color }} />{d.name}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.can.createTask ? <Button onClick={() => setTaskOpen(true)}><Plus /> New task</Button> : null}
            {p.can.edit ? <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button> : null}
            {p.can.archive ? (
              <Button variant="outline" onClick={() => setArchiveOpen(true)}>
                {p.isArchived ? <><ArchiveRestore /> Unarchive</> : <><Archive /> Archive</>}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <div className="flex flex-col justify-between rounded-xl border bg-card p-4 shadow-xs sm:col-span-2">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Completion</p>
            <Tooltip>
              <TooltipTrigger asChild><button type="button" aria-label="How progress is calculated"><Info className="size-4 text-muted-foreground" /></button></TooltipTrigger>
              <TooltipContent className="max-w-64">
                Completed ÷ (all tasks − cancelled). Subtasks count as tasks. In progress = In Progress, In Review, Changes Requested. Pending = Backlog, To Do, On Hold.
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="tabular text-3xl font-semibold">{pg.percent}%</p>
          <Progress value={pg.percent} className="h-2" />
          <p className="mt-1 text-xs text-muted-foreground">{pg.completed} of {countable} task{countable === 1 ? "" : "s"} completed{pg.cancelled ? ` · ${pg.cancelled} cancelled excluded` : ""}</p>
        </div>
        <StatCard label="Total tasks" value={pg.total} icon={ListTodo} tone="slate" />
        <StatCard label="Completed" value={pg.completed} icon={CheckCircle2} />
        <StatCard label="In progress" value={pg.inProgress} icon={Loader} tone="blue" hint={`${pg.pending} pending`} />
        <StatCard label="Overdue" value={pg.overdue} icon={AlarmClock} tone="red" />
      </div>

      <Tabs defaultValue="overview" className="gap-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({pg.total})</TabsTrigger>
          <TabsTrigger value="team">Team ({p.members.length})</TabsTrigger>
          <TabsTrigger value="documents">Documents ({p.documents.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-3">
            <Panel title="About" className="xl:col-span-2" bodyClassName="space-y-4 p-4">
              <p className="text-sm whitespace-pre-wrap">{p.description || <span className="text-muted-foreground">No description.</span>}</p>
              {p.notes ? (
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{p.notes}</p>
                </div>
              ) : null}
            </Panel>
            <Panel title="Details">
              <dl className="grid grid-cols-2 gap-4 p-4">
                <Detail label="Project manager">{p.manager ? <span className="inline-flex items-center gap-2"><UserAvatar name={p.manager.name} size="sm" />{p.manager.name}</span> : "—"}</Detail>
                <Detail label="Client">{p.client || "—"}</Detail>
                <Detail label="Start date">{p.startDate ? format(day(p.startDate), "d MMM yyyy") : "—"}</Detail>
                <Detail label="Deadline"><span className={late ? "text-red-600" : undefined}>{p.endDate ? format(day(p.endDate), "d MMM yyyy") : "—"}</span></Detail>
                <Detail label="Budget">{p.budget != null ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(p.budget) : "—"}</Detail>
                <Detail label="Task approval">{APPROVAL_MODE_LABELS[p.approvalMode]}</Detail>
              </dl>
            </Panel>
          </div>
          <Panel title="Timeline" description="Project span, milestones and top-level tasks">
            <ProjectTimeline project={p} />
          </Panel>
          <Panel title="Milestones" description={`${p.milestones.filter((m) => m.status === "COMPLETED").length} of ${p.milestones.length} completed`}>
            <ProjectMilestones projectId={p.id} milestones={p.milestones} canEdit={p.can.edit} onChanged={() => mutate()} />
          </Panel>
        </TabsContent>

        <TabsContent value="tasks">
          <TasksView key={tasksVersion} scope="all" projectId={p.id} embedded canCreateInProject={p.can.createTask} />
        </TabsContent>

        <TabsContent value="team">
          <ProjectTeam project={p} onChanged={() => mutate()} />
        </TabsContent>

        <TabsContent value="documents">
          <div className="overflow-hidden rounded-xl border bg-card">
            <AttachmentsPanel items={p.documents} uploadUrl={`/api/projects/${p.id}/documents`} canUpload={p.can.edit} onChanged={() => mutate()} emptyText="No project documents" />
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <div className="overflow-hidden rounded-xl border bg-card">
            <ProjectActivity projectId={p.id} />
          </div>
        </TabsContent>
      </Tabs>

      {p.can.edit ? <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} project={p} onSaved={() => mutate()} /> : null}
      {p.can.createTask ? <TaskFormDialog open={taskOpen} onOpenChange={setTaskOpen} projectId={p.id} onSaved={refresh} /> : null}
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={p.isArchived ? `Unarchive ${p.name}?` : `Archive ${p.name}?`}
        description={p.isArchived ? "The project becomes editable again and reappears in project lists." : "The project and its tasks become read-only and are hidden from default lists. All data is kept and you can unarchive it any time."}
        confirmLabel={p.isArchived ? "Unarchive" : "Archive"}
        onConfirm={async () => {
          try {
            await api(`/api/projects/${p.id}/archive`, { method: "POST", body: { archived: !p.isArchived } });
            toast.success(p.isArchived ? "Project unarchived" : "Project archived");
            mutate();
          } catch (err) {
            toast.error(err instanceof ApiClientError ? err.message : "Couldn't update the project");
            return false;
          }
        }}
      />
    </div>
  );
}
