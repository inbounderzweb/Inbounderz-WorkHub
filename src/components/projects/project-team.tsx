"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { toast } from "sonner";
import { Building2, ChevronDown, UserMinus, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/states";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useDepartmentOptions } from "@/hooks/use-options";
import { api, ApiClientError, fetcher, qs } from "@/lib/http";
import { humanize } from "@/lib/constants";
import { handleFormError } from "@/lib/form";
import { cn } from "@/lib/utils";
import type { EmployeeOptionDTO, ProjectDetailDTO, ProjectMemberDTO } from "@/types/dto";

type Role = "LEAD" | "MEMBER" | "REVIEWER" | "OBSERVER";

function AllocateDialog({ project, open, onOpenChange, onDone }: { project: ProjectDetailDTO; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [department, setDepartment] = useState(project.departments[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [role, setRole] = useState<Role>("MEMBER");
  const [pending, setPending] = useState(false);
  const { data, isLoading } = useSWR<EmployeeOptionDTO[]>(
    open && department ? `/api/employees${qs({ minimal: 1, department, status: "ACTIVE" })}` : null,
    fetcher
  );
  const active = new Set(project.members.map((m) => m.user.id));
  const candidates = (data ?? []).filter((e) => !active.has(e.id));

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
      setSelected([]);
      setRole("MEMBER");
    }
  }, [open]);

  async function submit() {
    setPending(true);
    try {
      const res = await api<{ added: number }>(`/api/projects/${project.id}/members`, {
        method: "POST",
        body: { add: selected.map((user) => ({ user, department, projectRole: role })) },
      });
      toast.success(`${res.added} employee${res.added === 1 ? "" : "s"} allocated`);
      onDone();
      onOpenChange(false);
    } catch (err) {
      handleFormError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Allocate employees</DialogTitle>
          <DialogDescription>Choose a participating department, then the specific people to add to this project.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Select value={department} onValueChange={(v) => { setDepartment(v); setSelected([]); }}>
            <SelectTrigger className="flex-1" aria-label="Department"><SelectValue placeholder="Department" /></SelectTrigger>
            <SelectContent>{project.departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger className="w-32" aria-label="Project role"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["MEMBER", "LEAD", "REVIEWER", "OBSERVER"] as Role[]).map((r) => <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-lg border scrollbar-thin">
          {isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Spinner /> Loading…</div>
          ) : !candidates.length ? (
            <p className="p-4 text-sm text-muted-foreground">Everyone in this department is already on the project, or it has no active employees.</p>
          ) : (
            <ul className="divide-y">
              {candidates.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox id={`al-${e.id}`} checked={selected.includes(e.id)} onCheckedChange={() => setSelected((s) => (s.includes(e.id) ? s.filter((x) => x !== e.id) : [...s, e.id]))} />
                  <label htmlFor={`al-${e.id}`} className="flex flex-1 cursor-pointer items-center gap-2">
                    <UserAvatar name={e.name} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{e.name}</span>
                      <span className="block text-xs text-muted-foreground">{e.employeeId} · {humanize(e.role ?? "EMPLOYEE")}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !selected.length}>{pending ? <Spinner /> : null} Allocate {selected.length || ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentsDialog({ project, open, onOpenChange, onDone }: { project: ProjectDetailDTO; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { data: departments } = useDepartmentOptions(open);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync on open
    if (open) setSelected(project.departments.map((d) => d.id));
  }, [open, project.departments]);
  const removed = project.departments.filter((d) => !selected.includes(d.id));

  async function submit() {
    setPending(true);
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", body: { departments: selected } });
      toast.success("Departments updated");
      onDone();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Couldn't update departments");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Participating departments</DialogTitle>
          <DialogDescription>A department with open tasks in this project can’t be removed.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 space-y-1 overflow-y-auto scrollbar-thin">
          {(departments ?? []).filter((d) => d.status === "ACTIVE" || selected.includes(d.id)).map((d) => (
            <li key={d.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
                <Checkbox checked={selected.includes(d.id)} onCheckedChange={() => setSelected((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id]))} />
                <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="flex-1 text-sm">{d.name}</span>
              </label>
            </li>
          ))}
        </ul>
        {removed.length ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Removing {removed.map((d) => d.name).join(", ")} also ends the project allocation of its members. Their task history is kept.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !selected.length}>{pending ? <Spinner /> : null} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectTeam({ project, onChanged }: { project: ProjectDetailDTO; onChanged: () => void }) {
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [removing, setRemoving] = useState<ProjectMemberDTO | null>(null);
  const [showFormer, setShowFormer] = useState(false);
  const canManage = project.can.manageTeam;

  const managers = project.members.filter((m) => m.projectRole === "MANAGER");
  const groups = project.departments.map((d) => ({ dept: d, members: project.members.filter((m) => m.projectRole !== "MANAGER" && m.department?.id === d.id) }));

  async function changeRole(m: ProjectMemberDTO, role: Role) {
    try {
      await api(`/api/projects/${project.id}/members`, { method: "POST", body: { update: [{ user: m.user.id, projectRole: role }] } });
      toast.success(`${m.user.name} is now ${humanize(role)}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Couldn't update the role");
    }
  }

  const memberRow = (m: ProjectMemberDTO) => (
    <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
      <UserAvatar name={m.user.name} size="sm" />
      <Link href={`/employees/${m.user.id}`} className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium hover:text-primary">{m.user.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {m.user.designation || m.user.email} · joined {format(new Date(m.joinedAt), "d MMM yyyy")}
          {m.openTasks ? ` · ${m.openTasks} open task${m.openTasks === 1 ? "" : "s"}` : ""}
        </span>
      </Link>
      {canManage && m.projectRole !== "MANAGER" ? (
        <>
          <Select value={m.projectRole} onValueChange={(v) => changeRole(m, v as Role)}>
            <SelectTrigger size="sm" className="w-28" aria-label={`Role for ${m.user.name}`}><SelectValue /></SelectTrigger>
            <SelectContent>{(["MEMBER", "LEAD", "REVIEWER", "OBSERVER"] as Role[]).map((r) => <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.user.name}`} onClick={() => setRemoving(m)}><UserMinus /></Button>
        </>
      ) : (
        <span className="rounded-full border px-2 py-0.5 text-xs">{humanize(m.projectRole)}</span>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setDeptOpen(true)}><Building2 /> Departments</Button>
          <Button size="sm" onClick={() => setAllocateOpen(true)} disabled={!project.departments.length}><UserPlus /> Allocate employees</Button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b px-4 py-2.5 text-sm font-semibold">Project management</header>
        <ul className="divide-y">{managers.map(memberRow)}</ul>
      </section>

      {groups.map(({ dept, members }) => (
        <section key={dept.id} className="overflow-hidden rounded-xl border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold"><span className="size-2 rounded-full" style={{ backgroundColor: dept.color }} />{dept.name}</span>
            <span className="text-xs text-muted-foreground">{members.length} member{members.length === 1 ? "" : "s"}</span>
          </header>
          {members.length ? <ul className="divide-y">{members.map(memberRow)}</ul> : <EmptyState icon={Users} title="No one allocated from this department" className="py-6" />}
        </section>
      ))}

      {project.formerMembers.length ? (
        <section className="overflow-hidden rounded-xl border bg-card">
          <button type="button" className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold" onClick={() => setShowFormer((v) => !v)} aria-expanded={showFormer}>
            Former members ({project.formerMembers.length})
            <ChevronDown className={cn("size-4 transition-transform", showFormer && "rotate-180")} />
          </button>
          {showFormer ? (
            <ul className="divide-y border-t">
              {project.formerMembers.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 opacity-75">
                  <UserAvatar name={m.user.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{m.user.name}</span>
                    <span className="block text-xs text-muted-foreground">{m.department?.name ?? "—"} · left {m.leftAt ? format(new Date(m.leftAt), "d MMM yyyy") : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <AllocateDialog project={project} open={allocateOpen} onOpenChange={setAllocateOpen} onDone={onChanged} />
      <DepartmentsDialog project={project} open={deptOpen} onOpenChange={setDeptOpen} onDone={onChanged} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.user.name} from the project?`}
        description={
          <>
            They lose access to this project and can’t be assigned new tasks. Their tasks, comments and history are kept.
            {removing?.openTasks ? <> They still own <strong>{removing.openTasks} open task(s)</strong>, which you should reassign.</> : null}
          </>
        }
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await api(`/api/projects/${project.id}/members`, { method: "POST", body: { remove: [removing.user.id] } });
            toast.success(`${removing.user.name} removed from the project`);
            onChanged();
          } catch (err) {
            toast.error(err instanceof ApiClientError ? err.message : "Couldn't remove the member");
            return false;
          }
        }}
      />
    </div>
  );
}
