"use client";

import { TimerConflictDialog, TimerPanel } from "@/components/tasks/task-timer";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { AlarmClock, ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, Clock, ExternalLink, Flag, MessageSquare, Pause, Pencil, Play, Send, Siren, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/dashboard/panel";
import { AttachmentsPanel } from "@/components/shared/attachments-panel";
import { DepartmentChip, PriorityBadge, TicketStatusBadge } from "@/components/shared/badges";
import { FormRow } from "@/components/shared/form-row";
import { ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { day } from "@/lib/dates";
import { api, ApiClientError, fetcher } from "@/lib/http";
import { TASK_PRIORITIES, humanize } from "@/lib/constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TicketActivityDTO, TicketDetailDTO } from "@/types/dto";
import { TicketFormDialog } from "./ticket-form-dialog";
import { ReviewerPicker } from "./reviewer-picker";
import { ReviewStatusBadge } from "./review-status-badge";
import { TicketTriagePanel } from "./ticket-triage";
import { DeliverablesPanel, RequestChangesDialog } from "./deliverables-panel";
import { progressText, unfinishedDeliverables } from "@/lib/deliverables";

const dateFmt = (d: string | null) => (d ? format(day(d), "d MMM yyyy") : "—");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
    </div>
  );
}

function Person({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <UserAvatar name={name} size="sm" />
      <span className="truncate">{name}</span>
    </span>
  );
}

const ACTION_LABEL: Record<string, string> = {
  CREATED: "created the ticket",
  UPDATED: "updated the ticket",
  SUBMITTED: "submitted for approval",
  REVIEW_STARTED: "started reviewing",
  INFO_REQUESTED: "requested more information",
  INFO_PROVIDED: "provided the information",
  APPROVED: "approved the ticket",
  REJECTED: "rejected the ticket",
  ASSIGNED: "assigned the ticket",
  REASSIGNED: "reassigned the ticket",
  PRIORITY_CHANGED: "changed the priority",
  REORDERED: "changed the ticket's queue position",
  DATES_UPDATED: "updated the expected completion",
  STARTED: "started working",
  ON_HOLD: "put the ticket on hold",
  RESUMED: "resumed work",
  WORK_SUBMITTED: "submitted the work for review",
  CHANGES_REQUESTED: "requested changes",
  COMPLETED: "confirmed completion",
  CANCELLED: "cancelled the ticket",
  ESCALATED: "escalated the ticket",
  COMMENTED: "commented",
  ATTACHMENT_ADDED: "added a file",
  STATUS_CHANGED: "changed the status",
  REVIEWER_ASSIGNED: "assigned a reviewer",
  REVIEWER_CHANGED: "changed the reviewer",
  DELIVERABLES_CHANGED: "changed the requested deliverables",
  DELIVERABLE_PROGRESS: "recorded progress",
};

