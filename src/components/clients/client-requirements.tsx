"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/dashboard/panel";
import { ErrorState } from "@/components/shared/states";
import { useCurrentUser } from "@/components/providers/user-provider";
import { hasPermission } from "@/lib/permissions";
import { api, ApiClientError, fetcher } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import type { ClientDTO, RequirementDTO } from "@/types/dto";
import { draftFromDTO, draftPayload, RequirementsEditor, type RequirementDraft } from "./requirement-form";
import { CreateHandoverDialog } from "./create-handover-dialog";

export function ClientRequirements({ client }: { client: ClientDTO }) {
  const me = useCurrentUser();
  const { mutate: refresh } = useSWRConfig();
  const { data, error, mutate } = useSWR<RequirementDTO[]>(`/api/clients/${client.id}/requirements`, fetcher, { revalidateOnFocus: false });
  const [drafts, setDrafts] = useState<RequirementDraft[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = drafts !== null;
  const [creating, setCreating] = useState(false);
  const writable = !!client.can?.editRestricted && client.status !== "ARCHIVED";
  async function save() {
    setBusy(true); setErrors({});
    try {
      const saved = await api<RequirementDTO[]>(`/api/clients/${client.id}/requirements`, { method: "PUT", body: { requirements: (drafts ?? []).map(draftPayload), expectedUpdatedAt: client.updatedAt } });
      await mutate(saved, false);
      setDrafts(null);
      await refresh(`/api/clients/${client.id}`);
      await refresh((key) => typeof key === "string" && key.startsWith(`/api/clients/${client.id}/history`));
      toast.success("Service requirements saved");
    } catch (err) { handleFormError(err); if (err instanceof ApiClientError) setErrors(err.fieldErrors ?? {}); }
    finally { setBusy(false); }
  }
  if (error) return <ErrorState message={error.message} onRetry={() => mutate()} />;
  if (!data) return <p className="p-4 text-sm">Loading service requirements…</p>;
  return <Panel title="Service requirements" description="Collect interest, scope and quotes here. Approved requirements can become confirmed project services.">
    <div className="space-y-4 p-4">
      <RequirementsEditor value={drafts ?? data.map(draftFromDTO)} onChange={setDrafts} errors={errors} disabled={!writable || busy} defaultCurrency={client.defaultCurrency} />
      {errors.requirements ? <p role="alert" className="text-sm text-destructive">{errors.requirements}</p> : null}
      {data.some((r) => r.linkedProject) ? <ul className="space-y-1 text-sm">{data.filter((r) => r.linkedProject).map((r) => <li key={r.id}>{r.serviceType}: <Link className="underline" href={`/projects/${r.linkedProject!.id}`}>{r.linkedProject!.code} · {r.linkedProject!.name}</Link></li>)}</ul> : null}
      <div className="flex flex-wrap gap-2">
        {writable ? <Button disabled={busy || !dirty} onClick={save}>Save requirements</Button> : null}
        {writable && hasPermission(me.role, "project:handover") ? <Button variant="outline" disabled={busy || dirty || !data.some((r) => r.status === "APPROVED" && !r.linkedProject)} onClick={() => setCreating(true)}>Create project</Button> : null}
      </div>
      {dirty ? <p className="text-xs text-muted-foreground">Save requirement changes before creating a project.</p> : null}
    </div>
    {creating ? <CreateHandoverDialog client={client} requirements={data} onClose={() => setCreating(false)} /> : null}
  </Panel>;
}
