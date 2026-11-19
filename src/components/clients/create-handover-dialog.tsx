"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FormRow } from "@/components/shared/form-row";
import { CURRENCIES, SERVICE_LABELS, TASK_PRIORITIES } from "@/lib/constants";
import { api, ApiClientError } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import { createHandoverSchema } from "@/lib/validations/handover";
import type { ClientDTO, RequirementDTO } from "@/types/dto";
import { emptyTeam, HandoverTeamFields } from "./handover-team-fields";

const amount = (n: number | null) => n === null ? "" : String(n);
const serviceDraft = (r: RequirementDTO) => ({ requirementId: r.id, confirmedScope: r.summary, approvedBudget: amount(r.proposedBudget), agencyFee: amount(r.agencyFee), adSpend: amount(r.adSpend), estimatedHours: "", startDate: "", endDate: "", deliverables: [] as { type: string; quantity: string; specifications: string }[] });

export function CreateHandoverDialog({ client, requirements, onClose }: { client: ClientDTO; requirements: RequirementDTO[]; onClose: () => void }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const eligible = requirements.filter((r) => r.status === "APPROVED" && !r.linkedProject);
  const [project, setProject] = useState({ name: `${client.name} project`, description: "", notes: "", startDate: "", endDate: "", priority: "MEDIUM", currency: eligible[0]?.currency ?? client.defaultCurrency ?? "INR" });
  const [selected, setSelected] = useState<string[]>([]);
  const [services, setServices] = useState(() => eligible.map(serviceDraft));
  const [team, setTeam] = useState(() => ({ ...emptyTeam(), primaryPm: client.projectManager?.id ?? null }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const chosen = services.filter((s) => selected.includes(s.requirementId));
  const changeService = (id: string, patch: Partial<ReturnType<typeof serviceDraft>>) => setServices((rows) => rows.map((r) => r.requirementId === id ? { ...r, ...patch } : r));

  async function save(submit: boolean) {
    const parsed = createHandoverSchema.safeParse({ project, services: chosen, team, submit });
    if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message]))); toast.error("Review the highlighted project fields"); return; }
    setErrors({}); setBusy(true);
    try {
      const saved = await api<{ projectId: string }>(`/api/clients/${client.id}/handover`, { method: "POST", body: parsed.data });
      await mutate(`/api/clients/${client.id}/requirements`);
      await mutate(`/api/clients/${client.id}/projects`);
      await mutate(`/api/clients/${client.id}`);
      toast.success(submit ? "Handover submitted for PM acceptance" : "Project draft created");
      onClose(); router.push(`/projects/${saved.projectId}`);
    } catch (err) { handleFormError(err); if (err instanceof ApiClientError) setErrors(err.fieldErrors ?? {}); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Create project from requirements</DialogTitle><DialogDescription>Select approved services, confirm delivery scope, and nominate the management team.</DialogDescription></DialogHeader>
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Project name" htmlFor="h-name" required error={errors["project.name"]} className="sm:col-span-2"><Input id="h-name" value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} /></FormRow>
          <FormRow label="Description" htmlFor="h-description" error={errors["project.description"]} className="sm:col-span-2"><Textarea id="h-description" value={project.description} onChange={(e) => setProject({ ...project, description: e.target.value })} /></FormRow>
          {(["startDate", "endDate"] as const).map((key) => <FormRow key={key} label={key === "startDate" ? "Start date" : "Delivery date"} htmlFor={`h-${key}`} error={errors[`project.${key}`]}><Input id={`h-${key}`} type="date" value={project[key]} onChange={(e) => setProject({ ...project, [key]: e.target.value })} /></FormRow>)}
          <FormRow label="Currency" htmlFor="h-currency" error={errors["project.currency"]} description="Selected requirements must use this currency."><Select value={project.currency} onValueChange={(currency) => setProject({ ...project, currency: currency as typeof project.currency })}><SelectTrigger id="h-currency"><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></FormRow>
          <FormRow label="Priority" htmlFor="h-priority"><Select value={project.priority} onValueChange={(priority) => setProject({ ...project, priority })}><SelectTrigger id="h-priority"><SelectValue /></SelectTrigger><SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></FormRow>
          <div className="space-y-3 sm:col-span-2">
            <p className="text-sm font-medium">Approved service requirements</p>
            {errors.services ? <p role="alert" className="text-sm text-destructive">{errors.services}</p> : null}
            {eligible.map((r) => {
              const s = services.find((row) => row.requirementId === r.id)!;
              const index = chosen.findIndex((row) => row.requirementId === r.id);
              const checked = selected.includes(r.id);
              const error = (field: string) => errors[`services.${index}.${field}`];
              return <section key={r.id} className="space-y-3 rounded-lg border p-3">
                <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={checked} onCheckedChange={(v) => setSelected((ids) => v === true ? [...ids, r.id] : ids.filter((id) => id !== r.id))} />{SERVICE_LABELS[r.serviceType]} · {r.currency}</label>
                <p className="text-xs text-muted-foreground">{r.summary}</p>
                {checked ? <div className="grid gap-3 sm:grid-cols-2">
                  {error("requirementId") ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{error("requirementId")}</p> : null}
                  <FormRow label="Confirmed scope" htmlFor={`scope-${r.id}`} required error={error("confirmedScope")} className="sm:col-span-2"><Textarea id={`scope-${r.id}`} value={s.confirmedScope} onChange={(e) => changeService(r.id, { confirmedScope: e.target.value })} /></FormRow>
                  {(["approvedBudget", "agencyFee", ...(["SEM", "SMM"].includes(r.serviceType) ? ["adSpend" as const] : []), "estimatedHours"] as const).map((key) => <FormRow key={key} label={{ approvedBudget: "Approved service budget", agencyFee: "Agency fee", adSpend: "Advertising spend", estimatedHours: "Estimated hours" }[key]} htmlFor={`${r.id}-${key}`} error={error(key)}><Input id={`${r.id}-${key}`} type="number" min={0} step="any" value={s[key]} onChange={(e) => changeService(r.id, { [key]: e.target.value })} /></FormRow>)}
                  {(["startDate", "endDate"] as const).map((key) => <FormRow key={key} label={key === "startDate" ? "Service start date" : "Service end date"} htmlFor={`${r.id}-${key}`} error={error(key)}><Input id={`${r.id}-${key}`} type="date" value={s[key]} onChange={(e) => changeService(r.id, { [key]: e.target.value })} /></FormRow>)}
                  <div className="space-y-2 sm:col-span-2">
                    <p className="text-sm font-medium">Deliverables</p>
                    {s.deliverables.map((d, i) => {
                      const update = (patch: Partial<typeof d>) => changeService(r.id, { deliverables: s.deliverables.map((v, j) => i === j ? { ...v, ...patch } : v) });
                      return <div key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-2">
                        <FormRow label="Deliverable type" htmlFor={`${r.id}-d-${i}`} error={error(`deliverables.${i}.type`)}><Input id={`${r.id}-d-${i}`} value={d.type} onChange={(e) => update({ type: e.target.value })} /></FormRow>
                        <FormRow label="Quantity" htmlFor={`${r.id}-q-${i}`} error={error(`deliverables.${i}.quantity`)}><Input id={`${r.id}-q-${i}`} type="number" min={1} value={d.quantity} onChange={(e) => update({ quantity: e.target.value })} /></FormRow>
                        <FormRow label="Specifications" htmlFor={`${r.id}-spec-${i}`} error={error(`deliverables.${i}.specifications`)}><Input id={`${r.id}-spec-${i}`} value={d.specifications} onChange={(e) => update({ specifications: e.target.value })} /></FormRow>
                        <Button type="button" variant="ghost" onClick={() => changeService(r.id, { deliverables: s.deliverables.filter((_, j) => j !== i) })}>Remove deliverable</Button>
                      </div>;
                    })}
                    <Button type="button" size="sm" variant="outline" onClick={() => changeService(r.id, { deliverables: [...s.deliverables, { type: "", quantity: "1", specifications: "" }] })}>Add deliverable</Button>
                  </div>
                </div> : null}
              </section>;
            })}
          </div>
          <div className="sm:col-span-2"><HandoverTeamFields value={team} onChange={setTeam} errors={errors} disabled={busy} /></div>
          <FormRow label="Project notes" htmlFor="h-project-notes" error={errors["project.notes"]} className="sm:col-span-2"><Textarea id="h-project-notes" value={project.notes} onChange={(e) => setProject({ ...project, notes: e.target.value })} /></FormRow>
        </fieldset>
        <DialogFooter className="sticky -bottom-4 bg-popover">
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="outline" disabled={busy || !selected.length} onClick={() => save(false)}>Save project draft</Button>
          <Button disabled={busy || !selected.length} onClick={() => save(true)}>{busy ? <Spinner /> : null} Submit handover</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
