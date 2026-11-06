"use client";

import { formatDay } from "@/lib/dates";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlarmClock,
  AlertOctagon,
  ArrowLeft,
  CheckCircle2,
  Clock,
  GitBranch,
  Link2,
  ListChecks,
  MessageSquare,
  MessageSquareWarning,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  History,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/dashboard/panel";
import { DetailSkeleton } from "@/components/shared/skeletons";
import { ErrorState, EmptyState } from "@/components/shared/states";
import { PriorityBadge, TaskStatusBadge } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { AttachmentsPanel } from "@/components/shared/attachments-panel";
import { api, ApiClientError, fetcher } from "@/lib/http";
import { APPROVAL_MODE_LABELS, humanize, type TaskStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { TaskDetailDTO } from "@/types/dto";
import { TaskFormDialog } from "./task-form-dialog";
import { BlockerDialog, ReassignDialog, ReviewDialog, StatusDialog } from "./task-dialogs";
import { transitionLabel } from "./task-status";

const PRIMARY: TaskStatus[] = ["IN_PROGRESS", "IN_REVIEW", "COMPLETED"];

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

const dateFmt = (d: string | null) => (d ? format(new Date(d), "d MMM yyyy") : "—");

export function TaskDetail({ id }: { id: string }) {
  const { data: t, error, isLoading, mutate } = useSWR<TaskDetailDTO>(`/api/tasks/${id}`, fetcher);
  const [statusTarget, setStatusTarget] = useState<TaskStatus | null>(null);
  const [review, setReview] = useState<"APPROVE" | "REQUEST_CHANGES" | null>(null);
  const [blockerOpen, setBlockerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [hours, setHours] = useState<string | null>(null);

  if (error) {
    return (
      <div className="rounded-xl border bg-card">
        <ErrorState
          title={error.status === 404 ? "Task not found" : "Couldn't load this task"}
          message={error.status === 404 ? "It doesn't exist or you don't have access to it." : error.message}
          onRetry={error.status === 404 ? undefined : () => mutate()}
        />
      </div>
    );
  }
  if (isLoading || !t) return <DetailSkeleton />;

  async function act(key: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      await mutate();
      return true;
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const doneItems = t.checklistItems.filter((c) => c.done).length;
  const primary = t.allowedStatuses.filter((s) => PRIMARY.includes(s));
  const secondary = t.allowedStatuses.filter((s) => !PRIMARY.includes(s));
  const lastReview = [...t.comments].reverse().find((c) => c.kind === "REVIEW");

  return (
    <div className="space-y-6">
      <Link href="/my-tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> My Tasks
      </Link>

      {/* Header */}
      <section className="rounded-xl border bg-card p-5 shadow-xs">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{t.taskNumber}</span>
              {t.project ? <Link href={`/projects/${t.project.id}`} className="hover:text-primary">· {t.project.name}</Link> : null}
              {t.parentTask ? <Link href={`/tasks/${t.parentTask.id}`} className="hover:text-primary">· ↳ {t.parentTask.taskNumber}</Link> : null}
            </div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <TaskStatusBadge status={t.status} />
              <PriorityBadge priority={t.priority} />
              {t.isBlocked ? <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"><AlertOctagon className="size-3" /> Blocked</span> : null}
              {t.isOverdue ? <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"><AlarmClock className="size-3" /> Overdue</span> : null}
              {t.approvalRequired ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" /> Approval: {APPROVAL_MODE_LABELS[t.approvalMode]}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {t.can.review ? (
              <>
                <Button onClick={() => setReview("APPROVE")}><CheckCircle2 /> Approve</Button>
                <Button variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50" onClick={() => setReview("REQUEST_CHANGES")}><RotateCcw /> Request changes</Button>
              </>
            ) : null}
            {primary.map((s) => (
              <Button key={s} variant={s === "IN_REVIEW" || (s === "IN_PROGRESS" && !t.can.review) ? "default" : "outline"} onClick={() => setStatusTarget(s)}>
                {transitionLabel(t.status, s)}
              </Button>
            ))}
            {secondary.map((s) => (
              <Button key={s} variant="ghost" size="sm" className="self-center" onClick={() => setStatusTarget(s)}>
                {transitionLabel(t.status, s)}
              </Button>
            ))}
          </div>
        </div>

        {/* Contextual banners */}
        <div className="mt-4 space-y-2 empty:hidden">
          {t.status === "CHANGES_REQUESTED" && lastReview ? (
            <div className="flex gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
              <MessageSquareWarning className="mt-0.5 size-4 shrink-0" />
              <div><p className="font-medium">Changes requested by {lastReview.author?.name}</p><p className="whitespace-pre-wrap">{lastReview.body}</p></div>
            </div>
          ) : null}
          {t.status === "IN_REVIEW" ? (
            <div className="flex gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
              <Clock className="mt-0.5 size-4 shrink-0" />
              <p>Submitted {t.submittedAt ? formatDistanceToNow(new Date(t.submittedAt), { addSuffix: true }) : ""} · waiting for {APPROVAL_MODE_LABELS[t.approvalMode]} to review.</p>
            </div>
          ) : null}
          {t.blocker.isBlocked ? (
            <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <AlertOctagon className="mt-0.5 size-4 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Blocked{t.blocker.reportedBy ? ` · reported by ${t.blocker.reportedBy.name}` : ""}</p>
                <p className="whitespace-pre-wrap">{t.blocker.reason}</p>
              </div>
              {t.can.reportBlocker ? (
                <Button size="sm" variant="outline" disabled={busy === "unblock"} onClick={() => act("unblock", () => api(`/api/tasks/${t.id}/blocker`, { method: "POST", body: { action: "CLEAR" } }), "Blocker cleared")}>
                  {busy === "unblock" ? <Spinner /> : null} Mark resolved
                </Button>
              ) : null}
            </div>
          ) : null}
          {t.unresolvedDependencies > 0 && !["COMPLETED", "CANCELLED"].includes(t.status) ? (
            <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <Link2 className="mt-0.5 size-4 shrink-0" />
              <p>Waiting on {t.unresolvedDependencies} unfinished dependenc{t.unresolvedDependencies === 1 ? "y" : "ies"}. Work can’t start or be submitted until they’re completed.</p>
            </div>
          ) : null}
          {t.status === "COMPLETED" && t.approvedBy ? (
            <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <p>Approved by {t.approvedBy.name} on {dateFmt(t.approvedAt)}.</p>
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Description" action={t.can.edit ? <Button variant="ghost" size="xs" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button> : null}>
            <p className="px-4 py-3 text-sm whitespace-pre-wrap">{t.description || <span className="text-muted-foreground">No description.</span>}</p>
          </Panel>

          <Panel title="Checklist" description={t.checklistItems.length ? `${doneItems} of ${t.checklistItems.length} done` : undefined}>
            {t.checklistItems.length ? (
              <div className="px-4 pt-3"><Progress value={(doneItems / t.checklistItems.length) * 100} className="h-1.5" /></div>
            ) : null}
            <ul className="divide-y">
              {t.checklistItems.map((c) => (
                <li key={c.id} className="group flex items-center gap-3 px-4 py-2.5">
                  <Checkbox
                    id={`c-${c.id}`}
                    checked={c.done}
                    disabled={!t.can.updateChecklist || busy === c.id}
                    onCheckedChange={(v) => act(c.id, () => api(`/api/tasks/${t.id}/checklist/${c.id}`, { method: "PATCH", body: { done: v === true } }))}
                  />
                  <label htmlFor={`c-${c.id}`} className={cn("flex-1 text-sm", c.done && "text-muted-foreground line-through")}>{c.text}</label>
                  {c.done && c.doneBy ? <span className="hidden text-xs text-muted-foreground sm:inline">{c.doneBy.name}</span> : null}
                  {t.can.updateChecklist ? (
                    <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Remove ${c.text}`} onClick={() => act(`del-${c.id}`, () => api(`/api/tasks/${t.id}/checklist/${c.id}`, { method: "DELETE" }))}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {t.can.updateChecklist ? (
              <form
                className="flex gap-2 border-t p-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newItem.trim()) return;
                  if (await act("add-item", () => api(`/api/tasks/${t.id}/checklist`, { method: "POST", body: { text: newItem.trim() } }))) setNewItem("");
                }}
              >
                <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item…" maxLength={300} aria-label="New checklist item" />
                <Button type="submit" variant="outline" disabled={!newItem.trim() || busy === "add-item"}>{busy === "add-item" ? <Spinner /> : <Plus />} Add</Button>
              </form>
            ) : !t.checklistItems.length ? (
              <EmptyState icon={ListChecks} title="No checklist" className="py-6" />
            ) : null}
          </Panel>

          <Panel
            title="Subtasks"
            description={t.subtasks.length ? `${t.subtasks.length - t.openSubtasks} of ${t.subtasks.length} closed` : undefined}
            action={t.can.addSubtask ? <Button variant="ghost" size="xs" onClick={() => setSubtaskOpen(true)}><Plus /> Add subtask</Button> : null}
          >
            {t.subtasks.length ? (
              <ul className="divide-y">
                {t.subtasks.map((st) => (
                  <li key={st.id}>
                    <Link href={`/tasks/${st.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                      <GitBranch className="size-4 text-muted-foreground" />
                      <span className="font-mono text-xs text-muted-foreground">{st.taskNumber}</span>
                      <span className="flex-1 truncate text-sm">{st.title}</span>
                      {st.owner ? <UserAvatar name={st.owner.name} size="sm" /> : null}
                      <TaskStatusBadge status={st.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={GitBranch} title="No subtasks" description={t.parentTask ? "Subtasks can't have their own subtasks." : undefined} className="py-6" />
            )}
            {t.openSubtasks > 0 && t.status === "IN_REVIEW" ? (
              <p className="border-t px-4 py-2 text-xs text-amber-700">This task can’t be approved until its {t.openSubtasks} open subtask(s) are closed.</p>
            ) : null}
          </Panel>

          {t.dependencies.length || t.dependents.length ? (
            <Panel title="Dependencies">
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                {[{ label: "Depends on", list: t.dependencies }, { label: "Blocks", list: t.dependents }].map(({ label, list }) => (
                  <div key={label}>
                    <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
                    {list.length ? (
                      <ul className="space-y-1.5">
                        {list.map((d) => (
                          <li key={d.id}>
                            <Link href={`/tasks/${d.id}`} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm hover:bg-muted/40">
                              <span className="font-mono text-xs text-muted-foreground">{d.taskNumber}</span>
                              <span className="flex-1 truncate">{d.title}</span>
                              <TaskStatusBadge status={d.status} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-muted-foreground">None</p>}
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel title="Attachments" description={t.attachments.length ? `${t.attachments.length} file(s)` : undefined}>
            <AttachmentsPanel items={t.attachments} uploadUrl={`/api/tasks/${t.id}/attachments`} canUpload={t.can.upload} onChanged={() => mutate()} />
          </Panel>

          <Panel title="Comments" description={`${t.comments.length} comment(s)`}>
            {t.comments.length ? (
              <ul className="divide-y">
                {t.comments.map((c) => (
                  <li key={c.id} className="flex gap-3 px-4 py-3">
                    <UserAvatar name={c.author?.name ?? "?"} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{c.author?.name}</span>
                        {c.kind !== "COMMENT" ? (
                          <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold uppercase", c.kind === "REVIEW" ? "bg-violet-100 text-violet-700" : "bg-red-100 text-red-700")}>
                            {c.kind === "REVIEW" ? "Review" : "Blocker"}
                          </span>
                        ) : null}
                        <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</span>
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={MessageSquare} title="No comments yet" className="py-6" />
            )}
            {t.can.comment ? (
              <form
                className="space-y-2 border-t p-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!comment.trim()) return;
                  if (await act("comment", () => api(`/api/tasks/${t.id}/comments`, { method: "POST", body: { body: comment.trim() } }), "Comment added")) setComment("");
                }}
              >
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Write a comment…" maxLength={5000} aria-label="Comment" />
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={!comment.trim() || busy === "comment"}>{busy === "comment" ? <Spinner /> : null} Comment</Button>
                </div>
              </form>
            ) : null}
          </Panel>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Panel title="Details" bodyClassName="divide-y">
            <Row label="Owner">{t.owner ? <Person name={t.owner.name} /> : "—"}</Row>
            <Row label="Department">
              {t.department ? <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ backgroundColor: t.department.color }} />{t.department.name}</span> : "—"}
            </Row>
            <Row label="Assigned by">{t.assignedBy?.name ?? "—"}</Row>
            <Row label="Collaborators">
              {t.collaborators.length ? <span className="flex flex-col items-end gap-1">{t.collaborators.map((c) => <Person key={c.id} name={c.name} />)}</span> : "—"}
            </Row>
            <Row label="Start">{formatDay(t.startDate)}</Row>
            <Row label="Due"><span className={t.isOverdue ? "text-red-600" : undefined}>{formatDay(t.dueDate)}</span></Row>
            <Row label="Milestone">{t.milestone?.title ?? "—"}</Row>
            <Row label="Estimated">{t.estimatedHours != null ? `${t.estimatedHours} h` : "—"}</Row>
            <Row label="Actual">
              {t.can.logHours ? (
                hours === null ? (
                  <button type="button" className="hover:text-primary" onClick={() => setHours(t.actualHours?.toString() ?? "")}>
                    {t.actualHours != null ? `${t.actualHours} h` : "Log hours"} <Pencil className="inline size-3" />
                  </button>
                ) : (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const v = hours.trim() === "" ? null : Number(hours);
                      if (v !== null && (!Number.isFinite(v) || v < 0)) return toast.error("Enter a valid number of hours");
                      if (await act("hours", () => api(`/api/tasks/${t.id}`, { method: "PATCH", body: { actualHours: v } }), "Hours saved")) setHours(null);
                    }}
                  >
                    <Input type="number" min={0} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} className="h-7 w-20" autoFocus aria-label="Actual hours" />
                    <Button size="xs" type="submit" disabled={busy === "hours"}>Save</Button>
                  </form>
                )
              ) : t.actualHours != null ? `${t.actualHours} h` : "—"}
            </Row>
            <Row label="Created by">{t.createdBy?.name ?? "—"}</Row>
            {t.completedAt ? <Row label="Completed">{dateFmt(t.completedAt)}</Row> : null}
          </Panel>

          {t.can.edit || t.can.reassign || t.can.reportBlocker ? (
            <Panel title="Actions" bodyClassName="flex flex-col gap-2 p-3">
              {t.can.edit ? <Button variant="outline" className="justify-start" onClick={() => setEditOpen(true)}><Pencil /> Edit task</Button> : null}
              {t.can.reassign && !["COMPLETED", "CANCELLED"].includes(t.status) ? <Button variant="outline" className="justify-start" onClick={() => setReassignOpen(true)}><UserRoundCog /> Reassign</Button> : null}
              {t.can.addSubtask ? <Button variant="outline" className="justify-start" onClick={() => setSubtaskOpen(true)}><GitBranch /> Add subtask</Button> : null}
              {t.can.reportBlocker && !t.blocker.isBlocked ? <Button variant="outline" className="justify-start border-red-200 text-red-700 hover:bg-red-50" onClick={() => setBlockerOpen(true)}><AlertOctagon /> Report blocker</Button> : null}
            </Panel>
          ) : null}

          <Panel title="Activity" bodyClassName="max-h-[520px] overflow-y-auto scrollbar-thin">
            {t.activity.length ? (
              <ol className="relative space-y-4 p-4 before:absolute before:top-5 before:bottom-5 before:left-[27px] before:w-px before:bg-border">
                {t.activity.map((a) => (
                  <li key={a.id} className="relative flex gap-3">
                    <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-card">
                      <History className="size-3 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 text-sm">
                      <p><span className="font-medium">{a.actor?.name ?? "System"}</span> <span className="text-muted-foreground">{a.message || humanize(a.action)}</span></p>
                      <p className="text-xs text-muted-foreground" title={format(new Date(a.createdAt), "PPpp")}>{formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon={Paperclip} title="No activity" className="py-6" />
            )}
          </Panel>
        </div>
      </div>

      <StatusDialog task={t} status={statusTarget} onOpenChange={(o) => !o && setStatusTarget(null)} onDone={() => mutate()} />
      <ReviewDialog taskId={t.id} decision={review} onOpenChange={(o) => !o && setReview(null)} onDone={() => mutate()} />
      <BlockerDialog taskId={t.id} open={blockerOpen} onOpenChange={setBlockerOpen} onDone={() => mutate()} />
      {t.can.edit ? <TaskFormDialog open={editOpen} onOpenChange={setEditOpen} task={t} onSaved={() => mutate()} /> : null}
      {t.can.reassign ? <ReassignDialog task={t} open={reassignOpen} onOpenChange={setReassignOpen} onDone={() => mutate()} /> : null}
      {t.can.addSubtask && t.project ? (
        <TaskFormDialog
          open={subtaskOpen}
          onOpenChange={setSubtaskOpen}
          projectId={t.project.id}
          departmentId={t.department?.id}
          parent={{ id: t.id, taskNumber: t.taskNumber, title: t.title }}
          onSaved={() => mutate()}
        />
      ) : null}
    </div>
  );
}
