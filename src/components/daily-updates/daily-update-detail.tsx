"use client";

import { useState } from "react";
import useSWR from "swr";
import { format, formatDistanceToNow } from "date-fns";
import { AlertOctagon, CheckCircle2, Clock, History, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentsPanel } from "@/components/shared/attachments-panel";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { api, ApiClientError, fetcher } from "@/lib/http";
import { formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { DailyUpdateDetailDTO, DailyUpdateDTO } from "@/types/dto";

export const DU_STATUS: Record<DailyUpdateDTO["status"], { label: string; cls: string }> = {
  SUBMITTED: { label: "Awaiting review", cls: "border-violet-200 bg-violet-50 text-violet-700" },
  APPROVED: { label: "Approved", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  CHANGES_REQUESTED: { label: "Changes requested", cls: "border-orange-200 bg-orange-50 text-orange-700" },
};

export function DailyStatusBadge({ status }: { status: DailyUpdateDTO["status"] }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", DU_STATUS[status].cls)}>{DU_STATUS[status].label}</span>;
}

const HISTORY_LABEL: Record<string, string> = {
  SUBMITTED: "submitted the report",
  EDITED: "edited the report",
  RESUBMITTED: "updated and resubmitted",
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
};

function Block({ label, text, tone }: { label: string; text: string; tone?: "warn" }) {
  if (!text) return null;
  return (
    <div className={cn("space-y-1", tone === "warn" && "rounded-lg border border-red-200 bg-red-50 p-3 text-red-900")}>
      <p className={cn("text-xs font-medium tracking-wide uppercase", tone === "warn" ? "text-red-800" : "text-muted-foreground")}>
        {tone === "warn" ? <AlertOctagon className="mr-1 inline size-3.5" /> : null}
        {label}
      </p>
      <p className="text-sm whitespace-pre-wrap">{text}</p>
    </div>
  );
}

export function DailyUpdateDetailSheet({
  id,
  onOpenChange,
  onEdit,
  onChanged,
}: {
  id: string | null;
  onOpenChange: (o: boolean) => void;
  onEdit: (r: DailyUpdateDTO) => void;
  onChanged: () => void;
}) {
  const { data: r, error, isLoading, mutate } = useSWR<DailyUpdateDetailDTO>(id ? `/api/daily-updates/${id}` : null, fetcher);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function review(decision: "APPROVE" | "REQUEST_CHANGES") {
    if (decision === "REQUEST_CHANGES" && comment.trim().length < 3) return toast.error("Explain what needs to change");
    setBusy(decision);
    try {
      const next = await api<DailyUpdateDetailDTO>(`/api/daily-updates/${id}/review`, { method: "POST", body: { decision, comment: comment.trim() } });
      await mutate(next, { revalidate: false });
      setComment("");
      toast.success(decision === "APPROVE" ? "Report approved" : "Changes requested");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Something went wrong");
      mutate();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>{r ? `Daily report · ${formatDay(r.date, "EEE d MMM yyyy")}` : "Daily report"}</SheetTitle>
          <SheetDescription>{r ? `${r.user?.name ?? ""}${r.department ? ` · ${r.department.name}` : ""}` : "Loading…"}</SheetDescription>
        </SheetHeader>

        {error ? (
          <ErrorState title={error.status === 404 ? "Report not found" : "Couldn't load this report"} message={error.status === 404 ? "It was deleted or you don't have access to it." : error.message} />
        ) : isLoading || !r ? (
          <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : (
          <div className="space-y-5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <DailyStatusBadge status={r.status} />
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Clock className="size-3.5" /> {r.hoursSpent} h</span>
              {r.revision > 1 ? <span className="text-xs text-muted-foreground">Revision {r.revision}</span> : null}
              <span className="ml-auto flex gap-1">
                {r.can.edit ? <Button size="sm" variant="outline" onClick={() => onEdit(r)}><Pencil /> {r.status === "CHANGES_REQUESTED" ? "Update & resubmit" : "Edit"}</Button> : null}
                {r.can.delete ? <Button size="icon-sm" variant="ghost" aria-label="Delete report" onClick={() => setConfirmDelete(true)}><Trash2 /></Button> : null}
              </span>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Project</dt>
              <dd className="font-medium">{r.project ? `${r.project.code} · ${r.project.name}` : "—"}</dd>
              <dt className="text-muted-foreground">Task</dt>
              <dd>{r.task ? `${r.task.taskNumber} · ${r.task.title}` : "—"}</dd>
              <dt className="text-muted-foreground">Submitted</dt>
              <dd>{format(new Date(r.submittedAt), "d MMM yyyy, HH:mm")}</dd>
            </dl>

            {r.status === "CHANGES_REQUESTED" && r.reviewComment ? (
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                <p className="font-medium">{r.reviewedBy?.name} requested changes</p>
                <p className="whitespace-pre-wrap">{r.reviewComment}</p>
              </div>
            ) : null}
            {r.status === "APPROVED" ? (
              <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <p>Approved by {r.reviewedBy?.name}{r.reviewedAt ? ` · ${format(new Date(r.reviewedAt), "d MMM, HH:mm")}` : ""}{r.reviewComment ? ` — ${r.reviewComment}` : ""}</p>
              </div>
            ) : null}

            <Block label="Work completed" text={r.workCompleted} />
            <Block label="Pending work" text={r.pendingWork} />
            <Block label="Blockers" text={r.blockers} tone="warn" />

            <div className="overflow-hidden rounded-lg border">
              <p className="border-b px-3 py-2 text-sm font-medium">Attachments</p>
              <AttachmentsPanel items={r.attachments} uploadUrl={`/api/daily-updates/${r.id}/attachments`} canUpload={r.canUpload} onChanged={() => { mutate(); onChanged(); }} emptyText="No attachments" />
            </div>

            {r.can.review ? (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">Review</p>
                <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="Feedback (required when requesting changes)" aria-label="Review comment" />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50" disabled={!!busy} onClick={() => review("REQUEST_CHANGES")}>
                    {busy === "REQUEST_CHANGES" ? <Spinner /> : <RotateCcw />} Request changes
                  </Button>
                  <Button disabled={!!busy} onClick={() => review("APPROVE")}>{busy === "APPROVE" ? <Spinner /> : <CheckCircle2 />} Approve</Button>
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><History className="size-4" /> History</p>
              <ol className="space-y-2">
                {r.history.map((h, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <UserAvatar name={h.by?.name ?? "?"} size="sm" />
                    <div>
                      <p><span className="font-medium">{h.by?.name}</span> <span className="text-muted-foreground">{HISTORY_LABEL[h.action] ?? h.action}</span></p>
                      {h.comment ? <p className="text-xs whitespace-pre-wrap">“{h.comment}”</p> : null}
                      <p className="text-xs text-muted-foreground" title={format(new Date(h.at), "PPpp")}>{formatDistanceToNow(new Date(h.at), { addSuffix: true })}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this report?"
          description="It hasn't been reviewed yet, so it can be removed. This can't be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            try {
              await api(`/api/daily-updates/${id}`, { method: "DELETE" });
              toast.success("Report deleted");
              onOpenChange(false);
              onChanged();
            } catch (err) {
              toast.error(err instanceof ApiClientError ? err.message : "Couldn't delete the report");
              return false;
            }
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
