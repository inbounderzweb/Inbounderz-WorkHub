"use client";

import { day } from "@/lib/dates";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, isPast } from "date-fns";
import { toast } from "sonner";
import { Flag, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/states";
import { FormRow } from "@/components/shared/form-row";
import { createMilestoneSchema, type CreateMilestoneInput } from "@/lib/validations/project";
import { MILESTONE_STATUSES, humanize, type MilestoneStatus } from "@/lib/constants";
import { api, ApiClientError } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import { cn } from "@/lib/utils";
import type { MilestoneDTO } from "@/types/dto";

const STATUS_STYLE: Record<MilestoneStatus, string> = {
  PENDING: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-sky-100 text-sky-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  MISSED: "bg-red-100 text-red-700",
};

function MilestoneDialog({ projectId, milestone, open, onOpenChange, onDone }: { projectId: string; milestone?: MilestoneDTO; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { register, handleSubmit, reset, formState, setError } = useForm<CreateMilestoneInput>({ resolver: zodResolver(createMilestoneSchema) as never });
  useEffect(() => {
    if (open) reset({ title: milestone?.title ?? "", description: milestone?.description ?? "", dueDate: milestone?.dueDate?.slice(0, 10) ?? "", status: milestone?.status ?? "PENDING" });
  }, [open, milestone, reset]);

  async function onSubmit(v: CreateMilestoneInput) {
    const body = { ...v, dueDate: v.dueDate || null };
    try {
      if (milestone) await api(`/api/projects/${projectId}/milestones/${milestone.id}`, { method: "PATCH", body });
      else await api(`/api/projects/${projectId}/milestones`, { method: "POST", body });
      toast.success(milestone ? "Milestone updated" : "Milestone added");
      onDone();
      onOpenChange(false);
    } catch (err) {
      handleFormError(err, setError);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{milestone ? "Edit milestone" : "Add milestone"}</DialogTitle>
          <DialogDescription>Milestones mark key delivery points on the project timeline.</DialogDescription>
        </DialogHeader>
        <form id="milestone-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormRow label="Title" htmlFor="ms-title" required error={formState.errors.title?.message}>
            <Input id="ms-title" {...register("title")} />
          </FormRow>
          <FormRow label="Due date" htmlFor="ms-due" error={formState.errors.dueDate?.message}>
            <Input id="ms-due" type="date" {...register("dueDate")} />
          </FormRow>
          <FormRow label="Description" htmlFor="ms-desc">
            <Textarea id="ms-desc" rows={2} {...register("description")} />
          </FormRow>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="milestone-form" disabled={formState.isSubmitting}>{formState.isSubmitting ? <Spinner /> : null} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectMilestones({ projectId, milestones, canEdit, onChanged }: { projectId: string; milestones: MilestoneDTO[]; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<MilestoneDTO | undefined>();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<MilestoneDTO | null>(null);

  async function setStatus(m: MilestoneDTO, status: MilestoneStatus) {
    try {
      await api(`/api/projects/${projectId}/milestones/${m.id}`, { method: "PATCH", body: { status } });
      toast.success(`Milestone marked ${humanize(status).toLowerCase()}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Couldn't update the milestone");
    }
  }

  return (
    <div>
      {canEdit ? (
        <div className="flex justify-end border-b p-3">
          <Button size="sm" variant="outline" onClick={() => { setEditing(undefined); setOpen(true); }}><Plus /> Add milestone</Button>
        </div>
      ) : null}
      {!milestones.length ? (
        <EmptyState icon={Flag} title="No milestones" description={canEdit ? "Add milestones to track key delivery points." : undefined} className="py-8" />
      ) : (
        <ul className="divide-y">
          {milestones.map((m) => {
            const late = m.dueDate && isPast(new Date(m.dueDate)) && m.status !== "COMPLETED";
            const pct = m.taskCount ? Math.round((m.completedTaskCount / m.taskCount) * 100) : 0;
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Flag className={cn("size-4 shrink-0", m.status === "COMPLETED" ? "text-primary" : "text-amber-500")} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {m.title}
                    <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold", STATUS_STYLE[m.status])}>{humanize(m.status)}</span>
                  </p>
                  <p className={cn("text-xs", late ? "text-red-600" : "text-muted-foreground")}>
                    {m.dueDate ? `Due ${format(day(m.dueDate), "d MMM yyyy")}` : "No due date"}
                    {m.taskCount ? ` · ${m.completedTaskCount}/${m.taskCount} tasks done` : " · no linked tasks"}
                  </p>
                  {m.taskCount ? <Progress value={pct} className="mt-1.5 h-1 max-w-56" /> : null}
                </div>
                {canEdit ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.title}`}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => { setEditing(m); setOpen(true); }}><Pencil /> Edit</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {MILESTONE_STATUSES.filter((s) => s !== m.status).map((s) => (
                        <DropdownMenuItem key={s} onSelect={() => setStatus(m, s)}>Mark {humanize(s).toLowerCase()}</DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(m)}><Trash2 /> Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <MilestoneDialog projectId={projectId} milestone={editing} open={open} onOpenChange={setOpen} onDone={onChanged} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete milestone "${deleting?.title}"?`}
        description="Linked tasks are kept and simply unlinked from the milestone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api(`/api/projects/${projectId}/milestones/${deleting.id}`, { method: "DELETE" });
            toast.success("Milestone deleted");
            onChanged();
          } catch (err) {
            toast.error(err instanceof ApiClientError ? err.message : "Couldn't delete the milestone");
            return false;
          }
        }}
      />
    </div>
  );
}
