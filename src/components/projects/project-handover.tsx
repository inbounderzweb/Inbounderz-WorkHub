"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Panel } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DeliverablesEditor, type DeliverableDraft } from "@/components/tickets/deliverables-editor";
import { FormRow } from "@/components/shared/form-row";
import { HandoverTeamFields, type HandoverTeamDraft } from "@/components/clients/handover-team-fields";
import { SERVICE_LABELS, MIN_REJECTION_REASON, humanize } from "@/lib/constants";
import { formatDay } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { api, ApiClientError, fetcher } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import { handoverActionSchema } from "@/lib/validations/handover";
import type { DepartmentOptionDTO, ProjectDetailDTO } from "@/types/dto";

type ReviseDraft = { id: string; label: string; confirmedScope: string; deliverables: DeliverableDraft[]; approvedBudget: string; agencyFee: string; adSpend: string; showMoney: { budget: boolean; fee: boolean; ad: boolean } };
const numText = (v: number | null) => (v === null ? "" : String(v));

export function ProjectHandover({ project, onChanged }: { project: ProjectDetailDTO; onChanged: () => void }) {
  const a = project.handover;
  const [dialog, setDialog] = useState<"nominate" | "reject" | "accept" | "revise" | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [draft, setDraft] = useState<ReviseDraft[]>([]);
  const { data: departments } = useSWR<DepartmentOptionDTO[]>(dialog === "accept" ? "/api/departments?all=1&forTasks=1" : null, fetcher);
  const [reason, setReason] = useState("");
  const [team, setTeam] = useState<HandoverTeamDraft>({ primaryPm: a?.primaryPm?.id ?? null, supportingPms: a?.supportingPms.map((p) => p.id) ?? [], coordinator: a?.coordinator?.id ?? null, handoverNotes: a?.handoverNotes ?? "", proposedHandoverDate: a?.proposedHandoverDate?.slice(0, 10) ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!a) return null;

  async function act(input: unknown) {
    const parsed = handoverActionSchema.safeParse(input);
    if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message]))); return; }
    setBusy(true); setErrors({});
    try {
      await api(`/api/projects/${project.id}/handover`, { method: "POST", body: parsed.data });
      toast.success({ accept: "Approved. The client is onboarded and the selected departments were notified.", reject: "Handover rejected and the project cancelled", submit: "Handover submitted", nominate: "PM nomination saved", revise: "Changes saved. Sales can see what changed and why." }[parsed.data.action]);
      setDialog(null); onChanged();
    } catch (err) { handleFormError(err); if (err instanceof ApiClientError) setErrors(err.fieldErrors ?? {}); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4">
    <Panel title="Sales handover" description={`${humanize(a.status)} · Nomination ${a.sequence}`}>
      <div className="space-y-3 p-4 text-sm">
        {project.clientRef ? <Link className="font-medium underline" href={`/clients/${project.clientRef.id}`}>{project.clientRef.name} · {project.clientRef.clientCode}</Link> : null}
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Primary Project Manager</dt><dd>{a.primaryPm?.name ?? "Not nominated"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Supporting Project Managers</dt><dd>{a.supportingPms.map((p) => p.name).join(", ") || "None"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Coordinator</dt><dd>{a.coordinator?.name ?? "None"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Proposed handover date</dt><dd>{formatDay(a.proposedHandoverDate)}</dd></div>
        </dl>
        {a.handoverNotes ? <p className="whitespace-pre-wrap">{a.handoverNotes}</p> : null}
        {a.rejectionReason ? <p className="rounded-lg border border-destructive/30 p-3">Rejected, project cancelled. Reason: {a.rejectionReason}</p> : null}
        {!project.manager ? <p className="text-muted-foreground">The project has no delivery owner until the primary PM explicitly accepts.</p> : <p>Project owner: {project.manager.name}</p>}
        <div className="flex flex-wrap gap-2">
          {a.can.nominate ? <Button variant="outline" disabled={busy} onClick={() => { setErrors({}); setTeam({ primaryPm: a.primaryPm?.id ?? null, supportingPms: a.supportingPms.map((p) => p.id), coordinator: a.coordinator?.id ?? null, handoverNotes: a.handoverNotes, proposedHandoverDate: a.proposedHandoverDate?.slice(0, 10) ?? "" }); setDialog("nominate"); }}>Nominate PM team</Button> : null}
          {a.can.submit ? <Button disabled={busy} onClick={() => act({ action: "submit" })}>Submit handover</Button> : null}
          {a.can.revise ? <Button variant="outline" disabled={busy} onClick={() => { setErrors({}); setReason(""); setDraft(project.services.map((sv) => ({ id: sv.id, label: SERVICE_LABELS[sv.serviceType], confirmedScope: sv.confirmedScope, deliverables: sv.deliverables.map((d) => ({ id: d.id, type: d.type, quantity: d.quantity, specifications: d.specifications })), approvedBudget: numText(sv.approvedBudget), agencyFee: numText(sv.agencyFee), adSpend: numText(sv.adSpend), showMoney: { budget: sv.approvedBudget !== null, fee: sv.agencyFee !== null, ad: sv.adSpend !== null } }))); setDialog("revise"); }}>Edit scope</Button> : null}
          {a.can.respond ? <><Button disabled={busy} onClick={() => { setErrors({}); setChosen([]); setDialog("accept"); }}>Approve &amp; onboard client</Button><Button variant="destructive" disabled={busy} onClick={() => { setErrors({}); setReason(""); setDialog("reject"); }}>Reject &amp; cancel project</Button></> : null}
        </div>
        <details><summary className="cursor-pointer font-medium">Assignment history</summary>
          <ol className="mt-2 space-y-2">{a.history.map((e, i) => <li key={i}>{formatDay(e.at)} · {e.actor?.name ?? "System"} · {humanize(e.action)}{e.note ? ` — ${e.note}` : ""}</li>)}</ol>
          {a.previous.map((p, i) => <p key={i} className="mt-2">Earlier nomination: {p.primaryPm?.name ?? "Unassigned"} · {humanize(p.status)}{p.rejectionReason ? ` · ${p.rejectionReason}` : ""}</p>)}
        </details>
      </div>
    </Panel>
    <Panel title="Confirmed project services">
      <ul className="divide-y">{project.services.map((s) => <li key={s.id} className="space-y-2 p-4 text-sm">
        <p className="font-medium">{SERVICE_LABELS[s.serviceType]} · {humanize(s.status)}</p>
        <p className="whitespace-pre-wrap">{s.confirmedScope}</p>
        <p className="text-xs text-muted-foreground">{formatDay(s.startDate)} → {formatDay(s.endDate)}{s.estimatedHours !== null ? ` · ${s.estimatedHours} estimated hours` : ""}</p>
        <dl className="flex flex-wrap gap-4">{([ ["Approved budget", s.approvedBudget], ["Agency fee", s.agencyFee], ["Advertising spend", s.adSpend] ] as const).filter(([, v]) => v !== null).map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd>{formatMoney(value!, s.currency)}</dd></div>)}</dl>
        {s.deliverables.length ? <ul className="list-inside list-disc">{s.deliverables.map((d) => <li key={d.id}>{d.quantity} × {d.type}{d.specifications ? ` · ${d.specifications}` : ""} · {d.verifiedQuantity} verified</li>)}</ul> : <p className="text-xs text-muted-foreground">No deliverables specified.</p>}
      </li>)}</ul>
    </Panel>
    <Dialog open={!!dialog} onOpenChange={(open) => !open && !busy && setDialog(null)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{{ reject: "Reject and cancel this project", accept: "Approve and onboard the client", revise: "Edit the project scope", nominate: "Nominate PM team" }[dialog ?? "nominate"]}</DialogTitle>
          <DialogDescription>{{
            reject: "The project is cancelled and no department is notified. Sales is told your reason.",
            accept: "The client is onboarded and you become the project manager. Only the departments you select below are notified.",
            revise: "Correct anything that doesn't look right before approving. Sales sees every change together with your reason.",
            nominate: "The primary PM must accept before taking ownership.",
          }[dialog ?? "nominate"]}</DialogDescription>
        </DialogHeader>
        {dialog === "reject" ? <FormRow label="Rejection reason" htmlFor="reject-reason" required error={errors.reason}><Textarea id="reject-reason" value={reason} maxLength={2000} disabled={busy} onChange={(e) => setReason(e.target.value)} /></FormRow>
        : dialog === "accept" ? <FormRow label="Departments that will deliver this work" htmlFor="accept-depts" required error={errors.departments} description="Their head and team leaders get a notification with the services and quantities.">
            <div id="accept-depts" className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {(departments ?? []).filter((d) => d.status === "ACTIVE").map((d) => <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
                <Checkbox checked={chosen.includes(d.id)} disabled={busy} onCheckedChange={(c) => setChosen((cur) => (c ? [...cur, d.id] : cur.filter((x) => x !== d.id)))} />
                <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />{d.name}
              </label>)}
              {!departments ? <p className="p-2 text-sm text-muted-foreground">Loading departments…</p> : null}
            </div>
          </FormRow>
        : dialog === "revise" ? <div className="space-y-5">
            {draft.map((d, i) => { const set = (patch: Partial<ReviseDraft>) => setDraft((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x))); return <fieldset key={d.id} className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">{d.label}</legend>
              <FormRow label="Confirmed scope" htmlFor={`rv-scope-${i}`} error={errors[`services.${i}.confirmedScope`]}><Textarea id={`rv-scope-${i}`} rows={3} value={d.confirmedScope} disabled={busy} onChange={(e) => set({ confirmedScope: e.target.value })} /></FormRow>
              <FormRow label="Deliverables (e.g. number of posters)" htmlFor={`rv-del-${i}`} error={errors[`services.${i}.deliverables`]}><div id={`rv-del-${i}`}><DeliverablesEditor value={d.deliverables} onChange={(v) => set({ deliverables: v })} disabled={busy} errorFor={(r, f) => errors[`services.${i}.deliverables.${r}.${f}`]} /></div></FormRow>
              <div className="grid gap-3 sm:grid-cols-3">
                {d.showMoney.budget ? <FormRow label="Approved budget" htmlFor={`rv-b-${i}`}><Input id={`rv-b-${i}`} type="number" min={0} value={d.approvedBudget} disabled={busy} onChange={(e) => set({ approvedBudget: e.target.value })} /></FormRow> : null}
                {d.showMoney.fee ? <FormRow label="Agency fee" htmlFor={`rv-f-${i}`}><Input id={`rv-f-${i}`} type="number" min={0} value={d.agencyFee} disabled={busy} onChange={(e) => set({ agencyFee: e.target.value })} /></FormRow> : null}
                {d.showMoney.ad ? <FormRow label="Advertising spend" htmlFor={`rv-a-${i}`}><Input id={`rv-a-${i}`} type="number" min={0} value={d.adSpend} disabled={busy} onChange={(e) => set({ adSpend: e.target.value })} /></FormRow> : null}
              </div>
            </fieldset>; })}
            <FormRow label="Why are you changing this?" htmlFor="revise-reason" required error={errors.reason} description="Sales sees this reason and the list of changes.">
              <Textarea id="revise-reason" rows={3} value={reason} maxLength={1500} disabled={busy} onChange={(e) => setReason(e.target.value)} />
            </FormRow>
            {errors.services ? <p className="text-sm text-destructive">{errors.services}</p> : null}
          </div>
        : dialog === "nominate" ? <HandoverTeamFields value={team} onChange={setTeam} errors={errors} disabled={busy} /> : null}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button>
          <Button
            variant={dialog === "reject" ? "destructive" : "default"}
            disabled={busy || (dialog === "reject" || dialog === "revise" ? reason.trim().length < MIN_REJECTION_REASON : dialog === "accept" ? chosen.length === 0 : !team.primaryPm)}
            onClick={() => act(
              dialog === "reject" ? { action: "reject", reason }
              : dialog === "accept" ? { action: "accept", departments: chosen }
              : dialog === "revise" ? { action: "revise", reason, services: draft.map((d) => ({ id: d.id, confirmedScope: d.confirmedScope, deliverables: d.deliverables, ...(d.showMoney.budget ? { approvedBudget: d.approvedBudget } : {}), ...(d.showMoney.fee ? { agencyFee: d.agencyFee } : {}), ...(d.showMoney.ad ? { adSpend: d.adSpend } : {}) })) }
              : { action: "nominate", team }
            )}
          >{{ reject: "Reject and cancel", accept: "Approve and notify departments", revise: "Save changes", nominate: "Save nomination" }[dialog ?? "nominate"]}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
