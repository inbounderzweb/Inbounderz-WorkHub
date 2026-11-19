"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { FormRow } from "@/components/shared/form-row";
import { EmployeePicker } from "@/components/shared/employee-picker";
import { useCurrentUser } from "@/components/providers/user-provider";
import { useDebounce } from "@/hooks/use-debounce";
import { useEmployeeOptions } from "@/hooks/use-options";
import { BUSINESS_CATEGORIES, CURRENCIES, DEFAULT_CURRENCY, humanize } from "@/lib/constants";
import { api, ApiClientError, fetcher } from "@/lib/http";
import { hasPermission } from "@/lib/permissions";
import { handleFormError } from "@/lib/form";
import { createClientSchema, type CreateClientInput } from "@/lib/validations/client";
import type { ClientDTO, DuplicateMatchDTO, RequirementDTO } from "@/types/dto";
import { ClientStatusBadge } from "./client-badges";
import { draftFromDTO, draftPayload, RequirementsEditor, type RequirementDraft } from "./requirement-form";

const emptyAddress = { line1: "", line2: "", city: "", state: "", postalCode: "", country: "India" };

function defaults(c?: ClientDTO): CreateClientInput {
  return {
    name: c?.name ?? "",
    contactPerson: c?.contactPerson ?? "",
    contactDesignation: c?.contactDesignation ?? "",
    contactEmail: c?.contactEmail ?? "",
    contactPhone: c?.contactPhone ?? "",
    alternatePhone: c?.alternatePhone ?? "",
    requirements: [],
    email: c?.email ?? "",
    phone: c?.phone ?? "",
    alternateContact: c?.alternateContact ?? { name: "", email: "", phone: "" },
    businessCategory: c?.businessCategory ?? "",
    website: c?.website ?? "",
    businessAddress: c?.businessAddress ?? emptyAddress,
    billingSameAsBusiness: c?.billingSameAsBusiness ?? true,
    billingAddress: c?.billingAddress ?? emptyAddress,
    gst: { gstin: c?.gst?.gstin ?? "", legalName: c?.gst?.legalName ?? "" },
    defaultCurrency: c?.defaultCurrency ?? DEFAULT_CURRENCY,
    notes: c?.notes ?? "",
    status: c?.status ?? "PROSPECT",
    salesOwner: c?.salesOwner?.id ?? "",
    projectManager: c?.projectManager?.id ?? "",
    acknowledgeDuplicates: false,
    duplicateOverrideReason: "",
  };
}

type DuplicatePrompt = { code: "DUPLICATE_BLOCK" | "DUPLICATE_WARNING"; duplicates: DuplicateMatchDTO[]; canOverride: boolean; minReasonLength?: number; error: string };

const MATCH_LABEL = { email: "same email", phone: "same phone", name: "similar name" } as const;