function Timeline({ items }: { items: TicketActivityDTO[] }) {
  return (
    <ol className="space-y-4 p-4">
      {items.map((a) => (
        <li key={a.id} className="flex gap-3">
          <UserAvatar name={a.actor?.name ?? "?"} size="sm" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm">
              <span className="font-medium">{a.actor?.name ?? "Someone"}</span>{" "}
              <span className="text-muted-foreground">{ACTION_LABEL[a.action] ?? a.action.toLowerCase()}</span>
              {a.action === "ASSIGNED" && a.to ? <> to <span className="font-medium">{a.to}</span></> : null}
              {a.action === "REASSIGNED" ? <> from <span className="font-medium">{a.from ?? "nobody"}</span> to <span className="font-medium">{a.to}</span></> : null}
              {a.action === "PRIORITY_CHANGED" ? <> from <span className="font-medium">{humanize(a.from ?? "")}</span> to <span className="font-medium">{humanize(a.to ?? "")}</span></> : null}
              {a.action === "REORDERED" ? <> from <span className="font-medium">#{a.from}</span> to <span className="font-medium">#{a.to}</span></> : null}
              {a.action === "ATTACHMENT_ADDED" && a.to ? <> <span className="font-medium">{a.to}</span></> : null}
            </p>
            {a.toStatus && a.action !== "ASSIGNED" ? (
              <p className="text-xs text-muted-foreground">{a.fromStatus ? `${humanize(a.fromStatus)} → ` : ""}{humanize(a.toStatus)}</p>
            ) : null}
            {a.message && a.action !== "ATTACHMENT_ADDED" ? (
              <p className={a.action === "COMMENTED" ? "rounded-lg bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap" : "text-sm whitespace-pre-wrap text-muted-foreground"}>{a.message}</p>
            ) : null}
            <p className="text-xs text-muted-foreground" title={format(new Date(a.createdAt), "PPpp")}>{formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

type MessageAction = {
  action: string;
  title: string;
  description?: string;
  label: string;
  confirm: string;
  required: boolean;
  destructive?: boolean;
};

function MessageDialog({ spec, onClose, onSubmit }: { spec: MessageAction | null; onClose: () => void; onSubmit: (message: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  if (!spec) return null;
  return (
    <Dialog open onOpenChange={(o) => !pending && !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
          {spec.description ? <DialogDescription>{spec.description}</DialogDescription> : null}
        </DialogHeader>
        <FormRow label={spec.label} htmlFor="tk-msg" required={spec.required}>
          <Textarea id="tk-msg" rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </FormRow>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Back</Button>
          <Button
            variant={spec.destructive ? "destructive" : "default"}
            disabled={pending || (spec.required && !text.trim())}
            onClick={async () => {
              setPending(true);
              const ok = await onSubmit(text.trim());
              setPending(false);
              if (ok) { setText(""); onClose(); }
            }}
          >
            {pending ? <Spinner /> : null} {spec.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MESSAGES: Record<string, MessageAction> = {
  request_info: { action: "request_info", title: "Request more information", description: "The requester is notified and the ticket waits until they reply.", label: "What do you need to know?", confirm: "Send request", required: true },
  reject: { action: "reject", title: "Reject ticket", description: "The requester sees your reason.", label: "Reason", confirm: "Reject ticket", required: true, destructive: true },
  respond: { action: "respond", title: "Reply with the requested information", description: "The ticket goes back to the Project Manager for approval.", label: "Your reply", confirm: "Send reply", required: true },
  hold: { action: "hold", title: "Put on hold", label: "Why is work paused?", confirm: "Put on hold", required: true },
  submit_work: { action: "submit_work", title: "Submit work for review", description: "Your work goes to the reviewer assigned by the Project Manager. Attach the files first.", label: "Note for the reviewer (optional)", confirm: "Submit for review", required: false },
  accept: { action: "accept", title: "Approve the work", description: "This approves the deliverable and completes the ticket.", label: "Review comment (optional)", confirm: "Approve", required: false },
  request_changes: { action: "request_changes", title: "Request changes", description: "The work goes back to the assignee with your comments. After the fixes it returns to you.", label: "Review comments: what needs to change?", confirm: "Send back", required: true },
  cancel: { action: "cancel", title: "Cancel ticket", description: "This can't be undone.", label: "Reason (optional)", confirm: "Cancel ticket", required: false, destructive: true },
  escalate: { action: "escalate", title: "Escalate ticket", description: "The selected Project Manager, or the department reviewers when none is selected, will be notified.", label: "Why is this delayed or urgent?", confirm: "Escalate", required: true },
};

export function TicketDetail({ id }: { id: string }) {
  const { data: t, error, isLoading, mutate } = useSWR<TicketDetailDTO>(`/api/tickets/${id}`, fetcher);
  const [dialog, setDialog] = useState<MessageAction | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [reviewerOpen, setReviewerOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ ticketNumber: string; key: string; body: Record<string, unknown>; success?: string } | null>(null);

  if (error) {
    return (
      <div className="rounded-xl border bg-card">
        <ErrorState
          title={error.status === 404 ? "Ticket not found" : "Couldn't load this ticket"}
          message={error.status === 404 ? "It doesn't exist or you don't have access to it." : error.message}
          onRetry={error.status === 404 ? undefined : () => mutate()}
        />
      </div>
    );
  }
  if (isLoading || !t) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  const { can } = t;

  async function run(key: string, body: Record<string, unknown>, success?: string): Promise<boolean> {
    setBusy(key);
    try {
      await api(`/api/tickets/${id}/actions`, { method: "POST", body });
      if (success) toast.success(success);
      setConflict(null);
      await mutate();
      return true;
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors?.timerConflict) {
        setConflict({ ticketNumber: err.fieldErrors.timerConflict, key, body, success });
        return false;
      }
      toast.error(err instanceof ApiClientError ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(null);
    }
  }
  const simple = (action: string, success: string) => () => run(action, { action }, success);

  return (
    <div className="space-y-6">
      <Link href="/tickets" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Tickets
      </Link>

      <section className="rounded-xl border bg-card p-5 shadow-xs">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{t.ticketNumber}</span>
              <span>· {t.category}</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.title}</h1>
            <div className="flex flex-wrap items-center gap-3">
              <TicketStatusBadge status={t.status} />
              <PriorityBadge priority={t.priority} />
              {t.isOverdue ? <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"><AlarmClock className="size-3" /> Overdue</span> : null}
              <span className="flex items-center gap-1.5 text-sm">
                {t.requestingDepartment ? <DepartmentChip name={t.requestingDepartment.name} color={t.requestingDepartment.color} /> : null}
                <ArrowRight className="size-3.5 text-muted-foreground" />
                {t.targetDepartment ? <DepartmentChip name={t.targetDepartment.name} color={t.targetDepartment.color} /> : null}
                {t.additionalDepartments.map((d) => (
                  <span key={d.id} className="flex items-center gap-1.5"><span className="text-muted-foreground">+</span><DepartmentChip name={d.name} color={d.color} /></span>
                ))}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can.submit ? <Button onClick={simple("submit", "Submitted for approval")} disabled={!!busy}><Send /> Submit for approval</Button> : null}
            {can.respond ? <Button onClick={() => setDialog(MESSAGES.respond)}><MessageSquare /> Reply</Button> : null}
            {can.start ? <Button onClick={simple("start", "Work started")} disabled={!!busy}><Play /> Start work</Button> : null}
            {can.resume ? <Button onClick={simple("resume", "Work resumed")} disabled={!!busy}><Play /> Resume</Button> : null}
            {can.submitWork ? (
              <Button
                onClick={() => {
                  const open = unfinishedDeliverables(t.deliverables);
                  if (open.length) toast.error("Record your progress first", { description: `Not finished yet: ${open.map(progressText).join(", ")}. Use “Update progress” under Deliverables.` });
                  else setDialog(MESSAGES.submit_work);
                }}
              >
                <Send /> Submit for review
              </Button>
            ) : null}
            {can.review ? (
              <>
                <Button
                  onClick={() =>
                    setDialog(
                      t.deliverables.length
                        ? { ...MESSAGES.accept, description: `This verifies every deliverable (${t.deliverables.map((d) => `${d.quantity} × ${d.type}`).join(", ")}) and completes the ticket.` }
                        : MESSAGES.accept
                    )
                  }
                >
                  <CheckCircle2 /> Approve
                </Button>
                <Button variant="outline" onClick={() => (t.deliverables.length ? setChangesOpen(true) : setDialog(MESSAGES.request_changes))}>Request changes</Button>
              </>
            ) : null}
            {can.triage && t.status === "PENDING_APPROVAL" ? <Button variant="outline" onClick={simple("start_review", "Review started")} disabled={!!busy}>Start review</Button> : null}
            {can.triage ? (
              <>
                <Button variant="outline" onClick={() => setDialog(MESSAGES.request_info)}><MessageSquare /> Request info</Button>
                <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => setDialog(MESSAGES.reject)}><XCircle /> Reject</Button>
              </>
            ) : null}
            {can.hold ? <Button variant="outline" onClick={() => setDialog(MESSAGES.hold)}><Pause /> Hold</Button> : null}
            {can.edit ? <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button> : null}
            {can.escalate ? <Button variant="outline" onClick={() => setDialog(MESSAGES.escalate)}><Siren /> Escalate</Button> : null}
            {can.setPriority ? <Button variant="outline" onClick={() => setPriorityOpen(true)}><Flag /> Priority</Button> : null}
            {can.setDates ? <Button variant="outline" onClick={() => setDatesOpen(true)}><CalendarClock /> Dates</Button> : null}
            {can.cancel ? <Button variant="ghost" onClick={() => setDialog(MESSAGES.cancel)}>Cancel ticket</Button> : null}
          </div>
        </div>
      </section>

      {t.status === "PENDING_CLARIFICATION" && t.clarificationRequest ? (
        <div role="status" className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <p className="font-medium">More information requested</p>
          <p className="whitespace-pre-wrap">{t.clarificationRequest}</p>
        </div>
      ) : null}
      {t.status === "REJECTED" && t.decisionReason ? (
        <div role="status" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-medium">Rejected</p>
          <p className="whitespace-pre-wrap">{t.decisionReason}</p>
        </div>
      ) : null}
      {t.status === "SUBMITTED_FOR_REVIEW" && t.submissionNote ? (
        <div role="status" className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <p className="font-medium">Submitted for review</p>
          <p className="whitespace-pre-wrap">{t.submissionNote}</p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {can.approve || can.assign || can.reassign ? <TicketTriagePanel key={t.status + (t.assignee?.id ?? "")} ticket={t} onDone={() => mutate()} /> : null}

          <DeliverablesPanel ticket={t} run={run} busy={!!busy} />

          <TimerConflictDialog ticketNumber={conflict?.ticketNumber ?? null} busy={!!busy} onCancel={() => setConflict(null)} onConfirm={() => conflict && run(conflict.key, { ...conflict.body, pausePrevious: true }, conflict.success)} />
          <TimerPanel id={t.id} kind="ticket" timer={t.timer} canTrack={can.trackTime} onChanged={() => mutate()} />

          {t.reviewComments.length || t.reviewHistory.length || t.reviewStatus !== "NONE" ? (
            <Panel title="Review" description="Reviewer feedback and who has been responsible for the review">
              <div className="space-y-4 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <ReviewStatusBadge status={t.reviewStatus} />
                  {t.reviewRoutedTo.user ? <span className="text-muted-foreground">Reviewer: <span className="font-medium text-foreground">{t.reviewRoutedTo.user.name}</span>{t.reviewRoutedTo.legacy ? " (requester)" : ""}</span> : null}
                  {t.reviewDecidedAt && t.reviewDecidedBy ? <span className="text-muted-foreground">· decided by {t.reviewDecidedBy.name} on {dateFmt(t.reviewDecidedAt)}</span> : null}
                </div>
                {t.reviewComments.length ? (
                  <ul className="space-y-2">
                    {[...t.reviewComments].reverse().map((c) => (
                      <li key={c.id} className="rounded-lg border bg-muted/30 px-3 py-2">
                        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{c.author?.name ?? "—"}</span>
                          <span className={c.decision === "APPROVED" ? "text-emerald-700" : "text-orange-700"}>{c.decision === "APPROVED" ? "Approved" : "Requested changes"}</span>
                          <span>{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</span>
                        </p>
                        {c.comment ? <p className="mt-1 whitespace-pre-wrap">{c.comment}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {t.reviewHistory.length ? (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Reviewer changes</p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {[...t.reviewHistory].reverse().map((h) => (
                        <li key={h.id}>
                          {h.previousReviewer ? <>{h.previousReviewer.name} → <span className="text-foreground">{h.newReviewer?.name}</span></> : <>Assigned <span className="text-foreground">{h.newReviewer?.name}</span></>}
                          {" "}by {h.changedBy?.name ?? "—"}, {format(new Date(h.createdAt), "d MMM yyyy HH:mm")}
                          {h.reason ? <> · “{h.reason}”</> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Panel>
          ) : null}

          <Panel title="Request">
            <div className="space-y-3 p-4 text-sm">
              <p className="whitespace-pre-wrap">{t.description || "—"}</p>
              {t.referenceLinks.length ? (
                <ul className="space-y-1">
                  {t.referenceLinks.map((l) => (
                    <li key={l}>
                      <a href={l} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        <ExternalLink className="size-3.5" /> <span className="truncate">{l}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Panel>

          <Panel title="Files" description="Briefs, references and the delivered work">
            <div className="p-4">
              <AttachmentsPanel items={t.attachments} uploadUrl={`/api/tickets/${t.id}/attachments`} canUpload={can.upload} onChanged={() => mutate()} />
            </div>
          </Panel>

          <Panel title="Activity" description="Every action is recorded">
            <Timeline items={t.activity} />
            {can.comment ? (
              <form
                className="flex flex-col gap-2 border-t p-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!comment.trim()) return;
                  if (await run("comment", { action: "comment", message: comment.trim() })) setComment("");
                }}
              >
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Add a comment…" aria-label="Add a comment" />
                <Button type="submit" size="sm" className="self-end" disabled={busy === "comment" || !comment.trim()}>
                  {busy === "comment" ? <Spinner /> : null} Comment
                </Button>
              </form>
            ) : null}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Details" bodyClassName="divide-y">
            <Row label="Raised by">{t.createdBy ? <Person name={t.createdBy.name} /> : "—"}</Row>
            <Row label="Project">{t.project ? <Link href={`/projects/${t.project.id}`} className="font-medium hover:underline">{t.project.name}</Link> : <span className="text-muted-foreground">None</span>}</Row>
            {t.project ? <Row label="Task">{t.task ? <Link href={`/tasks/${t.task.id}`} className="font-medium hover:underline">{t.task.taskNumber} · {t.task.title}</Link> : <span className="text-muted-foreground">Created on submission</span>}</Row> : null}
            <Row label="Project Manager">{t.projectManager ? <Person name={t.projectManager.name} /> : "Department Project Managers"}</Row>
            <Row label="Assigned to">{t.assignee ? <Person name={t.assignee.name} /> : <span className="text-muted-foreground">Not assigned</span>}</Row>
            {t.assignee && t.assignedBy ? <Row label="Assigned by">{t.assignedBy.name}</Row> : null}
            <Row label="Assigned reviewer">
              <span className="inline-flex flex-col items-end gap-1">
                {t.assignedReviewer ? <Person name={t.assignedReviewer.name} /> : <span className="text-muted-foreground">Not assigned</span>}
                {!t.assignedReviewer && t.reviewRoutedTo.user ? <span className="text-xs font-normal text-muted-foreground">Requester reviews ({t.reviewRoutedTo.user.name})</span> : null}
                {can.setReviewer ? (
                  <button type="button" className="text-xs font-normal text-primary hover:underline" onClick={() => setReviewerOpen(true)}>
                    {t.assignedReviewer ? "Change reviewer" : "Assign reviewer"}
                  </button>
                ) : null}
              </span>
            </Row>
            <Row label="Review status"><ReviewStatusBadge status={t.reviewStatus} /></Row>
            {t.approvedBy ? <Row label="Approved by">{t.approvedBy.name}</Row> : null}
            <Row label="Requested by date">{dateFmt(t.dueDate)}</Row>
            <Row label="Expected completion">{dateFmt(t.expectedCompletion)}</Row>
            <Row label="Estimate">{t.estimatedHours != null ? `${t.estimatedHours} h` : "—"}</Row>
            <Row label="Created">{format(new Date(t.createdAt), "d MMM yyyy")}</Row>
            {t.completedAt ? <Row label="Completed">{format(new Date(t.completedAt), "d MMM yyyy")}</Row> : null}
            {t.suggestedEmployee ? (
              <Row label="Suggested">
                <span className="inline-flex flex-col items-end">
                  <Person name={t.suggestedEmployee.name} />
                  <span className="text-xs font-normal text-muted-foreground">Hint only – not assigned</span>
                </span>
              </Row>
            ) : null}
          </Panel>
          <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground"><Clock className="mt-0.5 size-3.5 shrink-0" /> Updated {formatDistanceToNow(new Date(t.updatedAt), { addSuffix: true })}</p>
        </div>
      </div>

      <MessageDialog spec={dialog} onClose={() => setDialog(null)} onSubmit={(message) => run(dialog!.action, { action: dialog!.action, message }, "Done")} />
      {changesOpen ? <RequestChangesDialog list={t.deliverables} onClose={() => setChangesOpen(false)} run={run} /> : null}
      {can.setReviewer ? (
        <ReviewerDialog
          key={`r-${t.updatedAt}`}
          ticket={t}
          open={reviewerOpen}
          onOpenChange={setReviewerOpen}
          onSave={(body) => run("set_reviewer", { action: "set_reviewer", ...body }, "Reviewer updated")}
        />
      ) : null}
      <PriorityDialog key={`p-${t.updatedAt}`} ticket={t} open={priorityOpen} onOpenChange={setPriorityOpen} onSave={(body) => run("set_priority", { action: "set_priority", ...body }, "Priority updated")} />
      <DatesDialog key={t.updatedAt} ticket={t} open={datesOpen} onOpenChange={setDatesOpen} onSave={(body) => run("set_dates", { action: "set_dates", ...body }, "Dates updated")} />
      {can.edit ? <TicketFormDialog open={editOpen} onOpenChange={setEditOpen} ticket={t} onSaved={() => mutate()} /> : null}
    </div>
  );
}

function DatesDialog({ ticket, open, onOpenChange, onSave }: { ticket: TicketDetailDTO; open: boolean; onOpenChange: (o: boolean) => void; onSave: (b: { expectedCompletion: string | null; estimatedHours: number | null }) => Promise<boolean> }) {
  const [date, setDate] = useState(ticket.expectedCompletion?.slice(0, 10) ?? "");
  const [hours, setHours] = useState(ticket.estimatedHours != null ? String(ticket.estimatedHours) : "");
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Expected completion</DialogTitle>
          <DialogDescription>The requester and assignee are notified of the new date.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormRow label="Expected completion" htmlFor="dt-date"><Input id="dt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FormRow>
          <FormRow label="Estimated effort (hours)" htmlFor="dt-hours"><Input id="dt-hours" type="number" min={0} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} /></FormRow>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button disabled={pending} onClick={async () => { setPending(true); const ok = await onSave({ expectedCompletion: date || null, estimatedHours: hours === "" ? null : Number(hours) }); setPending(false); if (ok) onOpenChange(false); }}>
            {pending ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriorityDialog({ ticket, open, onOpenChange, onSave }: { ticket: TicketDetailDTO; open: boolean; onOpenChange: (o: boolean) => void; onSave: (b: { priority: string; message: string }) => Promise<boolean> }) {
  const [priority, setPriority] = useState<string>(ticket.priority);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change priority</DialogTitle>
          <DialogDescription>Allowed until work starts. The requester and assignee are notified. The ticket keeps its place in the assignee&apos;s queue.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormRow label="Priority" htmlFor="pr-level">
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger id="pr-level"><SelectValue /></SelectTrigger>
              <SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{humanize(p)}</SelectItem>)}</SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Reason (optional)" htmlFor="pr-note"><Textarea id="pr-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormRow>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button disabled={pending || priority === ticket.priority} onClick={async () => { setPending(true); const ok = await onSave({ priority, message: note }); setPending(false); if (ok) onOpenChange(false); }}>
            {pending ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Assign or change the reviewer. A reason is mandatory once the work is already waiting for review. */
function ReviewerDialog({ ticket, open, onOpenChange, onSave }: { ticket: TicketDetailDTO; open: boolean; onOpenChange: (o: boolean) => void; onSave: (b: { reviewer: string; message: string }) => Promise<boolean> }) {
  const [reviewer, setReviewer] = useState<string | null>(ticket.assignedReviewer?.id ?? null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const inReview = ticket.status === "SUBMITTED_FOR_REVIEW";
  const unchanged = reviewer === (ticket.assignedReviewer?.id ?? null);
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ticket.assignedReviewer ? "Change reviewer" : "Assign reviewer"}</DialogTitle>
          <DialogDescription>
            {inReview
              ? "The work is already waiting for review. The new reviewer takes over, the current reviewer can no longer act, and both are kept in the history."
              : "The reviewer approves or sends back the finished work. They are notified now."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormRow label="Reviewer" htmlFor="rv-person" required>
            <ReviewerPicker id="rv-person" ticketId={ticket.id} value={reviewer} onChange={setReviewer} excludeId={ticket.assignee?.id} allowClear={false} />
          </FormRow>
          <FormRow label={inReview ? "Reason for the change" : "Reason (optional)"} htmlFor="rv-reason" required={inReview}>
            <Textarea id="rv-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          </FormRow>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={pending || !reviewer || unchanged || (inReview && !reason.trim())}
            onClick={async () => {
              setPending(true);
              const ok = await onSave({ reviewer: reviewer!, message: reason.trim() });
              setPending(false);
              if (ok) onOpenChange(false);
            }}
          >
            {pending ? <Spinner /> : null} Save reviewer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
