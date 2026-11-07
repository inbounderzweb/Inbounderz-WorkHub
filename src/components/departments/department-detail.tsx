"use client";

import { TaskStatusLabel } from "@/components/shared/labels";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import {
  AlarmClock,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  FolderKanban,
  ListTodo,
  Pencil,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/shared/stat-card";
import { DetailSkeleton } from "@/components/shared/skeletons";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { ProjectStatusBadge, TASK_STATUS_COLORS } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { TaskList } from "@/components/shared/task-list";
import { Panel } from "@/components/dashboard/panel";
import { EmployeesView } from "@/components/employees/employees-view";
import { useCan } from "@/components/providers/user-provider";
import { fetcher } from "@/lib/http";
import { humanize } from "@/lib/constants";
import type { DepartmentDetailDTO, EmployeeDTO } from "@/types/dto";
import { DepartmentFormDialog } from "./department-form-dialog";
import { DeleteDepartmentDialog } from "./delete-department-dialog";
import { AddMembersDialog, RemoveMemberDialog, TeamLeadersDialog } from "./member-dialogs";

export function DepartmentDetail({ id }: { id: string }) {
  const router = useRouter();
  const canReadEmployees = useCan("employee:read");
  const { data: d, error, isLoading, mutate } = useSWR<DepartmentDetailDTO>(`/api/departments/${id}`, fetcher);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leadersOpen, setLeadersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<EmployeeDTO | null>(null);
  const [membersVersion, setMembersVersion] = useState(0);

  if (error) {
    return (
      <div className="rounded-xl border bg-card">
        <ErrorState
          title={error.status === 404 ? "Department not found" : "Couldn't load this department"}
          message={error.status === 404 ? "It doesn't exist or isn't visible to you." : error.message}
          onRetry={error.status === 404 ? undefined : () => mutate()}
        />
      </div>
    );
  }
  if (isLoading || !d) return <DetailSkeleton />;

  const refreshAll = () => {
    mutate();
    setMembersVersion((v) => v + 1);
  };
  const totalTasks = d.tasksByStatus.reduce((s, t) => s + t.count, 0);

  return (
    <div className="space-y-6">
      <Link href="/departments" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Departments
      </Link>

      <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="h-1.5" style={{ backgroundColor: d.color }} />
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl text-base font-semibold text-white" style={{ backgroundColor: d.color }}>
              {d.code.slice(0, 3)}
            </span>
            <div className="min-w-0 space-y-1">
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
                {d.name}
                <span className="font-mono text-sm font-normal text-muted-foreground">{d.code}</span>
                {d.status === "ARCHIVED" ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Archived</span> : null}
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground">{d.description || "No description"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {d.can.assignLeaders && !d.can.edit ? (
              <Button variant="outline" size="sm" onClick={() => setLeadersOpen(true)}>
                <UsersRound /> Team leaders
              </Button>
            ) : null}
            {d.can.edit ? (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil /> Edit
              </Button>
            ) : null}
            {d.can.delete ? (
              <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 /> Delete
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Employees" value={d.stats.employees} icon={Users} hint={`${d.stats.activeEmployees} active`} />
        <StatCard label="Active projects" value={d.stats.activeProjects} icon={FolderKanban} tone="violet" />
        <StatCard label="Open tasks" value={d.stats.openTasks} icon={ListTodo} tone="blue" />
        <StatCard label="In review" value={d.stats.inReview} icon={ClipboardCheck} tone="amber" />
        <StatCard label="Overdue" value={d.stats.overdueTasks} icon={AlarmClock} tone="red" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          title="Leadership"
          action={
            d.can.assignLeaders ? (
              <Button variant="ghost" size="xs" onClick={() => (d.can.edit ? setEditOpen(true) : setLeadersOpen(true))}>
                <Pencil /> Manage
              </Button>
            ) : null
          }
        >
          <div className="space-y-4 p-4">
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Department head</p>
              {d.head ? (
                <Link href={`/employees/${d.head.id}`} className="flex items-center gap-3 rounded-lg p-1 hover:bg-muted/50">
                  <UserAvatar name={d.head.name} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{d.head.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{d.head.email}</span>
                  </span>
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">Not assigned</p>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Team leaders ({d.teamLeaders.length})</p>
              {d.teamLeaders.length ? (
                <ul className="space-y-1">
                  {d.teamLeaders.map((t) => (
                    <li key={t.id}>
                      <Link href={`/employees/${t.id}`} className="flex items-center gap-3 rounded-lg p-1 hover:bg-muted/50">
                        <UserAvatar name={t.name} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{t.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{t.designation || t.email}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No team leaders assigned</p>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="Task overview" description={`${totalTasks} tasks · ${d.stats.completedTasks} completed`} className="xl:col-span-2" bodyClassName="p-4">
          {totalTasks ? (
            <div className="space-y-3">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                {d.tasksByStatus.filter((t) => t.count).map((t) => (
                  <div key={t.status} style={{ width: `${(t.count / totalTasks) * 100}%`, backgroundColor: TASK_STATUS_COLORS[t.status] }} title={`${humanize(t.status)}: ${t.count}`} />
                ))}
              </div>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {d.tasksByStatus.map((t) => (
                  <li key={t.status} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className="size-2 rounded-sm" style={{ backgroundColor: TASK_STATUS_COLORS[t.status] }} />
                      <TaskStatusLabel value={t.status} />
                    </span>
                    <span className="tabular font-semibold">{t.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState icon={CheckCircle2} title="No tasks yet" description="Tasks assigned to this department will be summarised here." className="py-8" />
          )}
        </Panel>
      </div>

      <Tabs defaultValue={canReadEmployees ? "employees" : "tasks"} className="gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            {canReadEmployees ? <TabsTrigger value="employees">Employees ({d.stats.employees})</TabsTrigger> : null}
            <TabsTrigger value="tasks">Open tasks</TabsTrigger>
            <TabsTrigger value="projects">Projects ({d.projects.length})</TabsTrigger>
          </TabsList>
          {d.can.manageMembers && d.status === "ACTIVE" ? (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <UserPlus /> Add employees
            </Button>
          ) : null}
        </div>

        {canReadEmployees ? (
          <TabsContent value="employees">
            <EmployeesView
              key={membersVersion}
              embedded
              lockedDepartment={d.id}
              extraRowActions={
                d.can.manageMembers
                  ? (e) => (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(e)}>
                          <UserMinus /> Remove from department
                        </DropdownMenuItem>
                      </>
                    )
                  : undefined
              }
            />
          </TabsContent>
        ) : null}

        <TabsContent value="tasks">
          <div className="overflow-hidden rounded-xl border bg-card">
            <TaskList tasks={d.recentTasks} emptyTitle="No open tasks" emptyDescription="This department has no open work right now." />
          </div>
        </TabsContent>

        <TabsContent value="projects">
          <div className="overflow-hidden rounded-xl border bg-card">
            {d.projects.length ? (
              <ul className="divide-y">
                {d.projects.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{p.code}</p>
                    </div>
                    <div className="flex items-center gap-3 sm:w-72">
                      <Progress value={p.progress} className="h-1.5" />
                      <span className="tabular w-9 text-right text-xs text-muted-foreground">{p.progress}%</span>
                      <ProjectStatusBadge status={p.status} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={FolderKanban} title="No projects" description="Projects that include this department will appear here." />
            )}
          </div>
        </TabsContent>
      </Tabs>

      {d.can.edit ? <DepartmentFormDialog open={editOpen} onOpenChange={setEditOpen} department={d} onSaved={refreshAll} /> : null}
      {d.can.assignLeaders ? <TeamLeadersDialog department={d} open={leadersOpen} onOpenChange={setLeadersOpen} onDone={refreshAll} /> : null}
      {d.can.manageMembers ? (
        <>
          <AddMembersDialog department={d} open={addOpen} onOpenChange={setAddOpen} onDone={refreshAll} />
          <RemoveMemberDialog department={d} employee={removing} onOpenChange={(o) => !o && setRemoving(null)} onDone={refreshAll} />
        </>
      ) : null}
      <DeleteDepartmentDialog department={deleteOpen ? d : null} onOpenChange={setDeleteOpen} onDeleted={() => router.replace("/departments")} />
    </div>
  );
}