function DuplicateList({ duplicates }: { duplicates: DuplicateMatchDTO[] }) {
  return (
    <ul className="divide-y rounded-lg border bg-card text-sm">
      {duplicates.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <span className="font-mono text-xs text-muted-foreground">{d.clientCode}</span>
          {d.canOpen ? (
            <Link href={`/clients/${d.id}`} target="_blank" className="font-medium underline-offset-2 hover:underline">{d.name}</Link>
          ) : (
            <span className="font-medium">{d.name}</span>
          )}
          <ClientStatusBadge status={d.status} />
          <span className="text-xs text-muted-foreground">
            {d.matched.map((m) => MATCH_LABEL[m]).join(", ")}
            {d.salesOwner ? ` · owned by ${d.salesOwner.name}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AddressFields({ prefix, errors, register }: { prefix: "businessAddress" | "billingAddress"; errors: Record<string, { message?: string } | undefined>; register: ReturnType<typeof useForm<CreateClientInput>>["register"] }) {
  const field = (k: "line1" | "line2" | "city" | "state" | "postalCode" | "country", label: string, span = "") => (
    <FormRow label={label} htmlFor={`${prefix}-${k}`} error={errors?.[k]?.message} className={span}>
      <Input id={`${prefix}-${k}`} {...register(`${prefix}.${k}`)} />
    </FormRow>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {field("line1", "Address line 1", "sm:col-span-2")}
      {field("line2", "Address line 2", "sm:col-span-2")}
      {field("city", "City")}
      {field("state", "State")}
      {field("postalCode", "Postal code")}
      {field("country", "Country")}
    </div>
  );
}

function ClientFormContents({
  open,
  onOpenChange,
  client,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: ClientDTO;
  onSaved?: (c: ClientDTO) => void;
}) {
  const isEdit = !!client;
  const me = useCurrentUser();
  const isAdmin = me.role === "SUPER_ADMIN";
  // Create: Admin and Sales may fill restricted data. Edit: whatever the server says this user may change.
  // Anyone allowed to create clients gets the full onboarding form (billing/GST and service requirements), not just the Sales role.
  const canRestricted = isEdit ? !!client.can?.editRestricted : isAdmin || me.role === "SALES_EXECUTIVE" || hasPermission(me.role, "client:create");
  const canStatus = isEdit ? !!client.can?.changeStatus : true;
  const canArchive = isEdit ? !!client.can?.archive : false;
  const { mutate } = useSWRConfig();
  const requirementsKey = isEdit ? `/api/clients/${client.id}/requirements` : null;
  const { data: requirements, error: requirementsError, isLoading: requirementsLoading } = useSWR<RequirementDTO[]>(open && canRestricted ? requirementsKey : null, fetcher, { revalidateOnFocus: false });
  const [editedDrafts, setDrafts] = useState<RequirementDraft[] | null>(null);
  const drafts = editedDrafts ?? (requirements ?? []).map(draftFromDTO);
  const [editVersion] = useState(client?.updatedAt);
  const [requirementErrors, setRequirementErrors] = useState<Record<string, string>>({});

  const { register, handleSubmit, control, formState, setError } = useForm<CreateClientInput>({
    resolver: zodResolver(createClientSchema) as never,
    defaultValues: defaults(client),
  });
  const [watchedName, watchedEmail, watchedPhone, billingSame, defaultCurrency] = useWatch({ control, name: ["name", "email", "phone", "billingSameAsBusiness", "defaultCurrency"] });
  const [prompt, setPrompt] = useState<DuplicatePrompt | null>(null);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const promptRef = useRef<HTMLDivElement>(null);

  // The warning renders below a long form; bring it into view so it can't be missed.
  useEffect(() => {
    if (prompt) promptRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [prompt]);

  const { data: pmData, isLoading: pmsLoading, error: pmsError, mutate: retryPms } = useSWR<{ pms: { id: string; name: string; email: string; employeeId: string; avatarUrl: string | null }[] }>(open ? "/api/handover/pm-options" : null, fetcher);
  const pmOptions = (pmData?.pms ?? []).map((p) => ({ id: p.id, name: p.name, email: p.email, employeeId: p.employeeId, avatarUrl: p.avatarUrl ?? undefined }));
  const { data: owners, isLoading: ownersLoading } = useEmployeeOptions({ role: "SALES_EXECUTIVE", status: "ACTIVE" }, open && isAdmin);

  // Early, non-blocking duplicate hint while typing.
  const [name, email, phone] = [useDebounce(watchedName ?? "", 500), useDebounce(watchedEmail ?? "", 500), useDebounce(watchedPhone ?? "", 500)];
  const liveKey = open && name.trim().length >= 2 ? ["client-dup", name, email, phone, client?.id ?? ""] : null;
  const { data: live } = useSWR(liveKey, () => api<{ duplicates: DuplicateMatchDTO[] }>("/api/clients/check-duplicates", { method: "POST", body: { name, email, phone, excludeId: client?.id ?? null } }), { shouldRetryOnError: false });
  const liveDuplicates = !prompt && live?.duplicates.length ? live.duplicates : [];

  async function submit(values: CreateClientInput, extra: { acknowledgeDuplicates?: boolean; duplicateOverrideReason?: string } = {}) {
    if (requirementsLoading || requirementsError) return;
    if (!isEdit && !values.projectManager) { setError("projectManager", { message: "Select the Project Manager who will review this client" }); return; }
    const body: Record<string, unknown> = { ...values, salesOwner: isAdmin && values.salesOwner ? values.salesOwner : undefined, projectManager: values.projectManager || undefined, ...extra };
    if (canRestricted && client?.status !== "ARCHIVED") body.requirements = drafts.map(draftPayload);
    else delete body.requirements;
    setRequirementErrors({});
    if (isEdit) {
      if (!canRestricted) for (const k of ["gst", "billingAddress", "billingSameAsBusiness", "defaultCurrency"]) delete body[k];
      if (!canStatus) delete body.status;
      if (!isAdmin) delete body.salesOwner;
      body.expectedUpdatedAt = editVersion;
    } else if (!canRestricted) {
      for (const k of ["gst", "billingAddress", "billingSameAsBusiness", "defaultCurrency"]) delete body[k];
    }
    try {
      const saved = isEdit
        ? await api<ClientDTO>(`/api/clients/${client.id}`, { method: "PATCH", body })
        : await api<ClientDTO>("/api/clients", { method: "POST", body });
      toast.success(isEdit ? "Client updated" : `${saved.name} created`);
      if (requirementsKey) await mutate(requirementsKey);
      await mutate(`/api/clients/${saved.id}`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      const code = err instanceof ApiClientError ? (err.data?.code as string | undefined) : undefined;
      if (err instanceof ApiClientError && (code === "DUPLICATE_BLOCK" || code === "DUPLICATE_WARNING")) {
        setPrompt({ code, duplicates: (err.data?.duplicates ?? []) as DuplicateMatchDTO[], canOverride: !!err.data?.canOverride, minReasonLength: err.data?.minReasonLength as number | undefined, error: err.message });
        return;
      }
      handleFormError(err, setError);
      if (err instanceof ApiClientError) setRequirementErrors(err.fieldErrors ?? {});
    }
  }

  const e = formState.errors;
  const reasonOk = reason.trim().length >= (prompt?.minReasonLength ?? 10);

  return (
    <Dialog open={open} onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${client.name}` : "New client"}</DialogTitle>
          <DialogDescription>Company, main contact and commercial details. Projects are created separately under a client.</DialogDescription>
        </DialogHeader>

        <form id="client-form" onSubmit={handleSubmit((v) => submit(v))} noValidate className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Company name" htmlFor="c-name" required error={e.name?.message} className="sm:col-span-2">
            <Input id="c-name" aria-invalid={!!e.name} {...register("name")} />
          </FormRow>
          <FormRow label="Contact person" htmlFor="c-contact" required error={e.contactPerson?.message}>
            <Input id="c-contact" aria-invalid={!!e.contactPerson} {...register("contactPerson")} />
          </FormRow>
          <FormRow label="Business category" htmlFor="c-cat" error={e.businessCategory?.message}>
            <Controller control={control} name="businessCategory" render={({ field }) => (
              <Select value={field.value || "__none"} onValueChange={(v) => field.onChange(v === "__none" ? "" : v)}>
                <SelectTrigger id="c-cat"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Not set</SelectItem>
                  {BUSINESS_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </FormRow>
          <FormRow label="Email" htmlFor="c-email" error={e.email?.message} description="Email or phone is required.">
            <Input id="c-email" type="email" autoComplete="off" aria-invalid={!!e.email} {...register("email")} />
          </FormRow>
          <FormRow label="Phone" htmlFor="c-phone" error={e.phone?.message}>
            <Input id="c-phone" type="tel" autoComplete="off" placeholder="+91 98765 43210" aria-invalid={!!e.phone} {...register("phone")} />
          </FormRow>
          <FormRow label="Contact designation" htmlFor="c-designation" error={e.contactDesignation?.message}><Input id="c-designation" {...register("contactDesignation")} /></FormRow>
          <FormRow label="Contact email" htmlFor="c-person-email" error={e.contactEmail?.message}><Input id="c-person-email" type="email" {...register("contactEmail")} /></FormRow>
          <FormRow label="Contact phone" htmlFor="c-person-phone" error={e.contactPhone?.message}><Input id="c-person-phone" type="tel" {...register("contactPhone")} /></FormRow>
          <FormRow label="Alternate business phone" htmlFor="c-alt-phone" error={e.alternatePhone?.message}><Input id="c-alt-phone" type="tel" {...register("alternatePhone")} /></FormRow>
          <FormRow label="Alternate contact name" htmlFor="c-alt-name" error={e.alternateContact?.name?.message}>
            <Input id="c-alt-name" {...register("alternateContact.name")} />
          </FormRow>
          <FormRow label="Alternate contact email / phone" htmlFor="c-alt-email" error={e.alternateContact?.email?.message ?? e.alternateContact?.phone?.message}>
            <div className="flex gap-2">
              <Input id="c-alt-email" type="email" placeholder="Email" {...register("alternateContact.email")} />
              <Input type="tel" placeholder="Phone" aria-label="Alternate phone" {...register("alternateContact.phone")} />
            </div>
          </FormRow>
          <FormRow label="Website" htmlFor="c-web" error={e.website?.message} className="sm:col-span-2">
            <Input id="c-web" placeholder="example.com" {...register("website")} />
          </FormRow>

          {liveDuplicates.length ? (
            <div className="space-y-2 sm:col-span-2" role="status">
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700"><AlertTriangle className="size-4" /> This looks like an existing client</p>
              <DuplicateList duplicates={liveDuplicates} />
            </div>
          ) : null}

          <fieldset className="space-y-3 sm:col-span-2">
            <legend className="text-sm font-medium">Business address</legend>
            <AddressFields prefix="businessAddress" errors={(e.businessAddress ?? {}) as never} register={register} />
          </fieldset>

          {canRestricted ? (
            <>
              <fieldset className="space-y-3 sm:col-span-2">
                <legend className="flex items-center gap-1.5 text-sm font-medium"><ShieldAlert className="size-4 text-muted-foreground" /> Billing and tax (restricted)</legend>
                <Controller control={control} name="billingSameAsBusiness" render={({ field }) => (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} /> Billing address is the same as the business address
                  </label>
                )} />
                {billingSame ? null : <AddressFields prefix="billingAddress" errors={(e.billingAddress ?? {}) as never} register={register} />}
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormRow label="GSTIN (optional)" htmlFor="c-gstin" error={e.gst?.gstin?.message} description="Checked for format and checksum only. This does not confirm an active GST registration.">
                    <Input id="c-gstin" className="uppercase" maxLength={15} placeholder="27AAPFU0939F1ZV" aria-invalid={!!e.gst?.gstin} {...register("gst.gstin")} />
                  </FormRow>
                  <FormRow label="GST legal name" htmlFor="c-gst-name" error={e.gst?.legalName?.message}>
                    <Input id="c-gst-name" {...register("gst.legalName")} />
                  </FormRow>
                  <FormRow label="Default currency" htmlFor="c-cur" error={e.defaultCurrency?.message}>
                    <Controller control={control} name="defaultCurrency" render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="c-cur"><SelectValue /></SelectTrigger>
                        <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    )} />
                  </FormRow>
                </div>
              </fieldset>
            </>
          ) : null}

          {canStatus ? (
            <FormRow label="Status" htmlFor="c-status" error={e.status?.message}>
              <Controller control={control} name="status" render={({ field }) => (
                <Select value={field.value ?? "ACTIVE"} onValueChange={field.onChange}>
                  <SelectTrigger id="c-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["PROSPECT", "ACTIVE", "INACTIVE", ...(canArchive ? ["ARCHIVED"] : [])] as const).map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </FormRow>
          ) : null}
          {isAdmin ? (
            <FormRow label="Sales Executive" htmlFor="c-owner" error={e.salesOwner?.message} description="Leave empty to own it yourself.">
              <Controller control={control} name="salesOwner" render={({ field }) => (
                <EmployeePicker id="c-owner" options={owners} loading={ownersLoading} value={field.value || null} onChange={(v) => field.onChange(v ?? "")} allowClear placeholder="Select a Sales Executive" emptyText="No active Sales Executives." />
              )} />
            </FormRow>
          ) : null}
          <FormRow label="Project Manager" htmlFor="c-pm" required={!isEdit} error={e.projectManager?.message} description="Gets a notification to review and approve this client, and is pre-selected when you create the project." className="sm:col-span-2">
            <Controller control={control} name="projectManager" render={({ field }) => (
              <EmployeePicker id="c-pm" options={pmOptions} loading={pmsLoading} value={field.value || null} onChange={(v) => field.onChange(v ?? "")} allowClear={isEdit} placeholder={pmsLoading ? "Loading Project Managers…" : "Select a Project Manager"} emptyText="No active Project Managers." />
            )} />
            {pmsError ? <p role="alert" className="mt-1 text-xs text-destructive">Couldn&apos;t load Project Managers: {pmsError.message}. <button type="button" className="underline" onClick={() => retryPms()}>Retry</button></p> : null}
            {!pmsLoading && !pmsError && pmData && !pmOptions.length ? <p className="mt-1 text-xs text-destructive">There is no active Project Manager to choose from. Ask an Admin to add one in Employees.</p> : null}
          </FormRow>
          <FormRow label="Internal notes" htmlFor="c-notes" error={e.notes?.message} className="sm:col-span-2">
            <Textarea id="c-notes" rows={3} {...register("notes")} />
          </FormRow>
          {canRestricted && client?.status !== "ARCHIVED" ? (
            <fieldset className="space-y-3 sm:col-span-2">
              <legend className="text-sm font-medium">Service requirements</legend>
              {requirementsError ? <p role="alert" className="text-sm text-destructive">Could not load requirements. Reopen the form to retry.</p> : requirementsLoading ? <p className="text-sm">Loading requirements…</p> : <RequirementsEditor value={drafts} onChange={setDrafts} errors={requirementErrors} disabled={formState.isSubmitting} defaultCurrency={defaultCurrency} />}
            </fieldset>
          ) : null}
        </form>

        {prompt ? (
          <div ref={promptRef} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3" role="alert">
            <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
              <AlertTriangle className="size-4" /> {prompt.code === "DUPLICATE_BLOCK" ? "Duplicate client blocked" : "Similar clients found"}
            </p>
            <p className="text-sm text-amber-900">{prompt.error}</p>
            <DuplicateList duplicates={prompt.duplicates} />
            {prompt.code === "DUPLICATE_WARNING" ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} /> I have checked these and this is a different client
              </label>
            ) : prompt.canOverride ? (
              <FormRow label="Override reason (required, recorded in the audit trail)" htmlFor="c-override">
                <Textarea id="c-override" rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Why does this need a separate record?" />
              </FormRow>
            ) : (
              <p className="text-sm text-amber-900">Open the existing client instead. Only an Admin can override this block.</p>
            )}
          </div>
        ) : null}

        {/* Pinned: the form is taller than most windows, and Save must never scroll out of sight. */}
        <DialogFooter className="sticky -bottom-4 z-10 bg-popover">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>Cancel</Button>
          {prompt?.code === "DUPLICATE_WARNING" ? (
            <Button type="button" disabled={!acknowledged || formState.isSubmitting} onClick={handleSubmit((v) => submit(v, { acknowledgeDuplicates: true }))}>
              {formState.isSubmitting ? <Spinner /> : null} {isEdit ? "Save anyway" : "Create anyway"}
            </Button>
          ) : prompt?.code === "DUPLICATE_BLOCK" ? (
            prompt.canOverride ? (
              <Button type="button" variant="destructive" disabled={!reasonOk || formState.isSubmitting} onClick={handleSubmit((v) => submit(v, { duplicateOverrideReason: reason.trim() }))}>
                {formState.isSubmitting ? <Spinner /> : null} Override and {isEdit ? "save" : "create"}
              </Button>
            ) : null
          ) : (
            <Button type="submit" form="client-form" disabled={formState.isSubmitting || requirementsLoading || !!requirementsError}>
              {formState.isSubmitting ? <Spinner /> : null} {isEdit ? "Save changes" : "Create client"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Mount a fresh editing session on open so cancelled drafts never carry into another client. */
export function ClientFormDialog(props: React.ComponentProps<typeof ClientFormContents>) {
  return props.open ? <ClientFormContents {...props} /> : null;
}
