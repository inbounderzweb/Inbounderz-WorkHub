"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { FormRow } from "@/components/shared/form-row";
import { EmployeePicker } from "@/components/shared/employee-picker";
import { useProjectDetail, useProjectTeam } from "@/hooks/use-work-options";
import { api, ApiClientError } from "@/lib/http";
import { humanize, type TaskStatus } from "@/lib/constants";
import type { TaskDetailDTO } from "@/types/dto";
import { transitionLabel } from "./task-status";

function useSubmit(onDone: () => void, close: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, success: string) {
    setPending(true);
    setError(null);
    try {
      await fn();
      toast.success(success);
      onDone();
      close();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Something went wrong";
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }
  return { pending, error, run, setError };
}

/** Status change with an optional note (used for submit-for-review and other moves). */
export function StatusDialog({
  task,
  status,
  onOpenChange,
  onDone,
}: {
  task: Pick<TaskDetailDTO, "id" | "status" | "taskNumber">;
  status: TaskStatus | null;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const { pending, run, setError } = useSubmit(onDone, () => onOpenChange(false));
  useEffect(() => {
    if (status) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
      setNote("");
      setError(null);
    }
  }, [status, setError]);
  if (!status) return null;
  const submitting = status === "IN_REVIEW";
  return (
    <Dialog open onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{transitionLabel(task.status, status)}</DialogTitle>
          <DialogDescription>
            {submitting
              ? "Your reviewer will be notified. You can withdraw the submission while it's in review."
              : `${task.taskNumber} moves from ${humanize(task.status)} to ${humanize(status)}.`}
          </DialogDescription>
        </DialogHeader>
        <FormRow label={submitting ? "Note for the reviewer (optional)" : "Note (optional)"} htmlFor="status-note">
          <Textarea id="status-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder={submitting ? "What changed, where to look, anything to verify…" : ""} />
        </FormRow>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={() => run(() => api(`/api/tasks/${task.id}/status`, { method: "PATCH", body: { status, note } }), submitting ? "Submitted for review" : `Moved to ${humanize(status)}`)} disabled={pending}>
            {pending ? <Spinner /> : null}
            {transitionLabel(task.status, status)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReviewDialog({
  taskId,
  decision,
  onOpenChange,
  onDone,
}: {
  taskId: string;
  decision: "APPROVE" | "REQUEST_CHANGES" | null;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [comment, setComment] = useState("");
  const { pending, error, run, setError } = useSubmit(onDone, () => onOpenChange(false));
  useEffect(() => {
    if (decision) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
      setComment("");
      setError(null);
    }
  }, [decision, setError]);
  if (!decision) return null;
  const approve = decision === "APPROVE";
  return (
    <Dialog open onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{approve ? "Approve and complete" : "Request changes"}</DialogTitle>
          <DialogDescription>
            {approve ? "The task is marked Completed and your approval is recorded." : "The task goes back to the owner with your feedback."}
          </DialogDescription>
        </DialogHeader>
        <FormRow label={approve ? "Comment (optional)" : "What needs to change?"} htmlFor="review-comment" required={!approve} error={!approve && error?.includes("change") ? error : undefined}>
          <Textarea id="review-comment" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={5000} />
        </FormRow>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button
            variant={approve ? "default" : "destructive"}
            className={approve ? undefined : "bg-orange-600 text-white hover:bg-orange-600/90"}
            disabled={pending || (!approve && comment.trim().length < 3)}
            onClick={() => run(() => api(`/api/tasks/${taskId}/review`, { method: "POST", body: { decision, comment } }), approve ? "Task approved" : "Changes requested")}
          >
            {pending ? <Spinner /> : null}
            {approve ? "Approve" : "Send back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BlockerDialog({ taskId, open, onOpenChange, onDone }: { taskId: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const { pending, run } = useSubmit(onDone, () => onOpenChange(false));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
    if (open) setReason("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report a blocker</DialogTitle>
          <DialogDescription>Your project manager and department leads are notified. The task status doesn’t change.</DialogDescription>
        </DialogHeader>
        <FormRow label="What is blocking you?" htmlFor="blocker-reason" required>
          <Textarea id="blocker-reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} placeholder="e.g. Waiting for API credentials from the client" />
        </FormRow>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button variant="destructive" className="bg-destructive text-white hover:bg-destructive/90" disabled={pending || reason.trim().length < 3} onClick={() => run(() => api(`/api/tasks/${taskId}/blocker`, { method: "POST", body: { action: "REPORT", reason } }), "Blocker reported")}>
            {pending ? <Spinner /> : null} Report blocker
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reassign: department (of the project) → eligible member of that department. */
export function ReassignDialog({ task, open, onOpenChange, onDone }: { task: TaskDetailDTO; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [department, setDepartment] = useState(task.department?.id ?? "");
  const [owner, setOwner] = useState<string | null>(task.owner?.id ?? null);
  const { pending, run } = useSubmit(onDone, () => onOpenChange(false));
  const { data: project } = useProjectDetail(open ? task.project?.id : null);
  const { data: team, isLoading } = useProjectTeam(open && department ? task.project?.id : null, department);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
      setDepartment(task.department?.id ?? "");
      setOwner(task.owner?.id ?? null);
    }
  }, [open, task.department?.id, task.owner?.id]);

  const departments = (project?.departments ?? []).filter((d) => project?.can.taskDepartments.includes(d.id));
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reassign {task.taskNumber}</DialogTitle>
          <DialogDescription>Only employees allocated to this project under the chosen department are eligible.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormRow label="Department" htmlFor="ra-dept">
            <Select value={department || undefined} onValueChange={(v) => { setDepartment(v); setOwner(null); }}>
              <SelectTrigger id="ra-dept" className="w-full"><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="New owner" htmlFor="ra-owner">
            <EmployeePicker
              id="ra-owner"
              options={(team ?? []).map((m) => ({ id: m.id, name: m.name, email: m.email, employeeId: m.employeeId, subtitle: `${m.employeeId} · ${m.designation || humanize(m.projectRole)}` }))}
              loading={isLoading}
              value={owner}
              onChange={setOwner}
              disabled={!department}
              emptyText="Nobody from this department is allocated to the project."
            />
          </FormRow>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button disabled={pending || !owner || !department} onClick={() => run(() => api(`/api/tasks/${task.id}/assign`, { method: "POST", body: { department, owner } }), "Task reassigned")}>
            {pending ? <Spinner /> : null} Reassign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
