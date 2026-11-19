"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown, Clapperboard, Globe, Plus, Search, Share2, TrendingUp, Trash2, X, Zap, Lock, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormRow } from "@/components/shared/form-row";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  REQUIREMENT_STATUSES,
  REQUIREMENT_STATUS_LABELS,
  SERVICE_LABELS,
  SERVICE_TYPES,
  type Currency,
  type RequirementStatus,
  type ServiceType,
} from "@/lib/constants";
import {
  BUDGET_LABEL,
  SERVICE_AMOUNTS,
  SERVICE_FIELDS,
  defaultConfig,
  parseRequirement,
  summarizeRequirement,
  type FieldSpec,
} from "@/lib/clients/service-requirements";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { RequirementDTO } from "@/types/dto";
import { RequirementStatusBadge } from "./client-badges";

/** What the form edits. Numbers stay as text while typing; the shared schema coerces them. */
export type RequirementDraft = {
  /** Local identity (stable across edits); `id` is the stored requirement's id, absent for new ones. */
  key: string;
  id?: string;
  serviceType: ServiceType;
  status: RequirementStatus;
  currency: Currency;
  proposedBudget: string;
  adSpend: string;
  agencyFee: string;
  config: Record<string, unknown>;
  /** Code of the live project this requirement belongs to. A linked requirement is read-only. */
  lockedBy?: string;
};

const uid = () => Math.random().toString(36).slice(2, 10);
export const newDraft = (serviceType: ServiceType, currency: Currency = DEFAULT_CURRENCY): RequirementDraft => ({
  key: uid(), serviceType, status: "INTERESTED", currency, proposedBudget: "", adSpend: "", agencyFee: "", config: defaultConfig(serviceType),
});
const str = (n: number | null) => (n === null || n === undefined ? "" : String(n));
export const draftFromDTO = (r: RequirementDTO): RequirementDraft => ({
  key: r.id, id: r.id, serviceType: r.serviceType, status: r.status, currency: r.currency,
  proposedBudget: str(r.proposedBudget), adSpend: str(r.adSpend), agencyFee: str(r.agencyFee), config: { ...defaultConfig(r.serviceType), ...r.config },
  lockedBy: r.linkedProject?.code,
});
export const draftPayload = (d: RequirementDraft) => ({
  ...(d.id ? { id: d.id } : {}), serviceType: d.serviceType, status: d.status, currency: d.currency,
  proposedBudget: d.proposedBudget, adSpend: d.adSpend, agencyFee: d.agencyFee, config: d.config,
});
/** The same rules the server applies, so problems show before saving. The server stays authoritative. */
export function draftErrors(d: RequirementDraft): Record<string, string> {
  const r = parseRequirement(draftPayload(d));
  return r.ok ? {} : r.errors;
}
/** Server errors arrive as `<prefix>.<index>.<field>`; returns the ones for one item. */
export function errorsFor(all: Record<string, string>, prefix: string, index: number): Record<string, string> {
  const head = `${prefix}.${index}.`;
  return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(head)).map(([k, v]) => [k.slice(head.length), v]));
}

const ICONS: Record<ServiceType, typeof Share2> = { SMM: Share2, SEM: Search, SEO: TrendingUp, WEBSITE: Globe, VIDEO: Clapperboard, QUICK_WORK: Zap };

/* ------------------------------ Fields ------------------------------ */

function TagsInput({ id, value, onChange, disabled, invalid }: { id: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; invalid?: boolean }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim().replace(/,$/, "").trim();
    if (t && !value.includes(t) && value.length < 50) onChange([...value, t]);
    setText("");
  };
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5", invalid && "border-destructive")}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
          {t}
          {disabled ? null : <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}><X className="size-3" /></button>}
        </span>
      ))}
      <input
        id={id} disabled={disabled} value={text} onChange={(e) => setText(e.target.value)} onBlur={add}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1)); }}
        className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none"
      />
    </div>
  );
}

