"use client";

import { PriorityLabel } from "@/components/shared/labels";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, MessageSquareQuote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { FormRow } from "@/components/shared/form-row";
import { EmployeePicker } from "@/components/shared/employee-picker";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useEligibleAssignees, useTicketCategories, useTicketDepartments } from "@/hooks/use-ticket-options";
import { api, ApiClientError } from "@/lib/http";
import { TASK_PRIORITIES, roleName, type TaskPriority } from "@/lib/constants";
import { TICKET_ACTION_LABELS, type TicketAction } from "@/lib/ticket-workflow";
import type { TicketDetailDTO } from "@/types/dto";

const dayOf = (iso: string) => iso.slice(0, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);

function useRunner(onDone: (t: TicketDetailDTO) => void, close: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<TicketDetailDTO>, success: string) {
    setPending(true);
    setError(null);
    try {
      const t = await fn();
      toast.success(success);
      onDone(t);
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

/* ------------------------------------------------------------------ */
/* Assign / reassign                                                   */
/* ------------------------------------------------------------------ */

export function AssignDialog({
  ticket,
  open,
  onOpenChange,
  onDone,
}: {
  ticket: TicketDetailDTO;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: (t: TicketDetailDTO) => void;
}) {
  const reassign = !!ticket.assignee;
  const [department, setDepartment] = useState(ticket.targetDepartment?.id ?? "");
  const [employee, setEmployee] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority>(ticket.priority);
  const [dueDate, setDueDate] = useState(dayOf(ticket.dueDate));
  const [note, setNote] = useState("");
  const { pending, run } = useRunner(onDone, () => onOpenChange(false));
  const { data: departments } = useTicketDepartments(open);
  const { data: people, isLoading } = useEligibleAssignees(open ? ticket.id : null, department);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
      setDepartment(ticket.targetDepartment?.id ?? "");
      setEmployee(null);
      setPriority(ticket.priority);
      setDueDate(dayOf(ticket.dueDate));
      setNote("");
    }
  }, [open, ticket.targetDepartment?.id, ticket.priority, ticket.dueDate]);

  const options = (people ?? [])
    .filter((p) => p.id !== ticket.assignee?.id)
    .map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      employeeId: p.employeeId,
      subtitle: `${p.designation || roleName(p.role)} · ${p.openTasks} open task${p.openTasks === 1 ? "" : "s"}`,
    }));
  const dueChanged = dueDate !== dayOf(ticket.dueDate);

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{reassign ? `Reassign ${ticket.ticketNumber}` : `Assign ${ticket.ticketNumber}`}</DialogTitle>
          <DialogDescription>
            {reassign
              ? "The linked task moves to the new assignee. The full assignment history is kept, and both people are notified."
              : "The employee gets a notification and the request appears in their My Tasks as an internal request."}
          </DialogDescription>
        </DialogHeader>

        {reassign && ticket.assignee ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Currently</span>
            <UserAvatar name={ticket.assignee.name} size="sm" />
            <span className="font-medium">{ticket.assignee.name}</span>
            <ArrowRight className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">new assignee</span>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Department" htmlFor="as-dept" required className="sm:col-span-2" description="Only active employees of this department can be assigned.">
            <Select value={department || undefined} onValueChange={(v) => { setDepartment(v); setEmployee(null); }}>
              <SelectTrigger id="as-dept" className="w-full"><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {departments?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name}
                    {d.id === ticket.targetDepartment?.id ? <span className="text-xs text-muted-foreground">(requested)</span> : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Responsible employee" htmlFor="as-emp" required className="sm:col-span-2">
            <EmployeePicker
              id="as-emp"
              options={options}
              loading={isLoading}
              value={employee}
              onChange={setEmployee}
              disabled={!department}
              placeholder={department ? "Select an employee" : "Select a department first"}
              emptyText="No other active employees in this department."
            />
          </FormRow>
          <FormRow label="Priority" htmlFor="as-priority">
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger id="as-priority" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}><PriorityLabel value={p} /></SelectItem>)}</SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Task deadline" htmlFor="as-due" description={dueChanged ? "Differs from the requested date." : "Requested completion date."}>
            <Input id="as-due" type="date" min={todayStr()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormRow>
          <FormRow label={reassign ? "Reason / handover note" : "Note for the assignee"} htmlFor="as-note" className="sm:col-span-2">
            <Textarea id="as-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder={reassign ? "e.g. Anu is on leave this week" : "Anything they should know (optional)"} />
          </FormRow>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button
            disabled={pending || !employee || !department || !dueDate}
            onClick={() =>
              run(
                () =>
                  api<TicketDetailDTO>(`/api/tickets/${ticket.id}/assign`, {
                    method: "POST",
                    body: { department, employee, priority, dueDate: dueChanged ? dueDate : undefined, note },
                  }),
                reassign ? "Ticket reassigned" : "Ticket assigned"
              )
            }
          >
            {pending ? <Spinner /> : null}
            {reassign ? "Reassign" : "Confirm assignment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Workflow actions with a message                                     */
/* ------------------------------------------------------------------ */

type DialogAction = Exclude<TicketAction, "ASSIGN" | "REASSIGN" | "START_WORK">;

const ACTION_COPY: Record<DialogAction, { title: string; description: string; field: string; label: string; required: boolean; placeholder?: string; cta: string; success: string; tone?: "danger" | "warn" }> = {
  START_REVIEW: { title: "Start review", description: "The requester sees that the ticket is being reviewed.", field: "note", label: "Note (optional)", required: false, cta: "Start review", success: "Review started" },
  REJECT: { title: "Reject this request", description: "The requester is notified with your reason. A Project Manager can reopen it later.", field: "reason", label: "Reason", required: true, placeholder: "e.g. Duplicate of TKT-0012 / out of scope for Design", cta: "Reject ticket", success: "Ticket rejected", tone: "danger" },
  REQUEST_INFO: { title: "Request more information", description: "The ticket waits for the requester's answer. Work resumes where it left off once they respond.", field: "message", label: "What do you need to know?", required: true, placeholder: "e.g. Which product photos should be used?", cta: "Send request", success: "Information requested" },
  PROVIDE_INFO: { title: "Provide information", description: "Your answer is added to the conversation and the ticket moves forward again.", field: "message", label: "Your response", required: true, cta: "Send response", success: "Response sent" },
  RESOLVE: { title: "Submit as resolved", description: "The requester is notified to review the deliverables and confirm completion or request changes.", field: "note", label: "Resolution note", required: false, placeholder: "What you delivered, where to find it, anything to check…", cta: "Submit as resolved", success: "Submitted to the requester" },
  ACCEPT: { title: "Confirm completion", description: "The ticket is closed and the linked task is marked completed.", field: "note", label: "Closing note (optional)", required: false, placeholder: "e.g. Looks great, thank you!", cta: "Confirm & close", success: "Ticket closed" },
  REQUEST_CHANGES: { title: "Request changes", description: "The work goes back to the assignee with your feedback.", field: "feedback", label: "What needs to change?", required: true, placeholder: "Be specific: what to change and where", cta: "Send back", success: "Changes requested", tone: "warn" },
  REOPEN: { title: "Reopen ticket", description: "Closed tickets go back to the assignee as Changes Requested; rejected tickets return to review.", field: "reason", label: "Why reopen?", required: true, cta: "Reopen", success: "Ticket reopened", tone: "warn" },
};

export function ActionDialog({
  ticket,
  action,
  onOpenChange,
  onDone,
}: {
  ticket: TicketDetailDTO;
  action: DialogAction | null;
  onOpenChange: (o: boolean) => void;
  onDone: (t: TicketDetailDTO) => void;
}) {
  const [text, setText] = useState("");
  const { pending, error, run, setError } = useRunner(onDone, () => onOpenChange(false));
  useEffect(() => {
    if (action) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
      setText("");
      setError(null);
    }
  }, [action, setError]);
  if (!action) return null;
  const copy = ACTION_COPY[action];
  const tooShort = copy.required && text.trim().length < 3;
  const noDeliverables = action === "RESOLVE" && !ticket.draftDeliverables.length;

  return (
    <Dialog open onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {action === "PROVIDE_INFO" && ticket.infoRequest ? (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <MessageSquareQuote className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{ticket.infoRequest.requestedBy?.name} asked</p>
              <p className="whitespace-pre-wrap">{ticket.infoRequest.message}</p>
            </div>
          </div>
        ) : null}
        {action === "RESOLVE" ? (
          noDeliverables ? (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>No new deliverable uploaded. Upload the finished work first, or explain the resolution in the note.</p>
            </div>
          ) : (
            <p className="rounded-lg border bg-muted/30 p-3 text-sm">
              Submitting <span className="font-medium">{ticket.draftDeliverables.length} deliverable{ticket.draftDeliverables.length === 1 ? "" : "s"}</span>:{" "}
              {ticket.draftDeliverables.map((d) => d.fileName).join(", ")}
            </p>
          )
        ) : null}

        <FormRow label={copy.label} htmlFor="ta-text" required={copy.required || noDeliverables} error={error && copy.required ? error : undefined}>
          <Textarea id="ta-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} placeholder={copy.placeholder} autoFocus />
        </FormRow>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button
            variant={copy.tone === "danger" ? "destructive" : "default"}
            className={copy.tone === "warn" ? "bg-orange-600 text-white hover:bg-orange-600/90" : copy.tone === "danger" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            disabled={pending || tooShort || (noDeliverables && text.trim().length < 3)}
            onClick={() =>
              run(
                () => api<TicketDetailDTO>(`/api/tickets/${ticket.id}/actions`, { method: "POST", body: { action, [copy.field]: text.trim() } }),
                copy.success
              )
            }
          >
            {pending ? <Spinner /> : null}
            {copy.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const DIALOG_ACTIONS: DialogAction[] = Object.keys(ACTION_COPY) as DialogAction[];
export const actionLabel = (a: TicketAction) => TICKET_ACTION_LABELS[a];

/* ------------------------------------------------------------------ */
/* Manager edits                                                       */
/* ------------------------------------------------------------------ */

export function EditTicketDialog({
  ticket,
  open,
  onOpenChange,
  onDone,
}: {
  ticket: TicketDetailDTO;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: (t: TicketDetailDTO) => void;
}) {
  const [priority, setPriority] = useState<TaskPriority>(ticket.priority);
  const [dueDate, setDueDate] = useState(dayOf(ticket.dueDate));
  const [category, setCategory] = useState(ticket.category.id);
  const [department, setDepartment] = useState(ticket.targetDepartment?.id ?? "");
  const { pending, run } = useRunner(onDone, () => onOpenChange(false));
  const { data: categories } = useTicketCategories(false, open);
  const { data: departments } = useTicketDepartments(open && !ticket.assignee);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
      setPriority(ticket.priority);
      setDueDate(dayOf(ticket.dueDate));
      setCategory(ticket.category.id);
      setDepartment(ticket.targetDepartment?.id ?? "");
    }
  }, [open, ticket]);

  const body: Record<string, string> = {};
  if (priority !== ticket.priority) body.priority = priority;
  if (dueDate !== dayOf(ticket.dueDate)) body.dueDate = dueDate;
  if (category !== ticket.category.id) body.category = category;
  if (!ticket.assignee && department !== ticket.targetDepartment?.id) body.targetDepartment = department;

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {ticket.ticketNumber}</DialogTitle>
          <DialogDescription>Changes are recorded in the activity history and synced to the linked task.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Priority" htmlFor="ed-priority">
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger id="ed-priority" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}><PriorityLabel value={p} /></SelectItem>)}</SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Required date" htmlFor="ed-due">
            <Input id="ed-due" type="date" min={todayStr()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormRow>
          <FormRow label="Category" htmlFor="ed-cat" className="sm:col-span-2">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="ed-cat" className="w-full"><SelectValue placeholder={ticket.category.name} /></SelectTrigger>
              <SelectContent>
                {!categories?.some((c) => c.id === ticket.category.id) ? <SelectItem value={ticket.category.id}>{ticket.category.name}</SelectItem> : null}
                {categories?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormRow>
          {!ticket.assignee ? (
            <FormRow label="Target department" htmlFor="ed-dept" className="sm:col-span-2">
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger id="ed-dept" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{departments?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </FormRow>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button disabled={pending || !Object.keys(body).length} onClick={() => run(() => api<TicketDetailDTO>(`/api/tickets/${ticket.id}`, { method: "PATCH", body }), "Ticket updated")}>
            {pending ? <Spinner /> : null} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
