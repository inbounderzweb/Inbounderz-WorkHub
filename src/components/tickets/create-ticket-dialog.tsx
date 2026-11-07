"use client";

import { PriorityLabel } from "@/components/shared/labels";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Building2, Link2, Paperclip, Plus, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { FormRow } from "@/components/shared/form-row";
import { formatBytes } from "@/components/shared/attachments-panel";
import { useCurrentUser, useSettings } from "@/components/providers/user-provider";
import { todayIn } from "@/lib/settings-types";
import type { TaskPriority } from "@/lib/constants";
import { useTicketCategories, useTicketDepartments } from "@/hooks/use-ticket-options";
import { useProjectOptions } from "@/hooks/use-work-options";
import { createTicketSchema, type CreateTicketInput } from "@/lib/validations/ticket";
import { TASK_PRIORITIES } from "@/lib/constants";
import { api, ApiClientError, uploadFile } from "@/lib/http";
import { handleFormError } from "@/lib/form";

const NONE = "__none";
const MAX = 10 * 1024 * 1024;
const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

const blank = (priority: TaskPriority = "MEDIUM"): CreateTicketInput => ({
  title: "",
  description: "",
  targetDepartment: "",
  project: "",
  category: "",
  priority,
  dueDate: "",
  referenceLinks: [],
});

const plusDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export function CreateTicketDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (ticket: { id: string; ticketNumber: string }) => void;
}) {
  const user = useCurrentUser();
  const settings = useSettings();
  const defaultPriority = settings?.defaultPriority ?? "MEDIUM";
  const [dateTouched, setDateTouched] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const form = useForm<CreateTicketInput>({ resolver: zodResolver(createTicketSchema) as never, defaultValues: blank() });
  const { register, handleSubmit, control, formState, reset, setError, setValue, clearErrors } = form;
  const e = formState.errors;

  const { data: departments, isLoading: deptLoading } = useTicketDepartments(open);
  const { data: categories, isLoading: catLoading } = useTicketCategories(false, open);
  const { data: projects } = useProjectOptions(open);

  useEffect(() => {
    if (open) {
      reset(blank(defaultPriority));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
      setDateTouched(false);
      setFiles([]);
      setLinkDraft("");
    }
  }, [open, reset, defaultPriority]);

  const myDepartment = departments?.find((d) => d.id === user.departmentId);
  const links = useWatch({ control, name: "referenceLinks" }) ?? [];
  const today = settings ? todayIn(settings.company.timezone) : format(new Date(), "yyyy-MM-dd");
  /** Suggested completion date for a priority (Settings → Workflow → response days). */
  const suggestDate = (p: TaskPriority) => (settings ? plusDays(today, settings.priorities[p].responseDays) : "");
  useEffect(() => {
    // Pre-fill the suggested date once the dialog opens (until the user picks one).
    if (open && !dateTouched && settings) setValue("dueDate", suggestDate(form.getValues("priority") as TaskPriority));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings]);

  function addLink() {
    const v = linkDraft.trim();
    if (!v) return;
    if (!/^https?:\/\/\S+\.\S+/i.test(v)) {
      setError("referenceLinks", { type: "manual", message: "Enter a full link starting with https://" });
      return;
    }
    if (links.length >= 10) return;
    clearErrors("referenceLinks");
    setValue("referenceLinks", [...new Set([...links, v])]);
    setLinkDraft("");
  }

  function addFiles(list: FileList | null) {
    const next = Array.from(list ?? []).filter((f) => {
      if (f.size > MAX) toast.error(`${f.name} is larger than 10 MB`);
      return f.size <= MAX;
    });
    setFiles((cur) => [...cur, ...next].slice(0, 10));
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onSubmit(values: CreateTicketInput) {
    // Don't lose a link typed but not yet added.
    const pending = linkDraft.trim();
    const referenceLinks = pending && !links.includes(pending) ? [...links, pending] : links;
    try {
      const created = await api<{ id: string; ticketNumber: string }>("/api/tickets", {
        method: "POST",
        body: { ...values, project: values.project || null, referenceLinks },
      });
      let failed = 0;
      for (const f of files) {
        try {
          await uploadFile(`/api/tickets/${created.id}/attachments`, f);
        } catch (err) {
          failed++;
          toast.error(err instanceof ApiClientError ? `${f.name}: ${err.message}` : `${f.name} failed to upload`);
        }
      }
      toast.success(`${created.ticketNumber} raised`, {
        description: failed ? `${failed} attachment(s) failed — add them from the ticket page.` : "The Project Manager has been notified.",
      });
      onOpenChange(false);
      onCreated(created);
    } catch (err) {
      handleFormError(err, setError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Raise a ticket</DialogTitle>
          <DialogDescription>Request help from another department. A Project Manager reviews it and assigns the right person.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
          <span className="flex items-center gap-2">
            <UserRound className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Requester</span>
            <span className="truncate font-medium">{user.name}</span>
          </span>
          <span className="flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Your department</span>
            <span className="truncate font-medium">{myDepartment?.name ?? (user.departmentId ? "…" : "Not set")}</span>
          </span>
        </div>
        {!user.departmentId ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Your profile has no department, so you can&apos;t raise tickets yet. Ask an administrator to set your department.
          </p>
        ) : null}

        <form id="ticket-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Title" htmlFor="tk-title" required error={e.title?.message} className="sm:col-span-2">
            <Input id="tk-title" {...register("title")} maxLength={200} placeholder="e.g. Hero banner for the winter campaign landing page" aria-invalid={!!e.title} />
          </FormRow>

          <FormRow label="Category" htmlFor="tk-category" required error={e.category?.message}>
            <Controller control={control} name="category" render={({ field }) => (
              <Select
                value={field.value || undefined}
                onValueChange={(v) => {
                  field.onChange(v);
                  // Suggest the category's usual department if none is chosen yet.
                  const suggested = categories?.find((c) => c.id === v)?.defaultDepartment;
                  if (suggested && !form.getValues("targetDepartment") && departments?.some((d) => d.id === suggested.id)) {
                    setValue("targetDepartment", suggested.id, { shouldValidate: true });
                  }
                }}
                disabled={catLoading}
              >
                <SelectTrigger id="tk-category" className="w-full" aria-invalid={!!e.category}>
                  <SelectValue placeholder={catLoading ? "Loading…" : "What kind of help?"} />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )} />
          </FormRow>

          <FormRow label="Target department" htmlFor="tk-dept" required error={e.targetDepartment?.message} description="The department you need help from.">
            <Controller control={control} name="targetDepartment" render={({ field }) => (
              <Select value={field.value || undefined} onValueChange={field.onChange} disabled={deptLoading}>
                <SelectTrigger id="tk-dept" className="w-full" aria-invalid={!!e.targetDepartment}>
                  <SelectValue placeholder={deptLoading ? "Loading…" : "Select a department"} />
                </SelectTrigger>
                <SelectContent>
                  {departments?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                      {d.name}
                      {d.id === user.departmentId ? <span className="text-xs text-muted-foreground">(your department)</span> : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )} />
          </FormRow>

          <FormRow label="Description" htmlFor="tk-desc" required error={e.description?.message} className="sm:col-span-2" description="What you need, sizes/specs, where it will be used, and any constraints.">
            <Textarea id="tk-desc" rows={5} {...register("description")} maxLength={10000} aria-invalid={!!e.description} />
          </FormRow>

          <FormRow label="Priority" htmlFor="tk-priority" error={e.priority?.message}>
            <Controller control={control} name="priority" render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(v) => {
                  field.onChange(v);
                  if (!dateTouched) setValue("dueDate", suggestDate(v as TaskPriority), { shouldValidate: true });
                }}
              >
                <SelectTrigger id="tk-priority" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}><PriorityLabel value={p} /></SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </FormRow>

          <FormRow label="Required completion date" htmlFor="tk-due" required error={e.dueDate?.message} description={dateTouched ? undefined : "Suggested from the priority — change it if needed."}>
            <Input id="tk-due" type="date" min={today} {...register("dueDate", { onChange: () => setDateTouched(true) })} aria-invalid={!!e.dueDate} />
          </FormRow>

          <FormRow label="Related project" htmlFor="tk-project" error={e.project?.message} className="sm:col-span-2" description="Optional. Links the request to a project you're part of.">
            <Controller control={control} name="project" render={({ field }) => (
              <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                <SelectTrigger id="tk-project" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No related project</SelectItem>
                  {projects?.filter((p) => !p.isArchived).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )} />
          </FormRow>

          <FormRow label="Reference links" htmlFor="tk-link" error={e.referenceLinks?.message ?? (e.referenceLinks as unknown as Record<string, { message?: string }>)?.[0]?.message} className="sm:col-span-2">
            <div className="flex gap-2">
              <Input
                id="tk-link"
                value={linkDraft}
                onChange={(ev) => setLinkDraft(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    addLink();
                  }
                }}
                placeholder="https://drive.google.com/… or a Figma / page link"
              />
              <Button type="button" variant="outline" onClick={addLink} disabled={!linkDraft.trim() || links.length >= 10}><Plus /> Add</Button>
            </div>
            {links.length ? (
              <ul className="mt-2 space-y-1">
                {links.map((l) => (
                  <li key={l} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{l}</span>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${l}`} onClick={() => setValue("referenceLinks", links.filter((x) => x !== l))}><X /></Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </FormRow>

          <FormRow label="Attachments" htmlFor="tk-files" className="sm:col-span-2" description="Briefs, screenshots, examples · up to 10 MB each.">
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}><Paperclip /> Add files</Button>
              <input id="tk-files" ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(ev) => addFiles(ev.target.files)} />
              {files.length ? (
                <ul className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}><Trash2 /></Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </FormRow>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>Cancel</Button>
          <Button type="submit" form="ticket-form" disabled={formState.isSubmitting || !user.departmentId}>
            {formState.isSubmitting ? <Spinner /> : null}
            Raise ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