function Field({ spec, value, onChange, error, disabled, id }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; error?: string; disabled?: boolean; id: string }) {
  const invalid = !!error;
  const wrap = (child: React.ReactNode) => (
    <FormRow label={spec.label} htmlFor={id} required={spec.required} error={error} description={spec.hint} className={spec.wide ? "sm:col-span-2" : undefined}>{child}</FormRow>
  );
  switch (spec.kind) {
    case "count":
    case "number":
      return wrap(<Input id={id} type="number" inputMode="decimal" min={0} step={spec.kind === "count" ? 1 : "any"} disabled={disabled} aria-invalid={invalid} placeholder="0" value={value === 0 || value === null || value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value)} />);
    case "text":
      return wrap(<Input id={id} disabled={disabled} aria-invalid={invalid} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />);
    case "longtext":
      return wrap(<Textarea id={id} rows={2} disabled={disabled} aria-invalid={invalid} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />);
    case "date":
      return wrap(<Input id={id} type="date" disabled={disabled} aria-invalid={invalid} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />);
    case "auto-date":
      return wrap(<Input id={id} disabled value={value ? String(value) : "Today, when saved"} readOnly />);
    case "select":
      return wrap(
        <Select value={value ? String(value) : "__none"} onValueChange={(v) => onChange(v === "__none" ? null : v)} disabled={disabled}>
          <SelectTrigger id={id} aria-invalid={invalid}><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Not set</SelectItem>
            {spec.options!.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    case "multi": {
      const list = (Array.isArray(value) ? value : []) as string[];
      return wrap(
        <div className={cn("flex flex-wrap gap-2", invalid && "rounded-lg border border-destructive p-2")} role="group" aria-label={spec.label}>
          {spec.options!.map((o) => (
            <label key={o.value} className={cn("flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm", list.includes(o.value) && "border-primary/40 bg-primary/5")}>
              <Checkbox disabled={disabled} checked={list.includes(o.value)} onCheckedChange={(c) => onChange(c === true ? [...list, o.value] : list.filter((x) => x !== o.value))} />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "tags":
      return wrap(<TagsInput id={id} disabled={disabled} invalid={invalid} value={(Array.isArray(value) ? value : []) as string[]} onChange={onChange} />);
    case "flag":
      return (
        <label className={cn("flex items-center gap-2 text-sm", spec.wide && "sm:col-span-2")}>
          <Checkbox id={id} disabled={disabled} checked={!!value} onCheckedChange={(c) => onChange(c === true)} /> {spec.label}
        </label>
      );
  }
}

/** The configuration, money and status of one requirement. Shared by the form cards and the add/edit dialog. */
export function RequirementFields({ draft, onChange, errors, disabled, idPrefix }: { draft: RequirementDraft; onChange: (d: RequirementDraft) => void; errors: Record<string, string>; disabled?: boolean; idPrefix: string }) {
  const specs = SERVICE_FIELDS[draft.serviceType];
  const amounts = SERVICE_AMOUNTS[draft.serviceType];
  const setConfig = (key: string, v: unknown) => onChange({ ...draft, config: { ...draft.config, [key]: v } });
  const groups = [...new Set(specs.filter((s) => s.group).map((s) => s.group!))];
  const flagError = (group: string) => specs.filter((s) => s.group === group).map((s) => errors[`config.${s.key}`]).find(Boolean);
  const money = (key: "proposedBudget" | "adSpend" | "agencyFee", label: string) => (
    <FormRow key={key} label={label} htmlFor={`${idPrefix}-${key}`} error={errors[key]}>
      <Input id={`${idPrefix}-${key}`} type="number" min={0} step="any" inputMode="decimal" disabled={disabled} placeholder="0" aria-invalid={!!errors[key]} value={draft[key]} onChange={(e) => onChange({ ...draft, [key]: e.target.value })} />
    </FormRow>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormRow label="Status" htmlFor={`${idPrefix}-status`} error={errors.status} description="Choosing a service does not mean the client bought it." className="sm:col-span-2">
        <Select value={draft.status} onValueChange={(v) => onChange({ ...draft, status: v as RequirementStatus })} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-status`}><SelectValue /></SelectTrigger>
          <SelectContent>{REQUIREMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{REQUIREMENT_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
        </Select>
      </FormRow>
      {errors._ ? <p className="flex items-center gap-1.5 text-xs text-destructive sm:col-span-2"><TriangleAlert className="size-3.5" /> {errors._}</p> : null}

      {groups.map((g) => (
        <fieldset key={g} className="space-y-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">{g}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {specs.filter((f) => f.group === g).map((f) => <Field key={f.key} spec={f} id={`${idPrefix}-${f.key}`} value={draft.config[f.key]} onChange={(v) => setConfig(f.key, v)} disabled={disabled} />)}
          </div>
          {flagError(g) ? <p className="text-xs text-destructive">{flagError(g)}</p> : null}
        </fieldset>
      ))}
      {specs.filter((s) => !s.group).map((s) => (
        <Field key={s.key} spec={s} id={`${idPrefix}-${s.key}`} value={draft.config[s.key]} onChange={(v) => setConfig(s.key, v)} error={errors[`config.${s.key}`]} disabled={disabled} />
      ))}

      <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-medium">Money <span className="font-normal text-muted-foreground">(kept separate, never added together)</span></legend>
        <FormRow label="Currency" htmlFor={`${idPrefix}-currency`} error={errors.currency}>
          <Select value={draft.currency} onValueChange={(v) => onChange({ ...draft, currency: v as Currency })} disabled={disabled}>
            <SelectTrigger id={`${idPrefix}-currency`}><SelectValue /></SelectTrigger>
            <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </FormRow>
        {amounts.includes("proposedBudget") ? money("proposedBudget", BUDGET_LABEL[draft.serviceType]) : null}
        {amounts.includes("adSpend") ? money("adSpend", "Proposed advertising spend") : null}
        {amounts.includes("agencyFee") ? money("agencyFee", "Agency / management fee") : null}
      </fieldset>
    </div>
  );
}

/* ------------------------------ Card and editor ------------------------------ */

function RequirementCard({ idPrefix, draft, index, open, onToggle, onChange, onRemove, errors, disabled }: { idPrefix: string; draft: RequirementDraft; index: number; open: boolean; onToggle: () => void; onChange: (d: RequirementDraft) => void; onRemove: () => void; errors: Record<string, string>; disabled?: boolean }) {
  const Icon = ICONS[draft.serviceType];
  const locked = !!draft.lockedBy;
  const summary = summarizeRequirement(draft.serviceType, draft.config);
  const errorCount = Object.keys(errors).length;
  const amount = draft.serviceType === "SEM" ? (draft.adSpend ? `${formatMoney(Number(draft.adSpend), draft.currency)} ad spend` : "") : draft.proposedBudget ? formatMoney(Number(draft.proposedBudget), draft.currency) : "";
  return (
    <li className={cn("rounded-xl border bg-card", errorCount && "border-destructive/50")}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${idPrefix}-body-${draft.key}`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="size-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {SERVICE_LABELS[draft.serviceType]} <RequirementStatusBadge status={draft.status} />
              {errorCount ? <span className="inline-flex items-center gap-1 text-xs font-normal text-destructive"><TriangleAlert className="size-3" /> {errorCount} to fix</span> : null}
              {locked ? <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"><Lock className="size-3" /> In {draft.lockedBy}</span> : null}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{[summary, amount].filter(Boolean).join(" · ") || "No details yet"}</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
        </button>
        {locked || disabled ? null : <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${SERVICE_LABELS[draft.serviceType]} #${index + 1}`} onClick={onRemove}><Trash2 /></Button>}
      </div>
      <div id={`${idPrefix}-body-${draft.key}`} hidden={!open} className="border-t p-3">
        {locked ? <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">This requirement is part of project {draft.lockedBy}, so it can no longer be edited here.</p> : null}
        <RequirementFields draft={draft} onChange={onChange} errors={errors} disabled={disabled || locked} idPrefix={`${idPrefix}-req-${draft.key}`} />
      </div>
    </li>
  );
}

/**
 * The "Services the client needs" section: pick any number of services, each gets its own card with
 * its own fields and status. Removing a service keeps what was typed, so adding it back restores it.
 */
export function RequirementsEditor({ value, onChange, errors = {}, prefix = "requirements", disabled, defaultCurrency = DEFAULT_CURRENCY }: { value: RequirementDraft[]; onChange: (v: RequirementDraft[]) => void; errors?: Record<string, string>; prefix?: string; disabled?: boolean; defaultCurrency?: Currency }) {
  const editorId = useId();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const stash = useRef<Map<ServiceType, RequirementDraft[]>>(new Map());

  const add = (type: ServiceType) => {
    const back = stash.current.get(type)?.pop();
    const draft = back ?? newDraft(type, defaultCurrency);
    onChange([...value, draft]);
    setOpen((p) => new Set(p).add(draft.key));
  };
  const remove = (d: RequirementDraft) => {
    stash.current.set(d.serviceType, [...(stash.current.get(d.serviceType) ?? []), d]);
    onChange(value.filter((x) => x.key !== d.key));
  };
  const count = (t: ServiceType) => value.filter((d) => d.serviceType === t).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Add a service">
        {SERVICE_TYPES.map((t) => {
          const Icon = ICONS[t];
          const n = count(t);
          return (
            <button key={t} type="button" disabled={disabled} onClick={() => add(t)} className={cn("flex items-center gap-2.5 rounded-xl border bg-card p-2.5 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-50", n && "border-primary/40 bg-primary/5")}>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="size-4" /></span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate font-medium">{SERVICE_LABELS[t].replace(/ \(.*\)/, "")}</span>
                <span className="text-xs text-muted-foreground">{n ? `${n} added · add another` : "Add"}</span>
              </span>
              <Plus className="size-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
      {value.length ? (
        <ul className="space-y-2">
          {value.map((d, i) => (
            <RequirementCard
              key={d.key} idPrefix={editorId} draft={d} index={i} open={open.has(d.key) || Object.keys(errorsFor(errors, prefix, i)).length > 0} disabled={disabled}
              onToggle={() => setOpen((p) => { const n = new Set(p); if (n.has(d.key)) n.delete(d.key); else n.add(d.key); return n; })}
              onChange={(next) => onChange(value.map((x) => (x.key === d.key ? next : x)))}
              onRemove={() => remove(d)}
              errors={errorsFor(errors, prefix, i)}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No services yet. You can add them now or later from the client&apos;s Service Requirements tab.</p>
      )}
    </div>
  );
}
