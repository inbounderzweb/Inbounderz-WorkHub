"use client";

import { PriorityLabel } from "@/components/shared/labels";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { FormRow } from "@/components/shared/form-row";
import { EmployeePicker } from "@/components/shared/employee-picker";
import { EmptyState } from "@/components/shared/states";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useCurrentUser } from "@/components/providers/user-provider";
import { useDepartmentOptions, useEmployeeOptions } from "@/hooks/use-options";
import { createProjectSchema, type CreateProjectInput } from "@/lib/validations/project";
import { APPROVAL_MODE_LABELS, APPROVAL_MODES, PROJECT_STATUSES, TASK_PRIORITIES, humanize } from "@/lib/constants";
import { api, fetcher, qs } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import { cn } from "@/lib/utils";
import type { EmployeeOptionDTO, ProjectDetailDTO, ProjectDTO } from "@/types/dto";

type Member = { user: string; department: string; projectRole: "LEAD" | "MEMBER" | "REVIEWER" | "OBSERVER" };

const STEPS = ["Details", "Departments & team", "Review"] as const;

function defaults(p?: ProjectDTO & Partial<Pick<ProjectDetailDTO, "notes">>, managerId?: string): CreateProjectInput {
  return {
    name: p?.name ?? "",
    client: p?.client ?? "",
    description: p?.description ?? "",
    notes: p?.notes ?? "",
    manager: p?.manager?.id ?? managerId ?? "",
    startDate: p?.startDate?.slice(0, 10) ?? "",
    endDate: p?.endDate?.slice(0, 10) ?? "",
    priority: p?.priority ?? "MEDIUM",
    status: p?.status ?? "PLANNING",
    budget: p?.budget ?? null,
    approvalMode: p?.approvalMode ?? "DEPARTMENT",
    departments: p?.departments.map((d) => d.id) ?? [],
    members: [],
  };
}

