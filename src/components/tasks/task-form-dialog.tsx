"use client";

import { PriorityLabel } from "@/components/shared/labels";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormRow } from "@/components/shared/form-row";
import { EmployeePicker, type PickerOption } from "@/components/shared/employee-picker";
import { useProjectDetail, useProjectOptions, useProjectTasks, useProjectTeam } from "@/hooks/use-work-options";
import { createTaskSchema, type CreateTaskInput } from "@/lib/validations/task";
import { APPROVAL_MODE_LABELS, APPROVAL_MODES, TASK_PRIORITIES, humanize } from "@/lib/constants";
import { api } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import { cn } from "@/lib/utils";
import type { TaskDetailDTO, TeamMemberOptionDTO } from "@/types/dto";

const NONE = "__none";

function TaskMultiPicker({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  options: { id: string; taskNumber: string; title: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const byId = new Map(options.map((o) => [o.id, o]));
  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" disabled={disabled} className={cn("h-9 w-full justify-between font-normal", !value.length && "text-muted-foreground")}>
            <span className="truncate">{value.length ? `${value.length} selected` : placeholder}</span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search tasks…" />
            <CommandList>
              <CommandEmpty>No tasks.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.id} value={`${o.taskNumber} ${o.title}`} onSelect={() => onChange(value.includes(o.id) ? value.filter((v) => v !== o.id) : [...value, o.id])}>
                    <span className="font-mono text-xs text-muted-foreground">{o.taskNumber}</span>
                    <span className="flex-1 truncate">{o.title}</span>
                    <Check className={cn(value.includes(o.id) ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full border bg-secondary py-0.5 pr-1 pl-2.5 text-xs">
              <span className="font-mono">{byId.get(id)?.taskNumber ?? "Task"}</span>
              <button type="button" className="rounded-full p-0.5 hover:bg-muted" onClick={() => onChange(value.filter((v) => v !== id))} aria-label="Remove dependency">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const toPicker = (m: TeamMemberOptionDTO): PickerOption => ({
  id: m.id,
  name: m.name,
  email: m.email,
  employeeId: m.employeeId,
  subtitle: `${m.employeeId} · ${m.designation || humanize(m.projectRole)}`,
});

function defaults(task?: TaskDetailDTO, preset?: { projectId?: string; departmentId?: string; parentId?: string }): CreateTaskInput {
  return {
    project: task?.project?.id ?? preset?.projectId ?? "",
    department: task?.department?.id ?? preset?.departmentId ?? "",
    owner: task?.owner?.id ?? "",
    collaborators: task?.collaborators.map((c) => c.id) ?? [],
    parentTask: task?.parentTask?.id ?? preset?.parentId ?? "",
    title: task?.title ?? "",
    description: task?.description ?? "",
    priority: task?.priority ?? "MEDIUM",
    status: "TODO",
    startDate: task?.startDate?.slice(0, 10) ?? "",
    dueDate: task?.dueDate?.slice(0, 10) ?? "",
    estimatedHours: task?.estimatedHours ?? null,
    milestone: task?.milestone?.id ?? "",
    dependencies: task?.dependencies.map((d) => d.id) ?? [],
    checklist: [],
    approvalRequired: task?.approvalRequired ?? true,
    approvalMode: task?.approvalMode,
  };
}

export function TaskFormDialog({
  open,
  onOpenChange,
  task,
  projectId,
  departmentId,
  parent,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit mode when provided. */
  task?: TaskDetailDTO;
  projectId?: string;
  departmentId?: string;
  parent?: { id: string; taskNumber: string; title: string };
  onSaved?: (id: string) => void;
}) {
  const isEdit = !!task;
  const [checklistText, setChecklistText] = useState("");
  const form = useForm<CreateTaskInput>({
    resolver: zodResolver(createTaskSchema) as never,
    defaultValues: defaults(task, { projectId, departmentId, parentId: parent?.id }),
  });
  const { register, handleSubmit, control, formState, reset, setError, watch, setValue } = form;
  const e = formState.errors;

  useEffect(() => {
    if (open) {
      reset(defaults(task, { projectId, departmentId, parentId: parent?.id }));
       
      setChecklistText("");
    }
  }, [open, task, projectId, departmentId, parent?.id, reset]);

  const project = watch("project");
  const department = watch("department");
  const owner = watch("owner");

  const { data: projects, isLoading: projectsLoading } = useProjectOptions(open && !isEdit);
  const { data: detail } = useProjectDetail(open && project ? project : null);
  const { data: deptTeam, isLoading: teamLoading } = useProjectTeam(open && !isEdit && project && department ? project : null, department);
  const { data: fullTeam } = useProjectTeam(open && project ? project : null);
  const { data: projectTasks } = useProjectTasks(project, open);

  const creatable = useMemo(() => (projects ?? []).filter((p) => p.taskDepartments.length > 0), [projects]);
  const selectedProject = projects?.find((p) => p.id === project);
  const departmentOptions = (selectedProject?.departments ?? detail?.departments ?? []).filter(
    (d) => (selectedProject?.taskDepartments ?? detail?.can.taskDepartments ?? []).includes(d.id)
  );
  const collaboratorOptions = (fullTeam ?? []).filter((m) => m.id !== (owner || task?.owner?.id)).map(toPicker);
  const dependencyOptions = (projectTasks?.items ?? [])
    .filter((t) => t.id !== task?.id && t.id !== parent?.id)
    .map((t) => ({ id: t.id, taskNumber: t.taskNumber, title: t.title }));

  // Default the approval mode to the project's setting.
  useEffect(() => {
    if (!isEdit && detail && !form.getValues("approvalMode")) setValue("approvalMode", detail.approvalMode);
  }, [detail, isEdit, setValue, form]);

  async function onSubmit(values: CreateTaskInput) {
    const common = {
      title: values.title,
      description: values.description,
      priority: values.priority,
      startDate: values.startDate || null,
      dueDate: values.dueDate || null,
      estimatedHours: values.estimatedHours ?? null,
      milestone: values.milestone || null,
      collaborators: values.collaborators,
      dependencies: values.dependencies,
      approvalRequired: values.approvalRequired,
      approvalMode: values.approvalMode,
    };
    try {
      if (isEdit) {
        await api(`/api/tasks/${task.id}`, { method: "PATCH", body: common });
        toast.success("Task updated");
        onSaved?.(task.id);
      } else {
        const body = {
          ...common,
          project: values.project,
          department: values.department,
          owner: values.owner,
          parentTask: values.parentTask || null,
          status: values.status,
          checklist: checklistText.split("\n").map((l) => l.trim()).filter(Boolean),
        };
        const created = await api<{ id: string; taskNumber: string }>("/api/tasks", { method: "POST", body });
        toast.success(`${created.taskNumber} created`, { description: "The assignee has been notified." });
        onSaved?.(created.id);
      }
      onOpenChange(false);
    } catch (err) {
      handleFormError(err, setError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${task.taskNumber}` : parent ? `Add subtask to ${parent.taskNumber}` : "Create task"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update task details. Use Reassign to change the owner." : "Only employees allocated to the project under the selected department can own the task."}
          </DialogDescription>
        </DialogHeader>

        <form id="task-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
          {!isEdit ? (
            <>
              <FormRow label="Project" htmlFor="t-project" required error={e.project?.message}>
                <Controller control={control} name="project" render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={(v) => {
                      field.onChange(v);
                      setValue("department", "");
                      setValue("owner", "");
                      setValue("collaborators", []);
                      setValue("dependencies", []);
                      setValue("milestone", "");
                      setValue("approvalMode", undefined);
                    }}
                    disabled={!!projectId || projectsLoading}
                  >
                    <SelectTrigger id="t-project" className="w-full" aria-invalid={!!e.project}>
                      <SelectValue placeholder={projectsLoading ? "Loading…" : "Select a project"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(projectId ? projects ?? [] : creatable).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </FormRow>
              <FormRow label="Department" htmlFor="t-dept" required error={e.department?.message} description={project ? "Only departments participating in this project." : undefined}>
                <Controller control={control} name="department" render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={(v) => {
                      field.onChange(v);
                      setValue("owner", "");
                    }}
                    disabled={!project}
                  >
                    <SelectTrigger id="t-dept" className="w-full" aria-invalid={!!e.department}>
                      <SelectValue placeholder={project ? "Select a department" : "Select a project first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {departmentOptions.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </FormRow>
              <FormRow
                label="Assignee (accountable owner)"
                htmlFor="t-owner"
                required
                error={e.owner?.message}
                className="sm:col-span-2"
                description={department && deptTeam && !deptTeam.length ? undefined : department ? "Allocated to this project under the selected department." : undefined}
              >
                <Controller control={control} name="owner" render={({ field }) => (
                  <EmployeePicker
                    id="t-owner"
                    options={(deptTeam ?? []).map(toPicker)}
                    loading={teamLoading}
                    value={field.value || null}
                    onChange={(v) => {
                      field.onChange(v ?? "");
                      setValue("collaborators", (form.getValues("collaborators") ?? []).filter((c) => c !== v));
                    }}
                    disabled={!department}
                    placeholder={department ? "Select the task owner" : "Select a department first"}
                    emptyText="No one from this department is allocated to the project. Allocate people from the project's Team tab."
                    invalid={!!e.owner}
                  />
                )} />
                {department && deptTeam && !deptTeam.length ? (
                  <p className="flex items-start gap-1.5 text-xs text-amber-700"><Info className="mt-0.5 size-3.5 shrink-0" /> Nobody from this department is allocated to the project yet.</p>
                ) : null}
              </FormRow>
            </>
          ) : null}

          {parent ? (
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm sm:col-span-2">
              Subtask of <span className="font-mono text-xs">{parent.taskNumber}</span> · {parent.title}
            </div>
          ) : null}

          <FormRow label="Title" htmlFor="t-title" required error={e.title?.message} className="sm:col-span-2">
            <Input id="t-title" placeholder="What needs to be done?" aria-invalid={!!e.title} {...register("title")} />
          </FormRow>
          <FormRow label="Description" htmlFor="t-desc" error={e.description?.message} className="sm:col-span-2">
            <Textarea id="t-desc" rows={3} placeholder="Context, acceptance criteria, links…" {...register("description")} />
          </FormRow>

          <FormRow label="Collaborators" htmlFor="t-collab" error={e.collaborators?.message} description="Optional, from the project team." className="sm:col-span-2">
            <Controller control={control} name="collaborators" render={({ field }) => (
              <EmployeePicker id="t-collab" multiple options={collaboratorOptions} value={field.value ?? []} onChange={field.onChange} disabled={!project} placeholder="Add collaborators" />
            )} />
          </FormRow>

          <FormRow label="Priority" htmlFor="t-priority">
            <Controller control={control} name="priority" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="t-priority" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}><PriorityLabel value={p} /></SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormRow>
          {!isEdit ? (
            <FormRow label="Initial status" htmlFor="t-status">
              <Controller control={control} name="status" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="t-status" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TODO">To Do</SelectItem>
                    <SelectItem value="BACKLOG">Backlog</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </FormRow>
          ) : (
            <FormRow label="Estimated hours" htmlFor="t-est" error={e.estimatedHours?.message}>
              <Input id="t-est" type="number" min={0} step="0.5" {...register("estimatedHours", { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })} />
            </FormRow>
          )}
          <FormRow label="Start date" htmlFor="t-start" error={e.startDate?.message}>
            <Input id="t-start" type="date" {...register("startDate")} />
          </FormRow>
          <FormRow label="Due date" htmlFor="t-due" error={e.dueDate?.message}>
            <Input id="t-due" type="date" aria-invalid={!!e.dueDate} {...register("dueDate")} />
          </FormRow>
          {!isEdit ? (
            <FormRow label="Estimated hours" htmlFor="t-est" error={e.estimatedHours?.message}>
              <Input id="t-est" type="number" min={0} step="0.5" {...register("estimatedHours", { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })} />
            </FormRow>
          ) : null}
          <FormRow label="Milestone" htmlFor="t-milestone" error={e.milestone?.message}>
            <Controller control={control} name="milestone" render={({ field }) => (
              <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)} disabled={!project}>
                <SelectTrigger id="t-milestone" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No milestone</SelectItem>
                  {detail?.milestones.map((m) => <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </FormRow>

          <FormRow label="Depends on" error={e.dependencies?.message} description="This task can't start until these are finished." className="sm:col-span-2">
            <Controller control={control} name="dependencies" render={({ field }) => (
              <TaskMultiPicker options={dependencyOptions} value={field.value ?? []} onChange={field.onChange} placeholder={project ? "Select prerequisite tasks (optional)" : "Select a project first"} disabled={!project} />
            )} />
          </FormRow>

          {!isEdit ? (
            <FormRow label="Checklist" htmlFor="t-checklist" description="One item per line (optional)." className="sm:col-span-2">
              <Textarea id="t-checklist" rows={3} value={checklistText} onChange={(ev) => setChecklistText(ev.target.value)} placeholder={"Design review\nImplement\nTest on mobile"} />
            </FormRow>
          ) : null}

          <div className="grid gap-3 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2">
            <Controller control={control} name="approvalRequired" render={({ field }) => (
              <label className="flex items-start gap-3">
                <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">Requires approval</span>
                  <span className="block text-xs text-muted-foreground">The owner submits for review; a reviewer approves to complete.</span>
                </span>
              </label>
            )} />
            <Controller control={control} name="approvalMode" render={({ field }) => (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Approved by</span>
                <Select value={field.value ?? detail?.approvalMode ?? "DEPARTMENT"} onValueChange={field.onChange} disabled={!watch("approvalRequired")}>
                  <SelectTrigger className="w-full" aria-label="Approver"><SelectValue /></SelectTrigger>
                  <SelectContent>{APPROVAL_MODES.map((m) => <SelectItem key={m} value={m}>{APPROVAL_MODE_LABELS[m]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )} />
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>Cancel</Button>
          <Button type="submit" form="task-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Spinner /> : null}
            {isEdit ? "Save changes" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
