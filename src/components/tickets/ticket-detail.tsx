"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlarmClock,
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileText,
  History,
  Inbox,
  Link2,
  MessageSquare,
  MessageSquareQuote,
  MessageSquareWarning,
  Package,
  Paperclip,
  Pencil,
  Play,
  RotateCcw,
  Send,
  UserRoundCog,
  UserRoundPlus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/dashboard/panel";
import { AttachmentsPanel, formatBytes } from "@/components/shared/attachments-panel";
import { DetailSkeleton } from "@/components/shared/skeletons";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { PriorityBadge, TaskStatusBadge } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { api, ApiClientError, fetcher } from "@/lib/http";
import { formatDay } from "@/lib/dates";
import { TICKET_STATUS_LABELS, type TicketStatus } from "@/lib/constants";
import { TICKET_ACTION_LABELS, type TicketAction } from "@/lib/ticket-workflow";
import { cn } from "@/lib/utils";
import type { AttachmentDTO, TicketDetailDTO } from "@/types/dto";
import { DeptChip, InternalRequestBadge, TicketStatusBadge } from "./ticket-badges";
import { ActionDialog, AssignDialog, EditTicketDialog } from "./ticket-dialogs";

type DialogAction = Exclude<TicketAction, "ASSIGN" | "REASSIGN" | "START_WORK">;

const ago = (d: string) => formatDistanceToNow(new Date(d), { addSuffix: true });
const stamp = (d: string) => format(new Date(d), "d MMM yyyy, HH:mm");

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
    <span className="inline-flex min-w-0 items-center gap-2">
      <UserAvatar name={name} size="sm" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Progress tracker                                                    */
/* ------------------------------------------------------------------ */

const STEPS: { key: TicketStatus; label: string }[] = [
  { key: "NEW", label: "Submitted" },
  { key: "UNDER_REVIEW", label: "Reviewed" },
  { key: "ASSIGNED", label: "Assigned" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CLOSED", label: "Closed" },
];

function currentStep(t: TicketDetailDTO): number {
  switch (t.status) {
    case "NEW":
      return 0;
    case "UNDER_REVIEW":
      return 1;
    case "ASSIGNED":
      return 2;
    case "IN_PROGRESS":
    case "CHANGES_REQUESTED":
      return 3;
    case "WAITING_FOR_INFO":
      return t.assignee ? 3 : 1;
    case "RESOLVED":
      return 4;
    case "CLOSED":
      return 5;
    default:
      return 0;
  }
}

function ProgressTracker({ t }: { t: TicketDetailDTO }) {
  if (t.status === "REJECTED") return null;
  const at = currentStep(t);
  const side = t.status === "WAITING_FOR_INFO" ? "Waiting for information" : t.status === "CHANGES_REQUESTED" ? "Changes requested" : null;
  return (
    <ol className="mt-5 grid grid-cols-6 gap-1" aria-label="Ticket progress">
      {STEPS.map((s, i) => {
        const done = i < at || t.status === "CLOSED";
        const current = i === at && t.status !== "CLOSED";
        return (
          <li key={s.key} className="min-w-0" aria-current={current ? "step" : undefined}>
            <div className={cn("h-1.5 rounded-full", done ? "bg-primary" : current ? (side ? "bg-amber-400" : "bg-primary/50") : "bg-muted")} />
            <p className={cn("mt-1.5 hidden items-center gap-1 truncate text-xs sm:flex", done || current ? "font-medium text-foreground" : "text-muted-foreground")}>
              {done ? <Check className="size-3 shrink-0 text-primary" /> : current ? <CircleDot className="size-3 shrink-0" /> : null}
              <span className="truncate">{current && side ? side : s.label}</span>
            </p>
          </li>
        );
      })}
      <li className="col-span-6 text-xs font-medium sm:hidden">
        Step {Math.min(at + 1, 6)} of 6 · {side ?? STEPS[at].label}
      </li>
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Deliverables                                                        */
/* ------------------------------------------------------------------ */

function DeliverableTile({ a }: { a: AttachmentDTO }) {
  const image = a.mimeType.startsWith("image/");
  return (
    <a href={a.url} download className="group block overflow-hidden rounded-lg border bg-card transition hover:border-primary/50">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated file route, not a static asset
        <img src={a.url} alt={a.fileName} className="h-36 w-full bg-muted/40 object-contain" loading="lazy" />
      ) : (
        <span className="flex h-36 items-center justify-center bg-muted/40"><FileText className="size-8 text-muted-foreground" /></span>
      )}
      <span className="flex items-center gap-2 border-t px-2.5 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium group-hover:text-primary">{a.fileName}</span>
        <span className="text-muted-foreground">{formatBytes(a.size)}</span>
        <Download className="size-3.5 text-muted-foreground" />
      </span>
    </a>
  );
}

const OUTCOME: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Awaiting requester review", cls: "bg-violet-100 text-violet-700" },
  ACCEPTED: { label: "Accepted", cls: "bg-emerald-100 text-emerald-700" },
  CHANGES_REQUESTED: { label: "Changes requested", cls: "bg-orange-100 text-orange-700" },
};