/** Lists a department's active employees for allocation. */
function DepartmentAllocation({
  department,
  members,
  onToggle,
  onRole,
  filter,
  excludeIds,
}: {
  department: { id: string; name: string; color: string };
  members: Member[];
  onToggle: (e: EmployeeOptionDTO) => void;
  onRole: (userId: string, role: Member["projectRole"]) => void;
  filter: string;
  excludeIds: string[];
}) {
  const { data, isLoading } = useSWR<EmployeeOptionDTO[]>(
    `/api/employees${qs({ minimal: 1, department: department.id, status: "ACTIVE" })}`,
    fetcher
  );
  const rows = (data ?? []).filter(
    (e) => !excludeIds.includes(e.id) && (!filter || `${e.name} ${e.email} ${e.employeeId}`.toLowerCase().includes(filter.toLowerCase()))
  );
  const selectedHere = members.filter((m) => m.department === department.id).length;

  return (
    <section className="overflow-hidden rounded-lg border">
      <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="size-2 rounded-full" style={{ backgroundColor: department.color }} />
          {department.name}
        </span>
        <span className="text-xs text-muted-foreground">{selectedHere} selected</span>
      </header>
      {isLoading ? (
        <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
          <Spinner /> Loading employees…
        </div>
      ) : !rows.length ? (
        <p className="p-3 text-sm text-muted-foreground">{filter ? "No matches." : "No active employees in this department."}</p>
      ) : (
        <ul className="divide-y">
          {rows.map((e) => {
            const m = members.find((x) => x.user === e.id);
            return (
              <li key={e.id} className={cn("flex items-center gap-3 px-3 py-2", m && "bg-accent/40")}>
                <Checkbox id={`m-${department.id}-${e.id}`} checked={!!m} onCheckedChange={() => onToggle(e)} aria-label={`Allocate ${e.name}`} />
                <label htmlFor={`m-${department.id}-${e.id}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <UserAvatar name={e.name} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{e.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{e.employeeId} · {humanize(e.role ?? "EMPLOYEE")}</span>
                  </span>
                </label>
                {m ? (
                  <Select value={m.projectRole} onValueChange={(v) => onRole(e.id, v as Member["projectRole"])}>
                    <SelectTrigger size="sm" className="w-28" aria-label={`Project role for ${e.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MEMBER">Member</SelectItem>
                      <SelectItem value="LEAD">Lead</SelectItem>
                      <SelectItem value="REVIEWER">Reviewer</SelectItem>
                      <SelectItem value="OBSERVER">Observer</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: ProjectDetailDTO;
  onSaved?: (p: ProjectDTO) => void;
}) {
  const me = useCurrentUser();
  const isEdit = !!project;
  const [step, setStep] = useState(0);
  const [filter, setFilter] = useState("");

  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema) as never,
    defaultValues: defaults(project, me.role === "PROJECT_MANAGER" ? me.id : ""),
  });
  const { register, handleSubmit, control, formState, reset, setError, watch, setValue, trigger, getValues } = form;
  const e = formState.errors;

  useEffect(() => {
    if (open) {
      reset(defaults(project, me.role === "PROJECT_MANAGER" ? me.id : ""));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset wizard state on open
      setStep(0);
      setFilter("");
    }
  }, [open, project, reset, me.role, me.id]);

  const { data: departments } = useDepartmentOptions(open);
  const { data: pms } = useEmployeeOptions({ role: "PROJECT_MANAGER", status: "ACTIVE" }, open && me.role === "SUPER_ADMIN");
  const selectedDepts = watch("departments") ?? [];
  const members = (watch("members") ?? []) as Member[];
  const managerId = watch("manager");
  const activeDepts = useMemo(() => (departments ?? []).filter((d) => d.status === "ACTIVE"), [departments]);

  function toggleDept(id: string) {
    const next = selectedDepts.includes(id) ? selectedDepts.filter((d) => d !== id) : [...selectedDepts, id];
    setValue("departments", next, { shouldValidate: formState.isSubmitted });
    if (!next.includes(id)) setValue("members", members.filter((m) => m.department !== id));
  }
  function toggleMember(emp: EmployeeOptionDTO) {
    const exists = members.some((m) => m.user === emp.id);
    setValue(
      "members",
      exists ? members.filter((m) => m.user !== emp.id) : [...members, { user: emp.id, department: emp.departmentId!, projectRole: "MEMBER" }]
    );
  }
  function setRole(userId: string, role: Member["projectRole"]) {
    setValue("members", members.map((m) => (m.user === userId ? { ...m, projectRole: role } : m)));
  }

  async function next() {
    if (step === 0) {
      const fields = ["name", "client", "description", "startDate", "endDate", "priority", "status", "budget", "approvalMode", "manager"] as const;
      if (!(await trigger(fields))) return;
      if (me.role === "SUPER_ADMIN" && !getValues("manager")) {
        setError("manager", { message: "Select a project manager" });
        return;
      }
    }
    if (step === 1 && !(await trigger("departments"))) return;
    setStep((s) => s + 1);
  }

  async function onSubmit(values: CreateProjectInput) {
    try {
      const body = { ...values, manager: values.manager || null, startDate: values.startDate || null, endDate: values.endDate || null };
      let saved: ProjectDTO;
      if (isEdit) {
        const { members: _m, departments: _d, ...rest } = body;
        void _m;
        void _d;
        saved = await api<ProjectDTO>(`/api/projects/${project.id}`, { method: "PATCH", body: rest });
        toast.success("Project updated");
      } else {
        saved = await api<ProjectDTO>("/api/projects", { method: "POST", body });
        toast.success(`${saved.name} created`, { description: `Project ID ${saved.code}` });
      }
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      handleFormError(err, setError);
      if (!isEdit && step !== 0 && Object.keys(form.formState.errors).some((k) => !["departments", "members"].includes(k))) setStep(0);
    }
  }

  const managerName =
    me.role === "PROJECT_MANAGER" ? me.name : pms?.find((p) => p.id === managerId)?.name ?? project?.manager?.name ?? "—";

  const details = (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormRow label="Project name" htmlFor="p-name" required error={e.name?.message} className="sm:col-span-2">
        <Input id="p-name" placeholder="e.g. Acme website redesign" aria-invalid={!!e.name} {...register("name")} />
      </FormRow>
      <FormRow label="Client" htmlFor="p-client" error={e.client?.message}>
        <Input id="p-client" placeholder="Client or internal" {...register("client")} />
      </FormRow>
      {me.role === "SUPER_ADMIN" ? (
        <FormRow label="Project manager" htmlFor="p-manager" required error={e.manager?.message}>
          <Controller
            control={control}
            name="manager"
            render={({ field }) => (
              <EmployeePicker id="p-manager" options={pms} value={field.value || null} onChange={(v) => field.onChange(v ?? "")} placeholder="Select a project manager" invalid={!!e.manager} />
            )}
          />
        </FormRow>
      ) : (
        <FormRow label="Project manager" description={me.role === "PROJECT_MANAGER" ? "You manage the projects you create." : undefined}>
          <Input value={managerName} disabled />
        </FormRow>
      )}
      <FormRow label="Description" htmlFor="p-desc" error={e.description?.message} className="sm:col-span-2">
        <Textarea id="p-desc" rows={3} placeholder="Goals, scope and deliverables" {...register("description")} />
      </FormRow>
      <FormRow label="Start date" htmlFor="p-start" error={e.startDate?.message}>
        <Input id="p-start" type="date" {...register("startDate")} />
      </FormRow>
      <FormRow label="Deadline" htmlFor="p-end" error={e.endDate?.message}>
        <Input id="p-end" type="date" aria-invalid={!!e.endDate} {...register("endDate")} />
      </FormRow>
      <FormRow label="Priority" htmlFor="p-priority">
        <Controller control={control} name="priority" render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger id="p-priority" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}><PriorityLabel value={p} /></SelectItem>)}</SelectContent>
          </Select>
        )} />
      </FormRow>
      <FormRow label="Status" htmlFor="p-status">
        <Controller control={control} name="status" render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger id="p-status" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{PROJECT_STATUSES.map((p) => <SelectItem key={p} value={p}>{humanize(p)}</SelectItem>)}</SelectContent>
          </Select>
        )} />
      </FormRow>
      <FormRow label="Budget (optional)" htmlFor="p-budget" error={e.budget?.message}>
        <Input id="p-budget" type="number" min={0} step="0.01" placeholder="0.00" {...register("budget", { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })} />
      </FormRow>
      <FormRow label="Task approval" htmlFor="p-approval" description="Default reviewer for tasks; can be changed per task.">
        <Controller control={control} name="approvalMode" render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger id="p-approval" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{APPROVAL_MODES.map((m) => <SelectItem key={m} value={m}>{APPROVAL_MODE_LABELS[m]}</SelectItem>)}</SelectContent>
          </Select>
        )} />
      </FormRow>
      <FormRow label="Notes" htmlFor="p-notes" error={e.notes?.message} className="sm:col-span-2">
        <Textarea id="p-notes" rows={2} placeholder="Internal notes" {...register("notes")} />
      </FormRow>
    </div>
  );

  const team = (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium">1. Select participating departments</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {activeDepts.map((d) => {
            const on = selectedDepts.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggleDept(d.id)}
                aria-pressed={on}
                className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50", on && "border-primary bg-accent/50")}
              >
                <span className={cn("flex size-4 items-center justify-center rounded border", on && "border-primary bg-primary text-primary-foreground")}>
                  {on ? <Check className="size-3" /> : null}
                </span>
                <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="flex-1 truncate font-medium">{d.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{d.code}</span>
              </button>
            );
          })}
        </div>
        {e.departments?.message ? <p className="mt-1 text-xs text-destructive">{e.departments.message}</p> : null}
      </div>
      <div>
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">2. Allocate employees from those departments <span className="font-normal text-muted-foreground">({members.length} selected)</span></p>
          {selectedDepts.length ? (
            <div className="relative sm:w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={(ev) => setFilter(ev.target.value)} placeholder="Filter people…" className="h-8 pl-7 text-sm" />
            </div>
          ) : null}
        </div>
        {!selectedDepts.length ? (
          <div className="rounded-lg border border-dashed">
            <EmptyState icon={Users} title="Select a department first" description="Employees load per department. Only the people you tick are added to the project." className="py-8" />
          </div>
        ) : (
          <div className="space-y-3">
            {activeDepts.filter((d) => selectedDepts.includes(d.id)).map((d) => (
              <DepartmentAllocation key={d.id} department={d} members={members} onToggle={toggleMember} onRole={setRole} filter={filter} excludeIds={managerId ? [managerId] : []} />
            ))}
          </div>
        )}
        {e.members?.message ? <p className="mt-1 text-xs text-destructive">{e.members.message}</p> : null}
      </div>
    </div>
  );

  const values = watch();
  const review = (
    <div className="space-y-4 text-sm">
      <dl className="grid gap-x-6 gap-y-3 rounded-lg border p-4 sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Project</dt><dd className="font-medium">{values.name}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Client</dt><dd>{values.client || "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Manager</dt><dd>{managerName}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Dates</dt><dd>{values.startDate || "—"} → {values.endDate || "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Priority / status</dt><dd>{humanize(values.priority ?? "MEDIUM")} · {humanize(values.status ?? "PLANNING")}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Task approval</dt><dd>{APPROVAL_MODE_LABELS[values.approvalMode ?? "DEPARTMENT"]}</dd></div>
      </dl>
      <div className="space-y-2">
        {activeDepts.filter((d) => selectedDepts.includes(d.id)).map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
            <span className="flex items-center gap-2 font-medium"><span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />{d.name}</span>
            <span className="text-muted-foreground">{members.filter((m) => m.department === d.id).length} employee(s)</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">The project manager is added to the team automatically. You can allocate more people later from the Team tab.</p>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${project.name}` : "Create project"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update project details. Manage departments and people from the Team tab." : "Set up the project, choose departments and allocate specific employees."}
          </DialogDescription>
        </DialogHeader>
        {!isEdit ? (
          <ol className="flex items-center gap-2 text-xs">
            {STEPS.map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                <span className={cn("flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold", i < step && "border-primary bg-primary text-primary-foreground", i === step && "border-primary text-primary")}>
                  {i < step ? <Check className="size-3" /> : i + 1}
                </span>
                <span className={cn("hidden sm:inline", i === step ? "font-medium" : "text-muted-foreground")}>{label}</span>
                {i < STEPS.length - 1 ? <span className="h-px w-6 bg-border" /> : null}
              </li>
            ))}
          </ol>
        ) : null}
        <form id="project-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          {isEdit ? details : step === 0 ? details : step === 1 ? team : review}
        </form>
        <DialogFooter>
          {!isEdit && step > 0 ? (
            <Button key="back" type="button" variant="outline" onClick={() => setStep((s) => s - 1)} disabled={formState.isSubmitting} className="sm:mr-auto">
              <ArrowLeft /> Back
            </Button>
          ) : (
            <Button key="cancel" type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>Cancel</Button>
          )}
          {/* Distinct keys: React must not reuse the "Next" <button> as the submit button,
              or the click that advances to the last step would also submit the form. */}
          {!isEdit && step < 2 ? (
            <Button key="next" type="button" onClick={next}>Next <ArrowRight /></Button>
          ) : (
            <Button key="submit" type="submit" form="project-form" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? <Spinner /> : null}
              {isEdit ? "Save changes" : "Create project"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
