"use client";

import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { EmployeePicker, type PickerOption } from "@/components/shared/employee-picker";
import { FormRow } from "@/components/shared/form-row";
import { useCurrentUser } from "@/components/providers/user-provider";
import { useTaskDepartmentOptions } from "@/hooks/use-options";
import { TASK_PRIORITIES, TICKET_CATEGORIES, humanize } from "@/lib/constants";
import { api, fetcher, qs } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import { createTicketSchema, type CreateTicketInput } from "@/lib/validations/ticket";
import { DeliverablesEditor } from "./deliverables-editor";
import type { TicketDetailDTO, TicketDTO, TicketProjectOptionDTO, TicketTaskOptionDTO } from "@/types/dto";

function defaults(t?: TicketDetailDTO): CreateTicketInput {
  return {
    title: t?.title ?? "",
    description: t?.description ?? "",
    category: t?.category ?? "Other",
    priority: t?.priority ?? "MEDIUM",
    targetDepartment: t?.targetDepartment?.id ?? "",
    additionalDepartments: t?.additionalDepartments?.map((d) => d.id) ?? [],
    dueDate: t?.dueDate?.slice(0, 10) ?? "",
    suggestedEmployee: t?.suggestedEmployee?.id ?? "",
    projectManager: t?.projectManager?.id ?? "",
    project: t?.project?.id ?? "",
    task: t?.task?.id ?? "",
    referenceLinks: t?.referenceLinks ?? [],
    deliverables: t?.deliverables?.map((d) => ({ id: d.id, type: d.type, quantity: d.quantity, specifications: d.specifications })) ?? [],
    draft: false,
  };
}

