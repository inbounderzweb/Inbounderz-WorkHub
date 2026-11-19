"use client";

import useSWR from "swr";
import { EmployeePicker } from "@/components/shared/employee-picker";
import { FormRow } from "@/components/shared/form-row";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetcher } from "@/lib/http";
import type { PmOptionDTO } from "@/types/dto";

export type HandoverTeamDraft = { primaryPm: string | null; supportingPms: string[]; coordinator: string | null; handoverNotes: string; proposedHandoverDate: string };
export const emptyTeam = (): HandoverTeamDraft => ({ primaryPm: null, supportingPms: [], coordinator: null, handoverNotes: "", proposedHandoverDate: "" });

export function HandoverTeamFields({ value, onChange, errors, disabled }: { value: HandoverTeamDraft; onChange: (team: HandoverTeamDraft) => void; errors: Record<string, string>; disabled?: boolean }) {
  const { data, error, isLoading, mutate } = useSWR<{ pms: PmOptionDTO[]; coordinators: PmOptionDTO[] }>("/api/handover/pm-options", fetcher);
  const options = (rows?: PmOptionDTO[]) => rows?.map((p) => ({ ...p, avatarUrl: p.avatarUrl ?? "", subtitle: p.employeeId }));
  return (
    <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-3 text-sm font-medium">Project management team</legend>
      {error ? <p role="alert" className="text-sm text-destructive sm:col-span-2">Could not load the team. <button type="button" className="underline" onClick={() => mutate()}>Retry</button></p> : null}
      <FormRow label="Primary Project Manager" htmlFor="h-primary" error={errors["team.primaryPm"]} description="Ownership starts only after this PM accepts.">
        <EmployeePicker id="h-primary" value={value.primaryPm} options={options(data?.pms)} loading={isLoading} disabled={disabled || !!error} allowClear onChange={(id) => onChange({ ...value, primaryPm: id, supportingPms: value.supportingPms.filter((p) => p !== id), coordinator: value.coordinator === id ? null : value.coordinator })} />
      </FormRow>
      <FormRow label="Supporting Project Managers" htmlFor="h-supporting" error={errors["team.supportingPms"]}>
        <EmployeePicker id="h-supporting" multiple value={value.supportingPms} options={options(data?.pms.filter((p) => p.id !== value.primaryPm && p.id !== value.coordinator))} loading={isLoading} disabled={disabled || !!error} onChange={(supportingPms) => onChange({ ...value, supportingPms })} />
      </FormRow>
      <FormRow label="Coordinator (optional)" htmlFor="h-coordinator" error={errors["team.coordinator"]}>
        <EmployeePicker id="h-coordinator" value={value.coordinator} options={options(data?.coordinators.filter((p) => p.id !== value.primaryPm && !value.supportingPms.includes(p.id)))} loading={isLoading} disabled={disabled || !!error} allowClear onChange={(coordinator) => onChange({ ...value, coordinator })} />
      </FormRow>
      <FormRow label="Proposed handover date" htmlFor="h-date" error={errors["team.proposedHandoverDate"]}><Input id="h-date" type="date" value={value.proposedHandoverDate} onChange={(e) => onChange({ ...value, proposedHandoverDate: e.target.value })} /></FormRow>
      <FormRow label="Handover notes" htmlFor="h-notes" error={errors["team.handoverNotes"]} className="sm:col-span-2"><Textarea id="h-notes" value={value.handoverNotes} onChange={(e) => onChange({ ...value, handoverNotes: e.target.value })} /></FormRow>
    </fieldset>
  );
}
