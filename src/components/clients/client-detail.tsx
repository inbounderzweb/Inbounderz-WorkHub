"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowLeft, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Panel } from "@/components/dashboard/panel";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataPagination } from "@/components/shared/data-pagination";
import { DetailSkeleton } from "@/components/shared/skeletons";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { FormRow } from "@/components/shared/form-row";
import { ProjectStatusBadge } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { api, fetcher, qs } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import { formatDay } from "@/lib/dates";
import type { AddressDTO, ClientContactDTO, ClientDTO, ClientHistoryDTO, ClientProjectDTO, Paginated } from "@/types/dto";
import { ClientStatusBadge } from "./client-badges";
import { ClientFormDialog } from "./client-form-dialog";
import { ClientRequirements } from "./client-requirements";

const stamp = (iso: string) => format(new Date(iso), "d MMM yyyy, HH:mm");

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function Address({ a }: { a?: AddressDTO }) {
  const lines = a ? [a.line1, a.line2, [a.city, a.state, a.postalCode].filter(Boolean).join(", "), a.country].filter(Boolean) : [];
  return lines.length ? <>{lines.map((l, i) => <span key={i} className="block">{l}</span>)}</> : null;
}

function Contacts({ client }: { client: ClientDTO }) {
  const { data, error, mutate } = useSWR<ClientContactDTO[]>(`/api/clients/${client.id}/contacts`, fetcher);
  const [editing, setEditing] = useState<ClientContactDTO | "new" | null>(null);
  const [removing, setRemoving] = useState<ClientContactDTO | null>(null);
  const canEdit = !!client.can?.update;
  return (
    <Panel title="Additional contacts" action={canEdit ? <Button size="sm" onClick={() => setEditing("new")}><Plus /> Add contact</Button> : undefined}>
      {error ? <ErrorState message={error.message} onRetry={() => mutate()} /> : !data ? <p className="p-6 text-sm text-muted-foreground">Loading…</p> : !data.length ? (
        <EmptyState title="No additional contacts" description="The main contact is on the Overview tab." />
      ) : (
        <ul className="divide-y">
          {data.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 text-sm">
                <p className="font-medium">{c.name}{c.designation ? <span className="font-normal text-muted-foreground"> · {c.designation}</span> : null}</p>
                <p className="text-muted-foreground">{[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details"}</p>
                {c.notes ? <p className="mt-1 text-xs text-muted-foreground">{c.notes}</p> : null}
              </div>
              {canEdit ? (
                <div className="flex shrink-0 gap-1">
                  <Button size="icon" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Pencil /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => setRemoving(c)}><Trash2 /></Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ContactDialog clientId={client.id} contact={editing && editing !== "new" ? editing : undefined} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} onSaved={() => mutate()} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name}?`}
        description="The contact is hidden from this client. Its history is kept."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          await api(`/api/clients/${client.id}/contacts/${removing!.id}`, { method: "DELETE" });
          toast.success("Contact removed");
          mutate();
        }}
      />
    </Panel>
  );
}

function ContactDialog({ clientId, contact, open, onOpenChange, onSaved }: { clientId: string; contact?: ClientContactDTO; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: "", designation: "", email: "", phone: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const key = open ? (contact?.id ?? "new") : null;
  if (key !== seed) {
    setSeed(key);
    if (key) setV({ name: contact?.name ?? "", designation: contact?.designation ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "", notes: contact?.notes ?? "" });
    setErrors({});
  }
  async function save() {
    setBusy(true);
    try {
      await api(contact ? `/api/clients/${clientId}/contacts/${contact.id}` : `/api/clients/${clientId}/contacts`, { method: contact ? "PATCH" : "POST", body: v });
      toast.success(contact ? "Contact updated" : "Contact added");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      handleFormError(err);
      if (err && typeof err === "object" && "fieldErrors" in err) setErrors(((err as { fieldErrors?: Record<string, string> }).fieldErrors) ?? {});
    } finally {
      setBusy(false);
    }
  }
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>Another person to reach at this client.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormRow label="Name" htmlFor="ct-name" required error={errors.name}><Input id="ct-name" value={v.name} onChange={set("name")} /></FormRow>
          <FormRow label="Designation" htmlFor="ct-des" error={errors.designation}><Input id="ct-des" value={v.designation} onChange={set("designation")} /></FormRow>
          <FormRow label="Email" htmlFor="ct-email" error={errors.email}><Input id="ct-email" type="email" value={v.email} onChange={set("email")} /></FormRow>
          <FormRow label="Phone" htmlFor="ct-phone" error={errors.phone}><Input id="ct-phone" type="tel" value={v.phone} onChange={set("phone")} /></FormRow>
          <FormRow label="Notes" htmlFor="ct-notes" error={errors.notes}><Textarea id="ct-notes" rows={2} value={v.notes} onChange={set("notes")} /></FormRow>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || v.name.trim().length < 2}>{busy ? <Spinner /> : null} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Projects({ clientId }: { clientId: string }) {
  const { data, error, mutate } = useSWR<ClientProjectDTO[]>(`/api/clients/${clientId}/projects`, fetcher);
  return (
    <Panel title="Projects">
      {error ? <ErrorState message={error.message} onRetry={() => mutate()} /> : !data ? <p className="p-6 text-sm text-muted-foreground">Loading…</p> : !data.length ? (
        <EmptyState title="No projects yet" description="Projects you can see for this client appear here." />
      ) : (
        <ul className="divide-y">
          {data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div className="min-w-0">
                <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                <p className="text-xs text-muted-foreground"><span className="font-mono">{p.code}</span> · {formatDay(p.startDate)} → {formatDay(p.endDate)}</p>
              </div>
              <div className="flex items-center gap-3">
                {p.manager ? <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserAvatar name={p.manager.name} src={p.manager.avatarUrl} className="size-5" /> {p.manager.name}</span> : null}
                <ProjectStatusBadge status={p.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "empty" : Array.isArray(v) ? v.join(", ") : String(v));

function History({ clientId }: { clientId: string }) {
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useSWR<Paginated<ClientHistoryDTO>>(`/api/clients/${clientId}/history${qs({ page, pageSize: 20 })}`, fetcher, { keepPreviousData: true });
  return (
    <Panel title="History">
      {error ? <ErrorState message={error.message} onRetry={() => mutate()} /> : !data ? <p className="p-6 text-sm text-muted-foreground">Loading…</p> : (
        <>
          <ol className="divide-y">
            {data.items.map((h) => (
              <li key={h.id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{h.summary || h.action}</p>
                  <p className="text-xs text-muted-foreground">{h.actor?.name ?? "System"} · {stamp(h.createdAt)}</p>
                </div>
                {h.reason ? <p className="text-xs text-muted-foreground">Reason: {h.reason}</p> : null}
                {h.changes && h.action !== "CREATED" ? (
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {Object.entries(h.changes).map(([f, c]) => <li key={f}><span className="font-mono">{f}</span>: {show(c.from)} → {show(c.to)}</li>)}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
          <DataPagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} onPageChange={setPage} label="entries" />
        </>
      )}
    </Panel>
  );
}

export function ClientDetail({ id }: { id: string }) {
  const { data: c, error, isLoading, mutate } = useSWR<ClientDTO>(`/api/clients/${id}`, fetcher);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  if (isLoading && !c) return <DetailSkeleton />;
  if (error || !c) return <ErrorState message={error?.message ?? "Client not found"} onRetry={() => mutate()} />;
  const full = c.viewLevel === "FULL";
  const archived = c.status === "ARCHIVED";

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Clients</Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{c.name}</h1>
              <ClientStatusBadge status={c.status} />
            </div>
            <p className="text-sm text-muted-foreground"><span className="font-mono">{c.clientCode}</span>{c.businessCategory ? ` · ${c.businessCategory}` : ""}{c.migratedFromProjects ? " · imported from project records" : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {c.can?.update ? <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button> : null}
            {c.can?.archive ? (
              <Button variant="outline" onClick={() => setArchiveOpen(true)}>{archived ? <><ArchiveRestore /> Restore</> : <><Archive /> Archive</>}</Button>
            ) : null}
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="gap-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {full ? <TabsTrigger value="contacts">Contacts</TabsTrigger> : null}
          {full ? <TabsTrigger value="requirements">Service Requirements</TabsTrigger> : null}
          <TabsTrigger value="projects">Projects{c.projectCount !== undefined ? ` (${c.projectCount})` : ""}</TabsTrigger>
          {full ? <TabsTrigger value="history">History</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Panel title="Client">
            <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {c.contactPerson !== undefined ? <Field label="Contact person">{c.contactPerson}</Field> : null}
              {full ? <Field label="Contact designation">{c.contactDesignation}</Field> : null}
              {full ? <Field label="Contact email">{c.contactEmail}</Field> : null}
              {full ? <Field label="Contact phone">{c.contactPhone}</Field> : null}
              {full ? <Field label="Alternate business phone">{c.alternatePhone}</Field> : null}
              {full ? <Field label="Email">{c.email}</Field> : null}
              {full ? <Field label="Phone">{c.phone}</Field> : null}
              {full && (c.alternateContact?.name || c.alternateContact?.email || c.alternateContact?.phone) ? (
                <Field label="Alternate contact">{[c.alternateContact.name, c.alternateContact.email, c.alternateContact.phone].filter(Boolean).join(" · ")}</Field>
              ) : null}
              <Field label="Website">{c.website ? <a href={c.website} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{c.website}</a> : null}</Field>
              {c.salesOwner !== undefined ? <Field label="Sales Executive">{c.salesOwner?.name ?? "Unassigned"}</Field> : null}
              {c.projectManager !== undefined ? <Field label="Project Manager">{c.projectManager?.name ?? "Not assigned"}</Field> : null}
              {full ? <Field label="Business address"><Address a={c.businessAddress} /></Field> : null}
              {full && c.notes ? <Field label="Internal notes">{c.notes}</Field> : null}
            </dl>
          </Panel>
          {full ? (
            <Panel title="Billing and tax" description="Restricted to Admins, the owning Sales Executive and the project's Project Managers.">
              <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Billing address">{c.billingSameAsBusiness ? "Same as business address" : <Address a={c.billingAddress} />}</Field>
                <Field label="GSTIN">{c.gst?.gstin ? <span className="font-mono">{c.gst.gstin}</span> : null}</Field>
                <Field label="GST legal name">{c.gst?.legalName}</Field>
                <Field label="GST state">{c.gst?.stateName}</Field>
                <Field label="Default currency">{c.defaultCurrency}</Field>
              </dl>
              {c.gst?.gstin ? <p className="flex items-center gap-1.5 border-t px-4 py-2 text-xs text-muted-foreground"><ShieldAlert className="size-3.5" /> Format and checksum verified. Active GST registration has not been checked.</p> : null}
            </Panel>
          ) : null}
          {full ? <p className="text-xs text-muted-foreground">Created {c.createdAt ? stamp(c.createdAt) : ""}{c.createdBy ? ` by ${c.createdBy.name}` : ""}{c.updatedBy ? ` · last updated ${stamp(c.updatedAt!)} by ${c.updatedBy.name}` : ""}</p> : null}
        </TabsContent>
        {full ? <TabsContent value="contacts"><Contacts client={c} /></TabsContent> : null}
        {full ? <TabsContent value="requirements"><ClientRequirements client={c} /></TabsContent> : null}
        <TabsContent value="projects"><Projects clientId={c.id} /></TabsContent>
        {full ? <TabsContent value="history"><History clientId={c.id} /></TabsContent> : null}
      </Tabs>

      <ClientFormDialog open={editOpen} onOpenChange={setEditOpen} client={c} onSaved={() => mutate()} />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={archived ? `Restore ${c.name}?` : `Archive ${c.name}?`}
        description={archived ? "The client becomes active again." : "Archived clients are hidden from lists and can be restored by an Admin. Their projects are not affected."}
        confirmLabel={archived ? "Restore" : "Archive"}
        destructive={!archived}
        onConfirm={async () => {
          try {
            await api(`/api/clients/${c.id}`, { method: "PATCH", body: { status: archived ? "ACTIVE" : "ARCHIVED", expectedUpdatedAt: c.updatedAt } });
            toast.success(archived ? "Client restored" : "Client archived");
            mutate();
          } catch (err) {
            handleFormError(err);
            throw err;
          }
        }}
      />
    </div>
  );
}