function ResolutionCard({ r, highlight }: { r: TicketDetailDTO["resolutions"][number]; highlight?: boolean }) {
  return (
    <div className={cn("space-y-3 p-4", highlight && "bg-violet-50/40")}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{r.round === 1 ? "Submission" : `Revision ${r.round}`}</span>
        <span className={cn("rounded-full px-2 py-px text-[11px] font-semibold", OUTCOME[r.outcome].cls)}>{OUTCOME[r.outcome].label}</span>
        <span className="text-xs text-muted-foreground" title={stamp(r.submittedAt)}>
          by {r.submittedBy?.name} · {ago(r.submittedAt)}
        </span>
      </div>
      {r.note ? <p className="text-sm whitespace-pre-wrap">{r.note}</p> : null}
      {r.deliverables.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {r.deliverables.map((d) => <DeliverableTile key={d.id} a={d} />)}
        </div>
      ) : null}
      {r.outcome !== "PENDING" && (r.feedback || r.reviewedBy) ? (
        <div className={cn("rounded-lg border p-2.5 text-sm", r.outcome === "ACCEPTED" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-orange-200 bg-orange-50 text-orange-900")}>
          <p className="text-xs font-medium">{r.reviewedBy?.name} · {r.reviewedAt ? ago(r.reviewedAt) : ""}</p>
          {r.feedback ? <p className="whitespace-pre-wrap">{r.feedback}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Thread & activity                                                   */
/* ------------------------------------------------------------------ */

const KIND_BADGE: Record<string, { label: string; cls: string } | undefined> = {
  INFO_REQUEST: { label: "Info requested", cls: "bg-amber-100 text-amber-800" },
  INFO_RESPONSE: { label: "Info provided", cls: "bg-sky-100 text-sky-700" },
  RESOLUTION: { label: "Resolution", cls: "bg-violet-100 text-violet-700" },
  CHANGE_REQUEST: { label: "Changes requested", cls: "bg-orange-100 text-orange-700" },
  CLOSURE: { label: "Closed", cls: "bg-emerald-100 text-emerald-700" },
  REJECTION: { label: "Rejected", cls: "bg-slate-200 text-slate-700" },
  REOPEN: { label: "Reopened", cls: "bg-orange-100 text-orange-700" },
  ASSIGNMENT: { label: "Assignment note", cls: "bg-slate-100 text-slate-700" },
};

const ACTIVITY_ICON: Record<string, typeof History> = {
  CREATED: Inbox,
  REVIEW_STARTED: ClipboardCheck,
  DEPARTMENT_ASSIGNED: UserRoundCog,
  ASSIGNED: UserRoundPlus,
  REASSIGNED: UserRoundCog,
  STATUS_CHANGED: CircleDot,
  COMMENTED: MessageSquare,
  INFO_REQUESTED: MessageSquareQuote,
  INFO_PROVIDED: MessageSquareQuote,
  ATTACHMENT_ADDED: Paperclip,
  ATTACHMENT_REMOVED: Paperclip,
  DELIVERABLE_UPLOADED: Package,
  RESOLVED: Send,
  CHANGES_REQUESTED: RotateCcw,
  CLOSED: CheckCircle2,
  REJECTED: XCircle,
  REOPENED: RotateCcw,
  UPDATED: Pencil,
};

/* ------------------------------------------------------------------ */

export function TicketDetail({ id }: { id: string }) {
  const params = useSearchParams();
  const { data: t, error, isLoading, mutate } = useSWR<TicketDetailDTO>(`/api/tickets/${id}`, fetcher);
  const [dialog, setDialog] = useState<DialogAction | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [reply, setReply] = useState("");

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
  if (isLoading || !t) return <DetailSkeleton />;

  const done = (next: TicketDetailDTO) => mutate(next, { revalidate: false });

  async function act(key: string, fn: () => Promise<TicketDetailDTO | unknown>, success?: string) {
    setBusy(key);
    try {
      const res = await fn();
      if (success) toast.success(success);
      if (res && typeof res === "object" && "ticketNumber" in res) await mutate(res as TicketDetailDTO, { revalidate: false });
      else await mutate();
      return true;
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Something went wrong");
      await mutate();
      return false;
    } finally {
      setBusy(null);
    }
  }

  function trigger(a: TicketAction) {
    if (a === "ASSIGN" || a === "REASSIGN") return setAssignOpen(true);
    if (a === "START_WORK") return act("start", () => api(`/api/tickets/${t!.id}/actions`, { method: "POST", body: { action: "START_WORK" } }), "Work started");
    setDialog(a);
  }

  const back = params.get("from") === "task" || (t.viewer.isAssignee && !t.viewer.isRequester)
    ? { href: "/my-tasks", label: "My Tasks" }
    : t.viewer.canMonitor && !t.viewer.isRequester
      ? { href: "/tickets", label: "Ticket Management" }
      : { href: "/my-tickets", label: "My Tickets" };
  const latest = t.resolutions[0];
  const lastChangeRequest = [...t.comments].reverse().find((c) => c.kind === "CHANGE_REQUEST" || c.kind === "REOPEN");
  const reviewing = t.status === "RESOLVED" && t.actions.includes("ACCEPT");
  // Actions shown inline elsewhere on the page aren't repeated in the header.
  const inline = new Set<TicketAction>([...(reviewing ? (["ACCEPT", "REQUEST_CHANGES"] as const) : []), ...(t.viewer.isRequester ? (["PROVIDE_INFO"] as const) : [])]);
  const headerActions = t.actions.filter((a) => !inline.has(a));
  const PRIMARY: TicketAction[] = ["ASSIGN", "START_WORK", "RESOLVE", "ACCEPT", "PROVIDE_INFO", "START_REVIEW"];

  return (
    <div className="space-y-6">
      <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {back.label}
      </Link>

      {/* Header */}
      <section className="rounded-xl border bg-card p-5 shadow-xs">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{t.ticketNumber}</span>
              <span>· {t.category.name}</span>
              {t.project ? <Link href={`/projects/${t.project.id}`} className="hover:text-primary">· {t.project.name}</Link> : null}
            </div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <TicketStatusBadge status={t.status} />
              <PriorityBadge priority={t.priority} />
              {t.isOverdue ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"><AlarmClock className="size-3" /> Overdue</span>
              ) : null}
              {t.viewer.isAssignee && t.linkedTask ? <InternalRequestBadge ticketNumber={t.ticketNumber} /> : null}
              {t.reopenCount ? <span className="text-xs text-muted-foreground">Reopened {t.reopenCount}×</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {headerActions.map((a) => {
              const primary = PRIMARY.includes(a);
              const danger = a === "REJECT";
              return (
                <Button
                  key={a}
                  variant={primary ? "default" : danger ? "ghost" : "outline"}
                  className={danger ? "text-destructive hover:bg-destructive/10 hover:text-destructive" : undefined}
                  onClick={() => trigger(a)}
                  disabled={busy === "start" && a === "START_WORK"}
                >
                  {busy === "start" && a === "START_WORK" ? <Spinner /> : a === "START_WORK" ? <Play /> : a === "ASSIGN" ? <UserRoundPlus /> : a === "REASSIGN" ? <UserRoundCog /> : a === "RESOLVE" ? <Send /> : a === "REJECT" ? <Ban /> : a === "REOPEN" ? <RotateCcw /> : null}
                  {a === "START_WORK" && t.status === "CHANGES_REQUESTED" ? "Start revisions" : TICKET_ACTION_LABELS[a]}
                </Button>
              );
            })}
            {t.can.edit ? <Button variant="ghost" size="icon" aria-label="Edit ticket" onClick={() => setEditOpen(true)}><Pencil /></Button> : null}
          </div>
        </div>

        <ProgressTracker t={t} />

        {/* Contextual banners */}
        <div className="mt-4 space-y-2 empty:hidden">
          {t.infoRequest ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="flex gap-3">
                <MessageSquareQuote className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {t.viewer.isRequester ? `${t.infoRequest.requestedBy?.name} needs more information from you` : `Waiting for ${t.requester?.name} to respond`}
                    {t.infoRequest.requestedAt ? <span className="font-normal text-amber-800/80"> · {ago(t.infoRequest.requestedAt)}</span> : null}
                  </p>
                  <p className="whitespace-pre-wrap">{t.infoRequest.message}</p>
                </div>
              </div>
              {t.viewer.isRequester && t.actions.includes("PROVIDE_INFO") ? (
                <form
                  className="mt-3 space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (reply.trim().length < 3) return;
                    if (await act("reply", () => api(`/api/tickets/${t.id}/actions`, { method: "POST", body: { action: "PROVIDE_INFO", message: reply.trim() } }), "Response sent")) setReply("");
                  }}
                >
                  <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Your answer…" className="bg-white" aria-label="Your response" maxLength={5000} />
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={reply.trim().length < 3 || busy === "reply"}>{busy === "reply" ? <Spinner /> : <Send />} Send response</Button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}
          {t.status === "CHANGES_REQUESTED" && lastChangeRequest ? (
            <div className="flex gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
              <MessageSquareWarning className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Changes requested by {lastChangeRequest.author?.name} · {ago(lastChangeRequest.createdAt)}</p>
                <p className="whitespace-pre-wrap">{lastChangeRequest.body}</p>
              </div>
            </div>
          ) : null}
          {t.status === "RESOLVED" && !reviewing ? (
            <div className="flex gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
              <ClipboardCheck className="mt-0.5 size-4 shrink-0" />
              <p>Submitted {t.resolvedAt ? ago(t.resolvedAt) : ""} · waiting for {t.requester?.name} to confirm completion or request changes.</p>
            </div>
          ) : null}
          {t.status === "ASSIGNED" && t.viewer.isAssignee ? (
            <div className="flex gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              <Play className="mt-0.5 size-4 shrink-0" />
              <p>This request is assigned to you. Click <span className="font-medium">Start work</span> when you begin — the requester is notified.</p>
            </div>
          ) : null}
          {t.closure ? (
            <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">
                  {t.closure.byManager ? `Closed by ${t.closure.closedBy?.name} on the requester's behalf` : `Completion confirmed by ${t.closure.closedBy?.name}`}
                  {t.closure.closedAt ? ` · ${stamp(t.closure.closedAt)}` : ""}
                </p>
                {t.closure.note ? <p className="whitespace-pre-wrap">{t.closure.note}</p> : null}
              </div>
            </div>
          ) : null}
          {t.rejection ? (
            <div className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Rejected by {t.rejection.rejectedBy?.name}{t.rejection.rejectedAt ? ` · ${stamp(t.rejection.rejectedAt)}` : ""}</p>
                <p className="whitespace-pre-wrap">{t.rejection.reason}</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Resolution review (requester) */}
      {reviewing && latest ? (
        <section className="overflow-hidden rounded-xl border-2 border-violet-200 bg-card shadow-xs">
          <header className="flex flex-col gap-3 border-b bg-violet-50/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Review the delivered work</h2>
              <p className="text-xs text-muted-foreground">{t.assignee?.name ?? "The assignee"} submitted this as resolved. Confirm completion to close the ticket, or request changes.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50" onClick={() => setDialog("REQUEST_CHANGES")}><RotateCcw /> Request changes</Button>
              <Button onClick={() => setDialog("ACCEPT")}><CheckCircle2 /> Confirm completion</Button>
            </div>
          </header>
          <ResolutionCard r={latest} highlight />
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Request">
            <div className="space-y-4 px-4 py-3">
              <p className="text-sm whitespace-pre-wrap">{t.description}</p>
              {t.referenceLinks.length ? (
                <div>
                  <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Reference links</p>
                  <ul className="space-y-1">
                    {t.referenceLinks.map((l) => (
                      <li key={l}>
                        <a href={l} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1.5 text-sm text-primary hover:underline">
                          <Link2 className="size-3.5 shrink-0" />
                          <span className="truncate">{l}</span>
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel
            title="Deliverables"
            description={t.resolutions.length ? `${t.resolutions.length} submission${t.resolutions.length === 1 ? "" : "s"}` : "Work delivered by the assignee"}
          >
            {t.can.uploadDeliverable || t.draftDeliverables.length ? (
              <div className="border-b">
                <p className="px-4 pt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t.can.uploadDeliverable ? "Ready to submit" : "Uploaded, not yet submitted"}
                </p>
                <AttachmentsPanel
                  items={t.draftDeliverables}
                  uploadUrl={`/api/tickets/${t.id}/deliverables`}
                  canUpload={t.can.uploadDeliverable}
                  onChanged={() => mutate()}
                  emptyText="Upload the finished work, then submit it as resolved"
                />
                {t.can.uploadDeliverable && t.actions.includes("RESOLVE") ? (
                  <div className="flex justify-end border-t px-4 py-3">
                    <Button onClick={() => setDialog("RESOLVE")}>
                      <Send /> Submit as resolved
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {t.resolutions.length ? (
              <div className="divide-y">
                {t.resolutions.map((r, i) => (reviewing && i === 0 ? null : <ResolutionCard key={r.id} r={r} />))}
                {reviewing && t.resolutions.length === 1 ? <p className="px-4 py-3 text-sm text-muted-foreground">The submission is shown in the review panel above.</p> : null}
              </div>
            ) : !t.can.uploadDeliverable ? (
              <EmptyState icon={Package} title="Nothing delivered yet" description={t.assignee ? `${t.assignee.name} uploads the work here when it's ready.` : "Deliverables appear here once someone is assigned and submits work."} className="py-8" />
            ) : null}
          </Panel>

          <Panel title="Attachments" description="Briefs, references and supporting files">
            <AttachmentsPanel items={t.attachments} uploadUrl={`/api/tickets/${t.id}/attachments`} canUpload={t.can.upload} onChanged={() => mutate()} emptyText="No attachments" />
          </Panel>

          <Panel title="Conversation" description={`${t.comments.length} message${t.comments.length === 1 ? "" : "s"}`}>
            {t.comments.length ? (
              <ul className="divide-y">
                {t.comments.map((c) => {
                  const badge = KIND_BADGE[c.kind];
                  return (
                    <li key={c.id} className="flex gap-3 px-4 py-3">
                      <UserAvatar name={c.author?.name ?? "?"} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium">{c.author?.name}</span>
                          {c.author?.id === t.requester?.id ? <span className="text-xs text-muted-foreground">Requester</span> : c.author?.id === t.assignee?.id ? <span className="text-xs text-muted-foreground">Assignee</span> : null}
                          {badge ? <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold uppercase", badge.cls)}>{badge.label}</span> : null}
                          <span className="text-xs text-muted-foreground" title={stamp(c.createdAt)}>{ago(c.createdAt)}</span>
                        </p>
                        <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={MessageSquare} title="No messages yet" className="py-6" />
            )}
            {t.can.comment ? (
              <form
                className="space-y-2 border-t p-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!comment.trim()) return;
                  if (await act("comment", () => api(`/api/tickets/${t.id}/comments`, { method: "POST", body: { body: comment.trim() } }), "Comment added")) setComment("");
                }}
              >
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Write a comment…" maxLength={5000} aria-label="Comment" />
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={!comment.trim() || busy === "comment"}>{busy === "comment" ? <Spinner /> : null} Comment</Button>
                </div>
              </form>
            ) : t.status === "CLOSED" || t.status === "REJECTED" ? (
              <p className="border-t px-4 py-3 text-xs text-muted-foreground">This ticket is {TICKET_STATUS_LABELS[t.status].toLowerCase()}. Reopen it to continue the conversation.</p>
            ) : null}
          </Panel>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Panel title="Details" bodyClassName="divide-y">
            <Row label="Requester">{t.requester ? <Person name={t.requester.name} /> : "—"}</Row>
            <Row label="From"><DeptChip dept={t.requestingDepartment} /></Row>
            <Row label="To"><DeptChip dept={t.targetDepartment} /></Row>
            <Row label="Category">{t.category.name}</Row>
            <Row label="Project">{t.project ? <Link href={`/projects/${t.project.id}`} className="hover:text-primary">{t.project.name}</Link> : "—"}</Row>
            <Row label="Priority"><PriorityBadge priority={t.priority} /></Row>
            <Row label="Required by"><span className={t.isOverdue ? "text-red-600" : undefined}>{formatDay(t.dueDate)}</span></Row>
            <Row label="Created"><span title={stamp(t.createdAt)}>{format(new Date(t.createdAt), "d MMM yyyy")}</span></Row>
            <Row label="Assigned to">{t.assignee ? <Person name={t.assignee.name} /> : <span className="text-muted-foreground">Unassigned</span>}</Row>
            {t.assignedBy ? <Row label="Assigned by">{t.assignedBy.name}</Row> : null}
            {t.linkedTask ? (
              <Row label="Work item">
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono text-xs">{t.linkedTask.taskNumber}</span>
                  {t.linkedTaskStatus ? <TaskStatusBadge status={t.linkedTaskStatus} /> : null}
                </span>
              </Row>
            ) : null}
            {t.startedAt ? <Row label="Started">{format(new Date(t.startedAt), "d MMM yyyy")}</Row> : null}
          </Panel>

          {t.assignments.length ? (
            <Panel title="Assignment history">
              <ol className="divide-y">
                {t.assignments.map((a) => (
                  <li key={a.id} className="flex gap-3 px-4 py-3">
                    <UserAvatar name={a.employee?.name ?? "?"} size="sm" />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{a.employee?.name}</span>
                        {!a.endedAt ? (
                          <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-semibold text-emerald-700 uppercase">Current</span>
                        ) : (
                          <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground uppercase">{a.endReason === "REJECTED" ? "Ended · rejected" : "Reassigned"}</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.department?.name} · by {a.assignedBy?.name} · {format(new Date(a.assignedAt), "d MMM, HH:mm")}
                        {a.endedAt ? ` → ${format(new Date(a.endedAt), "d MMM, HH:mm")}` : ""}
                      </p>
                      {a.note ? <p className="mt-1 text-xs whitespace-pre-wrap">“{a.note}”</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          ) : null}

          <Panel title="Activity" bodyClassName="max-h-[560px] overflow-y-auto scrollbar-thin">
            <ol className="relative space-y-4 p-4 before:absolute before:top-5 before:bottom-5 before:left-[27px] before:w-px before:bg-border">
              {t.activity.map((a) => {
                const Icon = ACTIVITY_ICON[a.action] ?? History;
                return (
                  <li key={a.id} className="relative flex gap-3">
                    <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-card">
                      <Icon className="size-3 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 text-sm">
                      <p><span className="font-medium">{a.actor?.name ?? "System"}</span> <span className="text-muted-foreground">{a.message}</span></p>
                      <p className="text-xs text-muted-foreground" title={stamp(a.createdAt)}>{stamp(a.createdAt)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Panel>
        </div>
      </div>

      <ActionDialog ticket={t} action={dialog} onOpenChange={(o) => !o && setDialog(null)} onDone={done} />
      {t.actions.includes("ASSIGN") || t.actions.includes("REASSIGN") ? (
        <AssignDialog ticket={t} open={assignOpen} onOpenChange={setAssignOpen} onDone={done} />
      ) : null}
      {t.can.edit ? <EditTicketDialog ticket={t} open={editOpen} onOpenChange={setEditOpen} onDone={done} /> : null}
    </div>
  );
}
