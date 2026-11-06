"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlarmClock,
  ArrowLeft,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  FolderKanban,
  IdCard,
  KeyRound,
  ListTodo,
  Loader,
  Mail,
  Pencil,
  Phone,
  Power,
  UserRound,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/shared/stat-card";
import { DetailSkeleton } from "@/components/shared/skeletons";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { DepartmentChip, RoleBadge, UserStatusBadge } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { TaskList } from "@/components/shared/task-list";
import { Panel } from "@/components/dashboard/panel";
import { fetcher } from "@/lib/http";
import type { EmployeeDetailDTO } from "@/types/dto";
import { EmployeeFormDialog } from "./employee-form-dialog";
import { EmployeeStatusDialog, ResetPasswordDialog } from "./employee-actions";

function InfoRow({ icon: Icon, label, children }: { icon: typeof Mail; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="truncate text-sm font-medium">{children}</div>
      </div>
    </div>
  );
}

export function EmployeeProfile({
  employeeId,
  self = false,
  headerActions,
}: {
  employeeId?: string;
  self?: boolean;
  headerActions?: React.ReactNode;
}) {
  const key = self ? "/api/me" : `/api/employees/${employeeId}`;
  const { data: e, error, isLoading, mutate } = useSWR<EmployeeDetailDTO>(key, fetcher);
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  if (error) {
    return (
      <div className="rounded-xl border bg-card">
        <ErrorState
          title={error.status === 404 ? "Employee not found" : "Couldn't load this profile"}
          message={error.status === 404 ? "This employee doesn't exist or isn't visible to you." : error.message}
          onRetry={error.status === 404 ? undefined : () => mutate()}
        />
      </div>
    );
  }
  if (isLoading || !e) return <DetailSkeleton />;

  return (
    <div className="space-y-6">
      {!self ? (
        <Link href="/employees" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Employees
        </Link>
      ) : null}

      <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="h-20 bg-gradient-to-r from-emerald-50 via-emerald-100/60 to-sky-50" />
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="-mt-9 flex items-end gap-4">
            <UserAvatar name={e.name} src={e.avatarUrl} size="lg" className="size-18! ring-4 ring-card [&_[data-slot=avatar-fallback]]:text-lg" />
            <div className="min-w-0 pb-1">
              <h1 className="truncate text-xl font-semibold tracking-tight">{e.name}</h1>
              <p className="truncate text-sm text-muted-foreground">{e.designation || "—"}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RoleBadge role={e.role?.key} name={e.role?.name} />
            <UserStatusBadge status={e.status} />
            {e.can.edit ? (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil /> Edit
              </Button>
            ) : null}
            {e.can.resetPassword ? (
              <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
                <KeyRound /> Reset password
              </Button>
            ) : null}
            {e.can.changeStatus ? (
              <Button variant={e.status === "ACTIVE" ? "destructive" : "default"} size="sm" onClick={() => setStatusOpen(true)}>
                <Power /> {e.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
              </Button>
            ) : null}
            {headerActions}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Open tasks" value={e.stats.openTasks} icon={ListTodo} />
        <StatCard label="In progress" value={e.stats.inProgress} icon={Loader} tone="blue" />
        <StatCard label="Completed" value={e.stats.completedTasks} icon={CheckCircle2} tone="green" />
        <StatCard label="Overdue" value={e.stats.overdueTasks} icon={AlarmClock} tone="red" />
        <StatCard label="Projects" value={e.stats.projects} icon={FolderKanban} tone="violet" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Details" bodyClassName="divide-y">
          <InfoRow icon={Mail} label="Email">
            <a href={`mailto:${e.email}`} className="hover:text-primary">{e.email}</a>
          </InfoRow>
          <InfoRow icon={Phone} label="Phone">{e.phone || "—"}</InfoRow>
          <InfoRow icon={IdCard} label="Employee ID">
            <span className="font-mono">{e.employeeId}</span>
          </InfoRow>
          <InfoRow icon={Building2} label="Department">
            {e.department ? (
              <Link href={`/departments/${e.department.id}`} className="hover:text-primary">
                <DepartmentChip name={e.department.name} color={e.department.color} />
              </Link>
            ) : (
              "Not assigned"
            )}
          </InfoRow>
          <InfoRow icon={UserRound} label="Reporting manager">
            {e.reportingManager ? (
              <Link href={`/employees/${e.reportingManager.id}`} className="hover:text-primary">
                {e.reportingManager.name}
              </Link>
            ) : (
              "—"
            )}
          </InfoRow>
          <InfoRow icon={Briefcase} label="Role">{e.role?.name ?? "—"}</InfoRow>
          <InfoRow icon={CalendarDays} label="Joining date">
            {e.joiningDate ? format(new Date(e.joiningDate), "d MMMM yyyy") : "—"}
          </InfoRow>
          <InfoRow icon={Clock} label="Last sign-in">
            {e.lastLoginAt ? formatDistanceToNow(new Date(e.lastLoginAt), { addSuffix: true }) : "Never"}
          </InfoRow>
        </Panel>

        <div className="space-y-6 xl:col-span-2">
          <Panel title="Recent tasks" description="Owned or collaborating">
            <TaskList tasks={e.recentTasks} emptyTitle="No tasks yet" emptyDescription="Assigned tasks will appear here." />
          </Panel>
          <Panel title="Direct reports" description={`${e.directReports.length} ${e.directReports.length === 1 ? "person" : "people"}`}>
            {e.directReports.length ? (
              <ul className="grid divide-y sm:grid-cols-2 sm:divide-y-0">
                {e.directReports.map((r) => (
                  <li key={r.id} className="sm:border-b">
                    <Link href={`/employees/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                      <UserAvatar name={r.name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{r.designation || r.role?.name}</span>
                      </span>
                      {r.status === "INACTIVE" ? <UserStatusBadge status={r.status} /> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Users} title="No direct reports" className="py-8" />
            )}
          </Panel>
        </div>
      </div>

      {e.can.edit ? <EmployeeFormDialog open={editOpen} onOpenChange={setEditOpen} employee={e} onSaved={() => mutate()} /> : null}
      <EmployeeStatusDialog employee={statusOpen ? e : null} onOpenChange={setStatusOpen} onDone={() => mutate()} />
      {e.can.resetPassword ? <ResetPasswordDialog employee={e} open={resetOpen} onOpenChange={setResetOpen} /> : null}
    </div>
  );
}
