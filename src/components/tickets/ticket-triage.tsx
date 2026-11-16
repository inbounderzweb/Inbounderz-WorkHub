"use client";

import { useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { toast } from "sonner";
import { Gauge, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/dashboard/panel";
import { FormRow } from "@/components/shared/form-row";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { UserAvatar } from "@/components/shared/user-avatar";
import { day } from "@/lib/dates";
import { EmployeeDrawer } from "@/components/workload/employee-drawer";
import { ReviewerPicker } from "./reviewer-picker";
import { api, ApiClientError, fetcher, qs } from "@/lib/http";
import { cn } from "@/lib/utils";
import type { TicketDetailDTO, WorkloadRowDTO } from "@/types/dto";

export const AVAILABILITY = {
  AVAILABLE: { label: "Available", bar: "bg-emerald-500", chip: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  LIMITED: { label: "Limited", bar: "bg-amber-500", chip: "border-amber-200 bg-amber-50 text-amber-700" },
  FULL: { label: "Fully occupied", bar: "bg-red-500", chip: "border-red-200 bg-red-50 text-red-700" },
} as const;

/**
 * Project Manager workspace: shows every employee's real load (item count AND estimated hours against
 * capacity, plus overdue work) so the right person is picked. Nothing is assigned until the PM confirms.
 */
export function TicketTriagePanel({ ticket, onDone }: { ticket: TicketDetailDTO; onDone: () => void }) {
  const [viewing, setViewing] = useState<string | null>(null);
  const { can } = ticket;
  const mode = can.approve ? "approve" : can.assign ? "assign" : "reassign";
  const departments = [ticket.targetDepartment, ...ticket.additionalDepartments].filter((d): d is NonNullable<typeof d> => !!d);
  const [pickedDept, setPickedDept] = useState<string | null>(null);
  const deptId = pickedDept ?? ticket.targetDepartment?.id;
  const { data, error, isLoading, mutate } = useSWR<WorkloadRowDTO[]>(deptId ? `/api/tickets/workload${qs({ department: deptId, ticket: ticket.id })}` : null, fetcher);
  const [picked, setPicked] = useState<string | null>(null);
  const [hours, setHours] = useState(ticket.estimatedHours != null ? String(ticket.estimatedHours) : "");
  const [expected, setExpected] = useState(ticket.expectedCompletion?.slice(0, 10) ?? ticket.dueDate?.slice(0, 10) ?? "");
  const [reviewer, setReviewer] = useState<string | null>(ticket.assignedReviewer?.id ?? null);
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const chosen = data?.find((r) => r.id === picked) ?? null;
  const needsOverride = chosen?.availability === "FULL";
  const nothingAvailable = !!data && data.length > 0 && data.every((r) => r.availability === "FULL");

  async function submit(action: "approve" | "assign" | "reassign", withAssignee: boolean) {
    if (withAssignee && !picked) return setErr("Select an employee first");
    if (action === "reassign" && !note.trim()) return setErr("Add a reason for the reassignment");
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/tickets/${ticket.id}/actions`, {
        method: "POST",
        body: {
          action,
          ...(withAssignee ? { assignee: picked } : {}),
          ...(reviewer ? { reviewer } : {}),
          estimatedHours: hours === "" ? null : Number(hours),
          expectedCompletion: expected || null,
          overrideCapacity: override,
          message: note.trim(),
        },
      });
      toast.success(action === "reassign" ? "Ticket reassigned" : withAssignee ? "Approved and assigned" : "Approved – sent to the Department Head to assign");
      onDone();
      void mutate();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : "Something went wrong";
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "approve" ? "Approve & assign" : mode === "assign" ? "Assign this ticket" : "Reassign ticket";
  return (
    <>
    <Panel title={title} description="Check availability, then choose who gets the work. The employee is notified only after you confirm.">
      <div className="space-y-4 p-4">
        {departments.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Department">
            {departments.map((d) => (
              <Button key={d.id} type="button" size="sm" variant={deptId === d.id ? "default" : "outline"} onClick={() => { setPickedDept(d.id); setPicked(null); }}>
                <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} /> {d.name}
              </Button>
            ))}
          </div>
        ) : null}
        <p className="text-sm font-medium">Assign task to</p>
        {error ? (
          <ErrorState message={error.message} onRetry={() => mutate()} />
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Loading workload…</div>
        ) : !data?.length ? (
          <EmptyState icon={Gauge} title="No assignable employees" description="This department has no active employees or team leaders. Approve without assigning to keep it in the unassigned queue." className="py-6" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 py-2 pl-3" />
                  <th className="py-2 pr-3 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Active</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Effort</th>
                  <th className="min-w-28 px-3 py-2 font-medium">Load</th>
                  <th className="px-3 py-2 font-medium">Availability</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.map((r) => {
                  const a = AVAILABILITY[r.availability];
                  const current = mode === "reassign" && r.id === ticket.assignee?.id;
                  return (
                    <tr
                      key={r.id}
                      className={cn("cursor-pointer hover:bg-muted/40", picked === r.id && "bg-accent/50", current && "opacity-60")}
                      onClick={() => { if (!current) { setPicked(r.id); if (reviewer === r.id) setReviewer(null); } }}
                    >
                      <td className="py-2 pl-3">
                        <input type="radio" name="assignee" checked={picked === r.id} disabled={current} onChange={() => { setPicked(r.id); if (reviewer === r.id) setReviewer(null); }} aria-label={`Select ${r.name}`} className="accent-[var(--primary)]" />
                      </td>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2">
                          <UserAvatar name={r.name} size="sm" />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-medium">
                              <span className="truncate">{r.name}</span>
                              {r.suggested ? <span title="Suggested by the requester" className="inline-flex items-center gap-0.5 rounded-full bg-violet-50 px-1.5 text-[10px] font-medium text-violet-700"><Sparkles className="size-3" /> Suggested</span> : null}
                              {current ? <span className="text-[10px] text-muted-foreground">(current)</span> : null}
                              {r.activeItems === 0 ? <span className="inline-flex rounded-full bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700">No active work</span> : null}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">{r.designation || r.employeeId}</span>
                          </span>
                        </span>
                      </td>
                      <td className="tabular px-3 py-2 whitespace-nowrap">
                        {r.activeItems} active
                        {r.pendingItems ? <span className="block text-xs text-muted-foreground">{r.pendingItems} not started</span> : null}
                      </td>
                      <td className="tabular hidden px-3 py-2 whitespace-nowrap sm:table-cell">
                        {r.openHours}h / {r.capacityHours}h
                        {r.overdue ? <span className="block text-xs font-medium text-red-600">{r.overdue} overdue</span> : r.nextDue ? <span className="block text-xs text-muted-foreground">next {format(day(r.nextDue), "d MMM")}</span> : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.min(100, r.loadPercent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.name} load`}>
                          <div className={cn("h-full rounded-full", a.bar)} style={{ width: `${Math.min(100, r.loadPercent)}%` }} />
                        </div>
                        <span className="tabular text-xs text-muted-foreground">{r.loadPercent}%</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", a.chip)}>{a.label}</span>
                        {r.activeItems ? <button type="button" className="mt-0.5 block text-xs text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setViewing(r.id); }}>View tasks</button> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {nothingAvailable ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Everyone is fully occupied. You can approve without assigning and the ticket will wait in the Unassigned queue, or override the capacity limit.
          </p>
        ) : null}

        <FormRow
          label="Assign reviewer"
          htmlFor="tr-reviewer"
          description={reviewer ? "This person reviews the finished work, not the person who raised the ticket." : "Optional. Without a reviewer, the person who raised the ticket reviews the work."}
        >
          <ReviewerPicker id="tr-reviewer" ticketId={ticket.id} value={reviewer} onChange={setReviewer} excludeId={picked ?? ticket.assignee?.id} />
        </FormRow>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormRow label="Estimated effort (hours)" htmlFor="tr-hours">
            <Input id="tr-hours" type="number" min={0} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 4" />
          </FormRow>
          <FormRow label="Expected completion" htmlFor="tr-exp" description={ticket.dueDate ? `Requested by ${format(day(ticket.dueDate), "d MMM yyyy")}` : undefined}>
            <Input id="tr-exp" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </FormRow>
          <FormRow label={mode === "reassign" ? "Reason for reassignment" : "Note (optional)"} htmlFor="tr-note" required={mode === "reassign"} className="sm:col-span-2">
            <Textarea id="tr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "reassign" ? "Why is this moving to someone else?" : "Anything the assignee should know"} />
          </FormRow>
        </div>

        {needsOverride ? (
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox checked={override} onCheckedChange={(v) => setOverride(!!v)} className="mt-0.5" />
            <span>{chosen?.name} is fully occupied. I understand and want to assign anyway.</span>
          </label>
        ) : null}
        {err ? <p role="alert" className="text-sm text-destructive">{err}</p> : null}

        {mode === "approve" ? <p className="text-xs text-muted-foreground">If you approve without choosing an employee, the ticket goes to the Department Head, who is notified to assign it.</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {mode === "approve" ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => submit("approve", false)}>Approve, assign later</Button>
              <Button disabled={busy || !picked || (needsOverride && !override)} onClick={() => submit("approve", true)}>
                {busy ? <Spinner /> : null} Approve &amp; assign
              </Button>
            </>
          ) : (
            <Button disabled={busy || !picked || (needsOverride && !override)} onClick={() => submit(mode, true)}>
              {busy ? <Spinner /> : null} {mode === "assign" ? "Assign" : "Reassign"}
            </Button>
          )}
        </div>
      </div>
    </Panel>
    <EmployeeDrawer employeeId={viewing} period="week" onClose={() => setViewing(null)} />
    </>
  );
}
