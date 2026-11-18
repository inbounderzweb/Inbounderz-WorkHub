"use client";

import { useState } from "react";
import { ListChecks, Minus, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/dashboard/panel";
import { FormRow } from "@/components/shared/form-row";
import { DELIVERABLE_STATUS_LABELS, type DeliverableStatus } from "@/lib/constants";
import { deliverableSummary } from "@/lib/deliverables";
import { cn } from "@/lib/utils";
import type { DeliverableDTO, TicketDetailDTO } from "@/types/dto";
import { DeliverablesEditor, type DeliverableDraft } from "./deliverables-editor";

type RunAction = (key: string, body: Record<string, unknown>, success?: string) => Promise<boolean>;

const STATUS_STYLE: Record<DeliverableStatus, string> = {
  NOT_STARTED: "border-muted bg-muted/40 text-muted-foreground",
  IN_PROGRESS: "border-blue-200 bg-blue-50 text-blue-700",
  AWAITING_VERIFICATION: "border-violet-200 bg-violet-50 text-violet-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export function DeliverableStatusBadge({ status }: { status: DeliverableStatus }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>
      {DELIVERABLE_STATUS_LABELS[status]}
    </span>
  );
}

/** Verified items in solid green, done-but-unverified in a lighter shade. */
export function DeliverableBar({ quantity, completed, verified, className }: { quantity: number; completed: number; verified: number; className?: string }) {
  const pct = (n: number) => `${Math.min(100, Math.round((n / Math.max(1, quantity)) * 100))}%`;
  return (
    <div
      className={cn("relative h-2 overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={quantity}
      aria-valuenow={verified}
      aria-valuetext={`${completed} of ${quantity} done, ${verified} verified`}
    >
      <div className="absolute inset-y-0 left-0 bg-emerald-300" style={{ width: pct(completed) }} />
      <div className="absolute inset-y-0 left-0 bg-emerald-600" style={{ width: pct(verified) }} />
    </div>
  );
}

function Stepper({ id, value, min, max, onChange, label }: { id: string; value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? Math.floor(n) : min));
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" size="icon-sm" onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={`Decrease ${label}`}><Minus /></Button>
      <Input id={id} type="number" inputMode="numeric" className="h-8 w-16 text-center tabular-nums" min={min} max={max} step={1} value={value} onChange={(e) => onChange(clamp(Number(e.target.value)))} aria-label={label} />
      <Button type="button" variant="outline" size="icon-sm" onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label={`Increase ${label}`}><Plus /></Button>
      <span className="ml-1 text-sm text-muted-foreground tabular-nums">/ {max}</span>
    </div>
  );
}