/** Raise a ticket to any active department, or edit one that hasn't been picked up yet. */
export function TicketFormDialog({
  open,
  onOpenChange,
  ticket,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ticket?: TicketDetailDTO;
  onSaved?: (t: Pick<TicketDTO, "id">) => void;
}) {
  const me = useCurrentUser();
  const isEdit = !!ticket;
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const form = useForm<CreateTicketInput>({ resolver: zodResolver(createTicketSchema) as never, defaultValues: defaults(ticket) });
  const { register, handleSubmit, control, formState, reset, setError, setValue } = form;
  const e = formState.errors;
  const [target, referenceLinks, extraDepartments, projectId] = useWatch({ control, name: ["targetDepartment", "referenceLinks", "additionalDepartments", "project"] });
  const extras = extraDepartments ?? [];
  const links = referenceLinks ?? [];

  useEffect(() => {
    if (open) {
      reset(defaults(ticket));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the draft when opening the dialog
      setLinkDraft("");
      setLinkError(null);
    }
  }, [open, ticket, reset]);

  const { data: allDepartments, isLoading: deptsLoading } = useTaskDepartmentOptions(open);
  const departments = (allDepartments ?? []).filter((d) => d.status === "ACTIVE");
  const { data: people, isLoading: peopleLoading } = useSWR<PickerOption[]>(open && target ? `/api/tickets/people${qs({ department: target })}` : null, fetcher);
  const { data: managers, isLoading: managersLoading, error: managersError } = useSWR<PickerOption[]>(open ? "/api/tickets/managers" : null, fetcher);
  const managerOptions = [...(managers ?? [])];
  if (ticket?.projectManager && !managerOptions.some((m) => m.id === ticket.projectManager!.id)) {
    managerOptions.push({ ...ticket.projectManager, employeeId: "" });
  }
  const { data: projects, isLoading: projectsLoading } = useSWR<TicketProjectOptionDTO[]>(open ? "/api/tickets/work-links" : null, fetcher);
  const { data: tasks, isLoading: tasksLoading } = useSWR<TicketTaskOptionDTO[]>(open && projectId ? `/api/tickets/work-links${qs({ project: projectId })}` : null, fetcher);
  const projectOptions = [...(projects ?? [])];
  if (ticket?.project && !projectOptions.some((p) => p.id === ticket.project!.id)) projectOptions.push(ticket.project);
  const taskOptions = [...(tasks ?? [])];
  if (ticket?.task && ticket.project?.id === projectId && !taskOptions.some((t) => t.id === ticket.task!.id)) taskOptions.push(ticket.task);
  // Once a task has been created from this ticket it stays attached.
  const workLocked = isEdit && !!ticket?.task?.autoCreated;
  const requesting = (allDepartments ?? []).find((d) => d.id === me.departmentId);
  const canChangeDept = !isEdit || ticket?.status === "DRAFT";
  const extraOptions = departments.filter((d) => d.id !== target && !extras.includes(d.id));
  const canChangeManager = !isEdit || (ticket.can.changeProjectManager ?? ticket.can.edit);

  function addLink() {
    const v = linkDraft.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) return setLinkError("Links must start with http:// or https://");
    if (links.length >= 10) return setLinkError("You can add up to 10 links");
    setValue("referenceLinks", [...links, v]);
    setLinkDraft("");
    setLinkError(null);
  }

  async function save(values: CreateTicketInput, draft: boolean) {
    const body = { ...values, additionalDepartments: values.additionalDepartments ?? [], draft, projectManager: values.projectManager || null, suggestedEmployee: values.suggestedEmployee || null, dueDate: values.dueDate || null, project: values.project || null, task: values.task || null };
    try {
      if (isEdit) {
        const { draft: _d, ...rest } = body;
        void _d;
        await api(`/api/tickets/${ticket.id}`, { method: "PATCH", body: canChangeDept ? rest : { ...rest, targetDepartment: undefined } });
        if (ticket.status === "DRAFT" && !draft) await api(`/api/tickets/${ticket.id}/actions`, { method: "POST", body: { action: "submit" } });
        toast.success(draft || ticket.status !== "DRAFT" ? "Ticket updated" : "Ticket submitted for approval");
        onSaved?.({ id: ticket.id });
      } else {
        const created = await api<TicketDTO>("/api/tickets", { method: "POST", body });
        toast.success(draft ? "Draft saved" : `${created.ticketNumber} sent for approval`, {
          description: draft ? undefined : created.projectManager ? `${created.projectManager.name} will review it before anyone is assigned.` : "The target department's Project Managers will review it before anyone is assigned.",
        });
        onSaved?.(created);
      }
      onOpenChange(false);
    } catch (err) {
      handleFormError(err, setError);
    }
  }

  const isDraft = !isEdit || ticket?.status === "DRAFT";

  return (
    <Dialog open={open} onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${ticket.ticketNumber}` : "Raise a ticket"}</DialogTitle>
          <DialogDescription>
            Ask your own department or another department for help. Choose a Project Manager to review the ticket and decide who works on it.
          </DialogDescription>
        </DialogHeader>
        <form id="ticket-form" onSubmit={handleSubmit((v) => save(v, false))} noValidate className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Title" htmlFor="tk-title" required error={e.title?.message} className="sm:col-span-2">
            <Input id="tk-title" placeholder="e.g. Banner design for the Eid campaign" aria-invalid={!!e.title} {...register("title")} />
          </FormRow>
          <FormRow label="Project (optional)" htmlFor="tk-project" error={e.project?.message}
            description={workLocked ? "A task was already created from this ticket." : "Pick the project this work is for."}>
            <Controller control={control} name="project" render={({ field }) => (
              <Select
                value={field.value || "__none"}
                onValueChange={(v) => { field.onChange(v === "__none" ? "" : v); setValue("task", ""); }}
                disabled={workLocked || projectsLoading}
              >
                <SelectTrigger id="tk-project" className="w-full" aria-invalid={!!e.project}>
                  <SelectValue placeholder={projectsLoading ? "Loading projects…" : "No project"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No project</SelectItem>
                  {projectOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </FormRow>
          <FormRow label="Task" htmlFor="tk-task" error={e.task?.message}
            description={projectId ? "Leave on “Create a task from this ticket” if no task exists yet." : "Choose a project first."}>
            <Controller control={control} name="task" render={({ field }) => (
              <Select value={field.value || "__new"} onValueChange={(v) => field.onChange(v === "__new" ? "" : v)} disabled={workLocked || !projectId || tasksLoading}>
                <SelectTrigger id="tk-task" className="w-full" aria-invalid={!!e.task}>
                  <SelectValue placeholder={!projectId ? "—" : tasksLoading ? "Loading tasks…" : "Create a task from this ticket"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__new">{workLocked && ticket?.task ? `${ticket.task.taskNumber} · ${ticket.task.title}` : "Create a task from this ticket"}</SelectItem>
                  {taskOptions.map((t) => <SelectItem key={t.id} value={t.id}>{t.taskNumber} · {t.title}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </FormRow>
          <FormRow label="Requesting department" htmlFor="tk-from" description="Filled in from your profile.">
            <Input id="tk-from" value={requesting?.name ?? (me.departmentId ? "…" : "—")} disabled />
          </FormRow>
          <FormRow label="Target department" htmlFor="tk-to" required error={e.targetDepartment?.message}>
            <Controller control={control} name="targetDepartment" render={({ field }) => (
              <Select
                value={field.value || undefined}
                onValueChange={(v) => { field.onChange(v); setValue("suggestedEmployee", ""); setValue("additionalDepartments", extras.filter((x) => x !== v)); }}
                disabled={!canChangeDept || deptsLoading}
              >
                <SelectTrigger id="tk-to" className="w-full" aria-invalid={!!e.targetDepartment}>
                  <SelectValue placeholder={deptsLoading ? "Loading…" : "Select the department"} />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )} />
          </FormRow>
          <FormRow label="Also involve other departments (optional)" htmlFor="tk-extra" error={e.additionalDepartments?.message as string | undefined}
            description="e.g. add Graphic Design if they need to work on this too. Their head is notified, and their people can be assigned." className="sm:col-span-2">
            <div className="space-y-2">
              <Select value="" onValueChange={(v) => setValue("additionalDepartments", [...extras, v])} disabled={deptsLoading || !target || extras.length >= 5 || !extraOptions.length}>
                <SelectTrigger id="tk-extra" className="w-full">
                  <SelectValue placeholder={!target ? "Pick the target department first" : extraOptions.length ? "Add a department" : "No other departments"} />
                </SelectTrigger>
                <SelectContent>
                  {extraOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {extras.length ? (
                <div className="flex flex-wrap gap-2">
                  {extras.map((id) => {
                    const d = (allDepartments ?? []).find((x) => x.id === id) ?? ticket?.additionalDepartments?.find((x) => x.id === id);
                    return (
                      <span key={id} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-sm">
                        <span className="size-2 rounded-full" style={{ backgroundColor: d?.color ?? "#999" }} />
                        {d?.name ?? "Department"}
                        <Button type="button" variant="ghost" size="icon-xs" className="size-5 rounded-full" aria-label={`Remove ${d?.name ?? "department"}`} onClick={() => setValue("additionalDepartments", extras.filter((x) => x !== id))}><X /></Button>
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </FormRow>
          <FormRow label="Project Manager (optional)" htmlFor="tk-manager" error={e.projectManager?.message ?? managersError?.message}
            description={canChangeManager ? "Select a Project Manager by name. Changing the manager sends this ticket for approval again." : "This ticket is no longer editable."} className="sm:col-span-2">
            <Controller control={control} name="projectManager" render={({ field }) => (
              <Select value={field.value || "__automatic"} onValueChange={(value) => field.onChange(value === "__automatic" ? "" : value)} disabled={!canChangeManager || managersLoading}>
                <SelectTrigger id="tk-manager" className="w-full" aria-invalid={!!e.projectManager}>
                  <SelectValue placeholder={managersLoading ? "Loading Project Managers…" : "Select a Project Manager"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__automatic">Automatic department routing</SelectItem>
                  {managerOptions.map((manager) => <SelectItem key={manager.id} value={manager.id} disabled={manager.id === me.id}>{manager.name}{manager.id === me.id ? " (you — choose another reviewer)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            {!managersLoading && !managersError ? <p className="mt-1 text-xs text-muted-foreground">{managerOptions.length ? `Available Project Managers: ${managerOptions.map((manager) => manager.name).join(", ")}` : "No active Project Managers are available."}</p> : null}
          </FormRow>
          <FormRow label="Description" htmlFor="tk-desc" required error={e.description?.message} className="sm:col-span-2">
            <Textarea id="tk-desc" rows={5} placeholder="What do you need, sizes / formats, where it will be used, anything the team should know" aria-invalid={!!e.description} {...register("description")} />
          </FormRow>
          <FormRow
            label="Deliverables / required work items (optional)"
            htmlFor="tk-deliverables"
            description="What should come out of this ticket, and how many of each. The Project Manager reviews these before approving."
            className="sm:col-span-2"
          >
            <div id="tk-deliverables">
              <Controller control={control} name="deliverables" render={({ field }) => (
                <DeliverablesEditor
                  value={field.value ?? []}
                  onChange={field.onChange}
                  errorFor={(i, f) => e.deliverables?.[i]?.[f]?.message}
                  rootError={e.deliverables?.message ?? e.deliverables?.root?.message}
                />
              )} />
            </div>
          </FormRow>
          <FormRow label="Category" htmlFor="tk-cat">
            <Controller control={control} name="category" render={({ field }) => (
              <Select value={field.value ?? "Other"} onValueChange={field.onChange}>
                <SelectTrigger id="tk-cat" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{TICKET_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormRow>
          <FormRow label="Priority" htmlFor="tk-prio">
            <Controller control={control} name="priority" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="tk-prio" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{humanize(p)}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormRow>
          <FormRow label="Due date (optional)" htmlFor="tk-due" error={e.dueDate?.message}>
            <Input id="tk-due" type="date" {...register("dueDate")} />
          </FormRow>
          <FormRow
            label="Suggested employee (optional)"
            htmlFor="tk-suggest"
            description="Only a hint for the Project Manager. Nobody is assigned or notified because of it."
            error={e.suggestedEmployee?.message}
          >
            <Controller control={control} name="suggestedEmployee" render={({ field }) => (
              <EmployeePicker id="tk-suggest" options={people} loading={peopleLoading} value={field.value || null} onChange={(v) => field.onChange(v ?? "")} allowClear disabled={!target} placeholder={target ? "No preference" : "Pick a department first"} emptyText="No employees found." />
            )} />
          </FormRow>
          <FormRow label="Reference links (optional)" htmlFor="tk-link" error={linkError ?? undefined} className="sm:col-span-2" description="You can attach files after the ticket is created.">
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input id="tk-link" value={linkDraft} onChange={(ev) => setLinkDraft(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); addLink(); } }} placeholder="https://…" />
                <Button type="button" variant="outline" onClick={addLink}><Plus /> Add</Button>
              </div>
              {links.length ? (
                <ul className="space-y-1">
                  {links.map((l, i) => (
                    <li key={`${l}-${i}`} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm">
                      <span className="truncate">{l}</span>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${l}`} onClick={() => setValue("referenceLinks", links.filter((_, j) => j !== i))}><X /></Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </FormRow>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>Cancel</Button>
          {isDraft ? (
            <Button variant="outline" type="button" disabled={formState.isSubmitting} onClick={handleSubmit((v) => save(v, true))}>
              Save as draft
            </Button>
          ) : null}
          <Button type="submit" form="ticket-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Spinner /> : null}
            {isEdit && !isDraft ? "Save changes" : "Submit for approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
