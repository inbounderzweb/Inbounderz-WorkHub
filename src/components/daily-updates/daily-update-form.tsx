"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { FormRow } from "@/components/shared/form-row";
import { formatBytes } from "@/components/shared/attachments-panel";
import { useSettings } from "@/components/providers/user-provider";
import { api, ApiClientError, fetcher, uploadFile } from "@/lib/http";
import { todayIn } from "@/lib/settings-types";
import type { DailyUpdateDTO } from "@/types/dto";

const NONE = "__none";
const MAX = 10 * 1024 * 1024;
type Options = { projects: { id: string; name: string; code: string; tasks: { id: string; taskNumber: string; title: string }[] }[] };
type Values = { date: string; project: string; task: string; workCompleted: string; pendingWork: string; blockers: string; hoursSpent: string };

/**
 * Create a report, or edit an existing one (author only). Editing a report that
 * had changes requested resubmits it for review.
 */
export function DailyUpdateFormDialog({
  open,
  onOpenChange,
  report,
  onSaved,
  onOpenExisting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  report?: DailyUpdateDTO | null;
  onSaved: (id: string) => void;
  onOpenExisting: (id: string) => void;
}) {
  const settings = useSettings();
  const tz = settings?.company.timezone ?? "UTC";
  const today = todayIn(tz);
  const earliest = new Date(new Date(`${today}T00:00:00Z`).getTime() - (settings?.dailyUpdates.backdateDays ?? 7) * 86400000).toISOString().slice(0, 10);
  const editing = !!report;
  const blank = (): Values => ({ date: today, project: "", task: "", workCompleted: "", pendingWork: "", blockers: "", hoursSpent: "" });
  const [v, setV] = useState<Values>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [existingId, setExistingId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: options, isLoading } = useSWR<Options>(open && !editing ? "/api/daily-updates/options" : null, fetcher);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
    setV(
      report
        ? { date: report.date, project: report.project?.id ?? "", task: report.task?.id ?? "", workCompleted: report.workCompleted, pendingWork: report.pendingWork, blockers: report.blockers, hoursSpent: String(report.hoursSpent) }
        : blank()
    );
    setErrors({});
    setExistingId(null);
    setFiles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report]);

  const set = (k: keyof Values) => (val: string) => setV((cur) => ({ ...cur, [k]: val, ...(k === "project" ? { task: "" } : {}) }));
  const project = options?.projects.find((p) => p.id === v.project);

  async function submit() {
    const errs: Record<string, string> = {};
    if (!editing && !v.project) errs.project = "Choose the project you worked on";
    if (v.workCompleted.trim().length < 5) errs.workCompleted = "Describe the work you completed";
    const hours = Number(v.hoursSpent);
    if (!v.hoursSpent || !Number.isFinite(hours) || hours < 0.25 || hours > 24) errs.hoursSpent = "Enter between 0.25 and 24 hours";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    setExistingId(null);
    try {
      let id: string;
      if (editing) {
        await api(`/api/daily-updates/${report!.id}`, {
          method: "PATCH",
          body: { workCompleted: v.workCompleted, pendingWork: v.pendingWork, blockers: v.blockers, hoursSpent: hours },
        });
        id = report!.id;
      } else {
        const res = await api<{ id: string }>("/api/daily-updates", {
          method: "POST",
          body: { date: v.date, project: v.project, task: v.task || null, workCompleted: v.workCompleted, pendingWork: v.pendingWork, blockers: v.blockers, hoursSpent: hours },
        });
        id = res.id;
      }
      let failed = 0;
      for (const f of files) {
        try {
          await uploadFile(`/api/daily-updates/${id}/attachments`, f);
        } catch (err) {
          failed++;
          toast.error(err instanceof ApiClientError ? `${f.name}: ${err.message}` : `${f.name} failed to upload`);
        }
      }
      toast.success(editing ? (report!.status === "CHANGES_REQUESTED" ? "Report resubmitted for review" : "Report updated") : "Daily report submitted", {
        description: failed ? `${failed} attachment(s) failed — add them from the report.` : undefined,
      });
      onOpenChange(false);
      onSaved(id);
    } catch (err) {
      if (err instanceof ApiClientError) {
        const fe = { ...(err.fieldErrors ?? {}) };
        if (fe.existingId) setExistingId(fe.existingId);
        delete fe.existingId;
        setErrors(fe);
        toast.error(err.message);
      } else toast.error("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? (report!.status === "CHANGES_REQUESTED" ? "Update and resubmit report" : "Edit daily report") : "Submit daily report"}</DialogTitle>
          <DialogDescription>
            {editing
              ? `${report!.date} · ${report!.project?.name ?? ""}${report!.task ? ` · ${report!.task.taskNumber}` : ""}`
              : "One report per project (or task) per day. Your Department Head reviews it."}
          </DialogDescription>
        </DialogHeader>

        {existingId ? (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">You already reported this work item for {v.date}.</p>
              <p>Open the existing report to edit it instead of creating a duplicate.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => { onOpenChange(false); onOpenExisting(existingId); }}>Open report</Button>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {!editing ? (
            <>
              <FormRow label="Date" htmlFor="du-date" required error={errors.date}>
                <Input id="du-date" type="date" value={v.date} min={earliest} max={today} onChange={(e) => set("date")(e.target.value)} />
              </FormRow>
              <FormRow label="Hours spent" htmlFor="du-hours" required error={errors.hoursSpent}>
                <Input id="du-hours" type="number" min={0.25} max={24} step={0.25} inputMode="decimal" value={v.hoursSpent} onChange={(e) => set("hoursSpent")(e.target.value)} placeholder="e.g. 3.5" />
              </FormRow>
              <FormRow label="Project" htmlFor="du-project" required error={errors.project} className="sm:col-span-2">
                <Select value={v.project || undefined} onValueChange={set("project")} disabled={isLoading}>
                  <SelectTrigger id="du-project" className="w-full" aria-invalid={!!errors.project}>
                    <SelectValue placeholder={isLoading ? "Loading…" : options && !options.projects.length ? "You're not on any project team" : "Select a project"} />
                  </SelectTrigger>
                  <SelectContent>
                    {options?.projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}><span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
              <FormRow label="Related task" htmlFor="du-task" error={errors.task} className="sm:col-span-2" description={v.project && !project?.tasks.length ? "You have no open tasks in this project." : "Optional."}>
                <Select value={v.task || NONE} onValueChange={(x) => set("task")(x === NONE ? "" : x)} disabled={!project?.tasks.length}>
                  <SelectTrigger id="du-task" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No specific task</SelectItem>
                    {project?.tasks.map((t) => (
                      <SelectItem key={t.id} value={t.id}><span className="font-mono text-xs text-muted-foreground">{t.taskNumber}</span> {t.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
            </>
          ) : (
            <FormRow label="Hours spent" htmlFor="du-hours" required error={errors.hoursSpent}>
              <Input id="du-hours" type="number" min={0.25} max={24} step={0.25} value={v.hoursSpent} onChange={(e) => set("hoursSpent")(e.target.value)} />
            </FormRow>
          )}
          <FormRow label="Work completed" htmlFor="du-done" required error={errors.workCompleted} className="sm:col-span-2">
            <Textarea id="du-done" rows={4} maxLength={5000} value={v.workCompleted} onChange={(e) => set("workCompleted")(e.target.value)} placeholder="What you finished today" />
          </FormRow>
          <FormRow label="Pending work" htmlFor="du-pending" error={errors.pendingWork} className="sm:col-span-2">
            <Textarea id="du-pending" rows={2} maxLength={3000} value={v.pendingWork} onChange={(e) => set("pendingWork")(e.target.value)} placeholder="What's left / planned next" />
          </FormRow>
          <FormRow label="Blockers" htmlFor="du-blockers" error={errors.blockers} className="sm:col-span-2">
            <Textarea id="du-blockers" rows={2} maxLength={2000} value={v.blockers} onChange={(e) => set("blockers")(e.target.value)} placeholder="Anything stopping you (leave empty if none)" />
          </FormRow>
          <FormRow label="Supporting attachments" htmlFor="du-files" className="sm:col-span-2" description="Screenshots, documents · up to 10 MB each.">
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}><Paperclip /> Add files</Button>
              <input
                id="du-files"
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const next = Array.from(e.target.files ?? []).filter((f) => (f.size > MAX ? (toast.error(`${f.name} is larger than 10 MB`), false) : true));
                  setFiles((cur) => [...cur, ...next].slice(0, 10));
                  e.target.value = "";
                }}
              />
              {files.length ? (
                <ul className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                      <Paperclip className="size-3.5 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}><Trash2 /></Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </FormRow>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Spinner /> : null}
            {editing ? (report!.status === "CHANGES_REQUESTED" ? "Resubmit" : "Save changes") : "Submit report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