export function DeliverablesPanel({ ticket, run, busy }: { ticket: TicketDetailDTO; run: RunAction; busy: boolean }) {
  const [progressOpen, setProgressOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const list = ticket.deliverables;
  const { can } = ticket;
  if (!list.length && !can.changeDeliverables) return null;
  const sum = deliverableSummary(list);

  return (
    <Panel
      title="Deliverables"
      description={list.length ? `${sum.verified} of ${sum.requested} items verified · ${sum.completed} done` : "No deliverables were listed for this ticket"}
      action={
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {can.recordProgress && list.length ? <Button size="sm" onClick={() => setProgressOpen(true)} disabled={busy}><ListChecks /> Update progress</Button> : null}
          {can.changeDeliverables ? <Button size="sm" variant="outline" onClick={() => setChangeOpen(true)} disabled={busy}><Pencil /> {list.length ? "Change" : "Add"}</Button> : null}
        </div>
      }
    >
      {list.length ? (
        <ul className="divide-y">
          {list.map((d) => (
            <li key={d.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-sm font-medium">
                  {d.type} <span className="font-normal text-muted-foreground">× {d.quantity}</span>
                </p>
                <DeliverableStatusBadge status={d.status} />
              </div>
              <DeliverableBar quantity={d.quantity} completed={d.completedQuantity} verified={d.verifiedQuantity} />
              <p className="text-xs text-muted-foreground tabular-nums">
                {d.completedQuantity}/{d.quantity} done · {d.verifiedQuantity}/{d.quantity} verified
              </p>
              {d.specifications ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{d.specifications}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Add deliverables so progress can be tracked per item.</p>
      )}

      {progressOpen ? <ProgressDialog key={ticket.updatedAt} list={list} onClose={() => setProgressOpen(false)} run={run} /> : null}
      {changeOpen ? <ChangeDialog key={ticket.updatedAt} list={list} onClose={() => setChangeOpen(false)} run={run} /> : null}
    </Panel>
  );
}

function ProgressDialog({ list, onClose, run }: { list: DeliverableDTO[]; onClose: () => void; run: RunAction }) {
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(list.map((d) => [d.id, d.completedQuantity])));
  const [pending, setPending] = useState(false);
  const changed = list.filter((d) => counts[d.id] !== d.completedQuantity);
  async function save() {
    setPending(true);
    const ok = await run("record_progress", { action: "record_progress", items: changed.map((d) => ({ id: d.id, completedQuantity: counts[d.id] })) }, "Progress saved");
    setPending(false);
    if (ok) onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !pending && !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Update progress</DialogTitle>
          <DialogDescription>How many of each are finished? Every requested quantity must be reached before you can submit for review.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-3">
          {list.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={`pg-${d.id}`} className="min-w-0 text-sm font-medium">
                {d.type}
                {d.verifiedQuantity ? <span className="block text-xs font-normal text-muted-foreground">{d.verifiedQuantity} already verified</span> : null}
              </label>
              <Stepper id={`pg-${d.id}`} label={`${d.type} completed`} value={counts[d.id]} min={d.verifiedQuantity} max={d.quantity} onChange={(n) => setCounts((c) => ({ ...c, [d.id]: n }))} />
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending || !changed.length}>{pending ? <Spinner /> : null} Save progress</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeDialog({ list, onClose, run }: { list: DeliverableDTO[]; onClose: () => void; run: RunAction }) {
  const [rows, setRows] = useState<DeliverableDraft[]>(() => list.map((d) => ({ id: d.id, type: d.type, quantity: d.quantity, specifications: d.specifications })));
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const completedById = Object.fromEntries(list.map((d) => [d.id, d.completedQuantity]));
  const invalid = rows.some((r) => !r.type.trim() || !Number.isInteger(r.quantity) || r.quantity < Math.max(1, r.id ? completedById[r.id] ?? 0 : 0));
  async function save() {
    setPending(true);
    const ok = await run("change_deliverables", { action: "change_deliverables", deliverables: rows, message: reason.trim() }, "Deliverables updated");
    setPending(false);
    if (ok) onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !pending && !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Change requested deliverables</DialogTitle>
          <DialogDescription>
            This changes what was agreed. The requester, the assignee and the reviewer are notified, and the change and your reason are kept in the history. Completed items can&apos;t be removed.
          </DialogDescription>
        </DialogHeader>
        <DeliverablesEditor value={rows} onChange={setRows} completedById={completedById} disabled={pending} />
        <FormRow label="Reason for the change" htmlFor="dl-reason" required>
          <Textarea id="dl-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} placeholder="e.g. Client asked for one more reel" />
        </FormRow>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending || invalid || !reason.trim()}>{pending ? <Spinner /> : null} Save change</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reviewer sends the work back and, optionally, signs off the items that are already fine. */
export function RequestChangesDialog({ list, onClose, run }: { list: DeliverableDTO[]; onClose: () => void; run: RunAction }) {
  const [comment, setComment] = useState("");
  const [verified, setVerified] = useState<Record<string, number>>(() => Object.fromEntries(list.map((d) => [d.id, d.verifiedQuantity])));
  const [pending, setPending] = useState(false);
  async function send() {
    setPending(true);
    const items = list.filter((d) => verified[d.id] !== d.verifiedQuantity).map((d) => ({ id: d.id, verifiedQuantity: verified[d.id] }));
    const ok = await run("request_changes", { action: "request_changes", message: comment.trim(), verified: items }, "Sent back for changes");
    setPending(false);
    if (ok) onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !pending && !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request changes</DialogTitle>
          <DialogDescription>The work goes back to the assignee with your comments. After the fixes it returns to you.</DialogDescription>
        </DialogHeader>
        <FormRow label="Review comments: what needs to change?" htmlFor="rc-msg" required>
          <Textarea id="rc-msg" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} autoFocus />
        </FormRow>
        {list.length ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Already acceptable (optional)</p>
              <p className="text-xs text-muted-foreground">Verify the items that are fine, e.g. 1 of 2 videos. They count towards the ticket&apos;s verified progress.</p>
            </div>
            <ul className="space-y-3">
              {list.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`rc-${d.id}`} className="min-w-0 text-sm">
                    {d.type}
                    <span className="block text-xs text-muted-foreground">{d.completedQuantity} of {d.quantity} done</span>
                  </label>
                  <Stepper id={`rc-${d.id}`} label={`${d.type} verified`} value={verified[d.id]} min={0} max={d.completedQuantity} onChange={(n) => setVerified((v) => ({ ...v, [d.id]: n }))} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Back</Button>
          <Button onClick={send} disabled={pending || !comment.trim()}>{pending ? <Spinner /> : null} Send back</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
