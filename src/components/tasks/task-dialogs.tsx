"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormRow } from "@/components/shared/form-row";
import { EmployeePicker } from "@/components/shared/employee-picker";
import { useCurrentUser } from "@/components/providers/user-provider";
import { useTaskDepartmentOptions } from "@/hooks/use-options";
import { useProjectDetail, useProjectTeam } from "@/hooks/use-work-options";
import { api, ApiClientError } from "@/lib/http";
import { humanize, type TaskStatus } from "@/lib/constants";
import type { TaskDetailDTO, TaskListItemDTO } from "@/types/dto";
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

export function WorkApprovalDialog({ taskId, action, onOpenChange, onDone }: {
  taskId: string; action: "REQUEST" | "REQUEST_CHANGES" | null; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const [comment, setComment] = useState("");
  const { pending, error, run } = useSubmit(onDone, () => onOpenChange(false));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
    if (action) setComment("");
  }, [action]);
  if (!action) return null;
  const changes = action === "REQUEST_CHANGES";
  return <Dialog open onOpenChange={(o) => !pending && onOpenChange(o)}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{changes ? "Request changes to work" : "Request Project Manager approval"}</DialogTitle>
        <DialogDescription>{changes ? "Send feedback to the requester. Work stays on hold until the request is approved." : "Send the description and proposed assignee to the project managers. Work can start once a manager approves it."}</DialogDescription></DialogHeader>
      <FormRow label={changes ? "What needs to change?" : "Note (optional)"} htmlFor="work-comment" required={changes} error={error ?? undefined}>
        <Textarea id="work-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={4} />
      </FormRow>
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button disabled={pending || (changes && comment.trim().length < 3)} onClick={() => run(() => api(`/api/tasks/${taskId}/work-approval`, { method: "POST", body: { action, comment } }), changes ? "Changes requested" : "Sent to Project Manager for approval")}>
          {pending ? <Spinner /> : null}{changes ? "Send feedback" : "Request approval"}
        </Button></DialogFooter>
    </DialogContent>
  </Dialog>;
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
export function ReassignDialog({ task, open, onOpenChange, onDone }: { task: TaskListItemDTO; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const me = useCurrentUser();
  const [department, setDepartment] = useState(task.department?.id ?? "");
  const [owner, setOwner] = useState<string | null>(task.owner?.id ?? null);
  const [requestApproval, setRequestApproval] = useState(false);
  const { pending, run } = useSubmit(onDone, () => onOpenChange(false));
  const { data: project } = useProjectDetail(open ? task.project?.id : null);
  const { data: team, isLoading } = useProjectTeam(open && department ? task.project?.id : null, department, true);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
      setDepartment(task.department?.id ?? "");
      setOwner(task.owner?.id ?? null);
      setRequestApproval(task.workApprovalStatus === "PENDING" || task.workApprovalStatus === "CHANGES_REQUESTED");
    }
  }, [open, task.department?.id, task.owner?.id, task.workApprovalStatus]);

  const { data: allDepartments } = useTaskDepartmentOptions(open);
  const departments = project?.can.manageTeam ? allDepartments ?? project.departments : (project?.departments ?? []).filter((d) => project?.can.taskDepartments.includes(d.id));
  const approvesRequest = !!project?.can.manageTeam && task.workApprovalStatus === "PENDING";
  const sendsRequest = !!project && !project.can.manageTeam && requestApproval;
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign {task.taskNumber}</DialogTitle>
          <DialogDescription>Choose yourself or an eligible department employee. You can send the proposed assignment to the Project Manager for approval.</DialogDescription>
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
          {(team ?? []).some((m) => m.id === me.id) ? <Button type="button" variant="outline" size="sm" onClick={() => setOwner(me.id)}>Assign to me</Button> : null}
          {project && !project.can.manageTeam ? <label className="flex items-start gap-3 rounded-lg border p-3">
            <Switch checked={requestApproval} onCheckedChange={setRequestApproval} disabled={task.workApprovalStatus === "PENDING"} />
            <span className="text-sm">Request Project Manager approval before work starts</span>
          </label> : null}
          <FormRow label="New owner" htmlFor="ra-owner">
            <EmployeePicker
              id="ra-owner"
              options={(team ?? []).map((m) => ({ id: m.id, name: m.name, email: m.email, employeeId: m.employeeId, subtitle: `${m.employeeId} · ${m.designation || humanize(m.projectRole)}` }))}
              loading={isLoading}
              value={owner}
              onChange={setOwner}
              disabled={!department}
              emptyText="No active employees in this department."
            />
          </FormRow>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button disabled={pending || !owner || !department} onClick={() => run(() => api(`/api/tasks/${task.id}/assign`, { method: "POST", body: { department, owner, requestProjectApproval: sendsRequest } }), sendsRequest ? "Sent to Project Manager for approval" : approvesRequest ? "Work approved and assigned" : "Task assigned")}>
            {pending ? <Spinner /> : null} {sendsRequest ? "Request approval" : approvesRequest ? "Approve and assign" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
