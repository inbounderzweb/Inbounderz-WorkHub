/**
 * What Sales records for each service a client wants. Pure (no I/O): the server enforces it, the form
 * uses the same defaults/labels, and the tests exercise it directly.
 *
 * Validation tightens as a requirement advances. "Interested" only needs the service itself;
 * "Requirement collected" needs the scope filled in; "Quoted" and "Approved" also need an amount.
 * "Not proceeding" is never blocked, so a lead can always be closed out.
 */
import { z } from "zod";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  REQUIREMENT_STATUSES,
  SERVICE_TYPES,
  TASK_PRIORITIES,
  type RequirementStatus,
  type ServiceType,
} from "@/lib/constants";

export const SOCIAL_PLATFORMS = ["Instagram", "Facebook", "LinkedIn", "X (Twitter)", "YouTube", "Pinterest", "Snapchat", "WhatsApp", "Other"] as const;
export const VIDEO_PLATFORMS = [...SOCIAL_PLATFORMS, "TV / OTT", "Website"] as const;
export const WEBSITE_TYPES = ["WORDPRESS", "SHOPIFY", "OTHER_CMS", "CUSTOM", "REVAMP", "UIUX_ONLY"] as const;
export const WEBSITE_TYPE_LABELS: Record<(typeof WEBSITE_TYPES)[number], string> = {
  WORDPRESS: "WordPress",
  SHOPIFY: "Shopify",
  OTHER_CMS: "Other CMS",
  CUSTOM: "Custom development",
  REVAMP: "Website revamp",
  UIUX_ONLY: "UI/UX design only",
};
export const DOMAIN_HOSTING = ["NOT_NEEDED", "DOMAIN_ONLY", "HOSTING_ONLY", "DOMAIN_AND_HOSTING", "CLIENT_PROVIDED"] as const;
export const DOMAIN_HOSTING_LABELS: Record<(typeof DOMAIN_HOSTING)[number], string> = {
  NOT_NEEDED: "Not needed",
  DOMAIN_ONLY: "Domain only",
  HOSTING_ONLY: "Hosting only",
  DOMAIN_AND_HOSTING: "Domain and hosting",
  CLIENT_PROVIDED: "Client provides both",
};
export const BILLING_CYCLES = ["MONTHLY", "ONE_TIME"] as const;
export const BILLING_CYCLE_LABELS = { MONTHLY: "Monthly", ONE_TIME: "One-time" } as const;

/* ------------------------------ Field primitives ------------------------------ */

const blank = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const count = (max = 100000) => z.preprocess(blank, z.coerce.number().int("Use a whole number").min(0, "Cannot be negative").max(max, "Too large").default(0));
const optionalCount = (max: number) => z.preprocess(blank, z.coerce.number().int("Use a whole number").min(0, "Cannot be negative").max(max, "Too large").nullable().default(null));
const flag = z.preprocess(blank, z.boolean().default(false));
const text = (max = 2000) => z.preprocess(blank, z.string().trim().max(max, `Use at most ${max} characters`).default(""));
const list = (allowed?: readonly string[], max = 30) =>
  z.preprocess(
    blank,
    z
      .array(z.string().trim().min(1).max(80))
      .max(max, `Choose at most ${max}`)
      .default([])
      .refine((a) => !allowed || a.every((x) => allowed.includes(x)), "Choose from the listed options")
      .transform((a) => [...new Set(a)])
  );
const dateOnly = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date").nullable().default(null));
const money = z.preprocess(blank, z.coerce.number().min(0, "Cannot be negative").max(1e12, "Too large").nullable().default(null));

/* ------------------------------ Per-service configuration ------------------------------ */

export const CONFIG_SCHEMAS = {
  SMM: z.object({
    posters: count(),
    videos: count(),
    microDramas: count(),
    campaigns: count(),
    youtubeVideos: count(),
    platforms: list(SOCIAL_PLATFORMS),
    campaignDurationMonths: optionalCount(120),
    billingCycle: z.preprocess(blank, z.enum(BILLING_CYCLES).nullable().default(null)),
    additional: text(),
  }),
  SEM: z.object({
    searchAds: flag,
    displayAds: flag,
    youtubeAds: flag,
    campaigns: count(),
    campaignDurationMonths: optionalCount(120),
    targetLocations: list(undefined, 50),
    targetAudience: text(1000),
    additional: text(),
  }),
  SEO: z.object({
    websiteSeo: flag,
    targetKeywords: count(),
    localSeoCampaigns: count(),
    localSeoLocations: count(),
    blogsPerMonth: count(1000),
    onPage: flag,
    offPage: flag,
    technical: flag,
    contractDurationMonths: optionalCount(120),
    additional: text(),
  }),
  WEBSITE: z.object({
    websiteType: z.preprocess(blank, z.enum(WEBSITE_TYPES).nullable().default(null)),
    pages: count(1000),
    integrations: list(undefined, 40),
    ecommerce: flag,
    domainHosting: z.preprocess(blank, z.enum(DOMAIN_HOSTING).nullable().default(null)),
    deliveryWeeks: optionalCount(260),
    additional: text(),
  }),
  VIDEO: z.object({
    fullAiVideo: flag,
    microAiVideo: flag,
    anchorVideo: flag,
    cameraAd: flag,
    videos: count(),
    durationSeconds: optionalCount(36000),
    language: text(80),
    scriptRequired: flag,
    voiceOverRequired: flag,
    platforms: list(VIDEO_PLATFORMS),
    additional: text(),
  }),
  QUICK_WORK: z.object({
    title: z.preprocess(blank, z.string().trim().min(2, "Enter a title for the work").max(150)),
    description: text(),
    /** Set by the server when the requirement is first saved. */
    entryDate: dateOnly,
    deadline: dateOnly,
    maxHours: z.preprocess(blank, z.coerce.number().min(0, "Cannot be negative").max(10000, "Too large").nullable().default(null)),
    priority: z.preprocess(blank, z.enum(TASK_PRIORITIES).default("MEDIUM")),
    additional: text(),
  }),
} as const satisfies Record<ServiceType, z.ZodType>;

export type RequirementConfig = Record<string, unknown>;

/** A starting config for a service: what the form shows when the card is first opened. */
export function defaultConfig(type: ServiceType): RequirementConfig {
  const base: Record<string, unknown> = {};
  if (type === "QUICK_WORK") return { title: "", description: "", entryDate: null, deadline: null, maxHours: null, priority: "MEDIUM", additional: "" };
  const parsed = CONFIG_SCHEMAS[type].safeParse({});
  return parsed.success ? (parsed.data as RequirementConfig) : base;
}

/* ------------------------------ Whole requirement ------------------------------ */

const AMOUNT_KEYS = ["proposedBudget", "adSpend", "agencyFee"] as const;
/** Which amounts each service can carry. Everything else is stored as null. */
export const SERVICE_AMOUNTS: Record<ServiceType, readonly (typeof AMOUNT_KEYS)[number][]> = {
  SMM: ["proposedBudget"],
  SEM: ["adSpend", "agencyFee"],
  SEO: ["proposedBudget"],
  WEBSITE: ["proposedBudget"],
  VIDEO: ["proposedBudget"],
  QUICK_WORK: ["proposedBudget"],
};

export const requirementInputSchema = z.object({
  /** Present when updating an existing requirement in a bulk save. */
  id: z.string().regex(/^[a-f\d]{24}$/i).nullish(),
  serviceType: z.enum(SERVICE_TYPES),
  status: z.enum(REQUIREMENT_STATUSES).default("INTERESTED"),
  currency: z.enum(CURRENCIES).default(DEFAULT_CURRENCY),
  proposedBudget: money,
  adSpend: money,
  agencyFee: money,
  config: z.record(z.string(), z.unknown()).default({}),
});
export type RequirementInput = z.input<typeof requirementInputSchema>;

export type NormalizedRequirement = {
  serviceType: ServiceType;
  status: RequirementStatus;
  currency: (typeof CURRENCIES)[number];
  proposedBudget: number | null;
  adSpend: number | null;
  agencyFee: number | null;
  config: RequirementConfig;
  summary: string;
};

const SCOPE_NEEDED = "Fill in the requirement before marking it collected";
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const joined = (items: unknown) => (Array.isArray(items) ? (items as string[]).join(", ") : "");

/** Checks a config's completeness for a status that needs it. Returns { "config.field": message }. */
function stageErrors(type: ServiceType, c: RequirementConfig, status: RequirementStatus, amounts: Record<string, number | null>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (status === "INTERESTED" || status === "NOT_PROCEEDING") return errors;
  switch (type) {
    case "SMM":
      if (!["posters", "videos", "microDramas", "campaigns", "youtubeVideos"].some((k) => num(c[k]) > 0)) errors["config.posters"] = "Enter at least one quantity";
      if (!(c.platforms as string[])?.length) errors["config.platforms"] = "Choose at least one platform";
      if (!c.billingCycle) errors["config.billingCycle"] = "Choose monthly or one-time";
      break;
    case "SEM":
      if (!c.searchAds && !c.displayAds && !c.youtubeAds) errors["config.searchAds"] = "Choose at least one ad type";
      if (num(c.campaigns) < 1) errors["config.campaigns"] = "Enter the number of campaigns";
      break;
    case "SEO":
      if (!c.websiteSeo && !c.onPage && !c.offPage && !c.technical && num(c.targetKeywords) < 1 && num(c.localSeoCampaigns) < 1 && num(c.blogsPerMonth) < 1) {
        errors["config.websiteSeo"] = "Choose at least one SEO scope";
      }
      break;
    case "WEBSITE":
      if (!c.websiteType) errors["config.websiteType"] = "Choose the website type";
      if (num(c.pages) < 1) errors["config.pages"] = "Enter the number of pages";
      break;
    case "VIDEO":
      if (!c.fullAiVideo && !c.microAiVideo && !c.anchorVideo && !c.cameraAd) errors["config.fullAiVideo"] = "Choose at least one video type";
      if (num(c.videos) < 1) errors["config.videos"] = "Enter the number of videos";
      if (!c.language) errors["config.language"] = "Enter the language";
      break;
    case "QUICK_WORK":
      break;
  }
  if (Object.keys(errors).length && status === "REQUIREMENT_COLLECTED") {
    errors._ = SCOPE_NEEDED;
  }
  if ((status === "QUOTED" || status === "APPROVED") && type !== "QUICK_WORK") {
    const key = type === "SEM" ? "adSpend" : "proposedBudget";
    const has = type === "SEM" ? (amounts.adSpend ?? 0) > 0 || (amounts.agencyFee ?? 0) > 0 : (amounts.proposedBudget ?? 0) > 0;
    if (!has) errors[key] = status === "APPROVED" ? "Enter the approved amount" : "Enter the quoted amount";
  }
  return errors;
}

/** Plain-language one-liner for lists and notifications. */
export function summarizeRequirement(type: ServiceType, c: RequirementConfig): string {
  const parts: string[] = [];
  const q = (n: unknown, label: string) => (num(n) > 0 ? parts.push(`${num(n)} ${label}`) : null);
  switch (type) {
    case "SMM":
      q(c.posters, "posters"); q(c.videos, "videos"); q(c.microDramas, "micro dramas"); q(c.campaigns, "campaigns"); q(c.youtubeVideos, "YouTube videos");
      if (joined(c.platforms)) parts.push(joined(c.platforms));
      if (c.billingCycle) parts.push(c.billingCycle === "MONTHLY" ? "monthly" : "one-time");
      break;
    case "SEM": {
      const ads = [c.searchAds && "Search", c.displayAds && "Display", c.youtubeAds && "YouTube"].filter(Boolean);
      if (ads.length) parts.push(`${ads.join(" + ")} ads`);
      q(c.campaigns, "campaigns");
      if (joined(c.targetLocations)) parts.push(joined(c.targetLocations));
      break;
    }
    case "SEO": {
      const scope = [c.websiteSeo && "Website SEO", c.onPage && "on-page", c.offPage && "off-page", c.technical && "technical"].filter(Boolean);
      if (scope.length) parts.push(scope.join(", "));
      q(c.targetKeywords, "keywords"); q(c.localSeoCampaigns, "local campaigns"); q(c.blogsPerMonth, "blogs/month");
      break;
    }
    case "WEBSITE": {
      const label = WEBSITE_TYPE_LABELS[c.websiteType as keyof typeof WEBSITE_TYPE_LABELS];
      if (label) parts.push(label);
      q(c.pages, "pages");
      if (c.ecommerce) parts.push("e-commerce");
      break;
    }
    case "VIDEO": {
      const kinds = [c.fullAiVideo && "Full AI", c.microAiVideo && "Micro AI", c.anchorVideo && "Anchor", c.cameraAd && "Camera ad"].filter(Boolean);
      q(c.videos, "videos");
      if (kinds.length) parts.push(kinds.join(", "));
      if (c.language) parts.push(String(c.language));
      break;
    }
    case "QUICK_WORK":
      if (c.title) parts.push(String(c.title));
      if (c.deadline) parts.push(`due ${c.deadline}`);
      if (num(c.maxHours) > 0) parts.push(`≤ ${num(c.maxHours)}h`);
      break;
  }
  return parts.join(" · ").slice(0, 400);
}

export type ParseResult = { ok: true; value: NormalizedRequirement } | { ok: false; errors: Record<string, string> };

/**
 * Validates and normalises one requirement. Unknown config keys are dropped, numbers are coerced,
 * amounts a service can't carry are cleared, and `entryDate` is kept from the stored value (or set
 * to today) rather than trusted from the client.
 */
export function parseRequirement(raw: unknown, opts: { existingEntryDate?: string | null; today?: string } = {}): ParseResult {
  const base = requirementInputSchema.safeParse(raw);
  if (!base.success) return { ok: false, errors: flattenIssues(base.error.issues) };
  const v = base.data;
  const cfg = CONFIG_SCHEMAS[v.serviceType].safeParse(v.config);
  if (!cfg.success) return { ok: false, errors: prefixConfig(flattenIssues(cfg.error.issues)) };
  const config = { ...(cfg.data as RequirementConfig) };
  if (v.serviceType === "QUICK_WORK") config.entryDate = opts.existingEntryDate || opts.today || new Date().toISOString().slice(0, 10);

  const allowed = SERVICE_AMOUNTS[v.serviceType];
  const amounts = Object.fromEntries(AMOUNT_KEYS.map((k) => [k, allowed.includes(k) ? (v[k] as number | null) : null])) as Record<(typeof AMOUNT_KEYS)[number], number | null>;
  const errors = stageErrors(v.serviceType, config, v.status, amounts);
  if (v.serviceType === "QUICK_WORK" && config.deadline && config.entryDate && String(config.deadline) < String(config.entryDate)) errors["config.deadline"] = "The deadline cannot be before the entry date";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { serviceType: v.serviceType, status: v.status, currency: v.currency, ...amounts, config, summary: summarizeRequirement(v.serviceType, config) },
  };
}

function flattenIssues(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) out[i.path.map(String).join(".") || "_"] ??= i.message;
  return out;
}
const prefixConfig = (e: Record<string, string>) => Object.fromEntries(Object.entries(e).map(([k, m]) => [k === "_" ? "config" : `config.${k}`, m]));

/** Display model for a stored requirement's amounts (never mixes currencies). */
export function amountLines(r: { serviceType: ServiceType; proposedBudget: number | null; adSpend: number | null; agencyFee: number | null }) {
  const lines: { label: string; value: number }[] = [];
  const add = (label: string, value: number | null) => (value !== null && value !== undefined ? lines.push({ label, value }) : null);
  if (r.serviceType === "SEM") { add("Advertising spend", r.adSpend); add("Agency fee", r.agencyFee); }
  else add(r.serviceType === "SEO" ? "Monthly budget" : "Proposed budget", r.proposedBudget);
  return lines;
}

/* ------------------------------ Field catalogue (form and display) ------------------------------ */

export type FieldKind = "count" | "flag" | "text" | "longtext" | "select" | "multi" | "tags" | "date" | "number" | "auto-date";
export type FieldSpec = {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  wide?: boolean;
  /** Fields in the same group render under one heading (e.g. "Ad types"). */
  group?: string;
};
const opts = (list: readonly string[]) => list.map((v) => ({ value: v, label: v }));
const labelled = (map: Record<string, string>) => Object.entries(map).map(([value, label]) => ({ value, label }));
const additional: FieldSpec = { key: "additional", label: "Additional requirements", kind: "longtext", wide: true };

export const SERVICE_FIELDS: Record<ServiceType, FieldSpec[]> = {
  SMM: [
    { key: "posters", label: "Number of posters", kind: "count" },
    { key: "videos", label: "Number of videos", kind: "count" },
    { key: "microDramas", label: "Number of micro dramas", kind: "count" },
    { key: "campaigns", label: "Number of campaigns", kind: "count" },
    { key: "youtubeVideos", label: "Number of YouTube videos", kind: "count" },
    { key: "platforms", label: "Social media platforms", kind: "multi", options: opts(SOCIAL_PLATFORMS), wide: true },
    { key: "campaignDurationMonths", label: "Campaign duration (months)", kind: "count" },
    { key: "billingCycle", label: "Monthly or one-time", kind: "select", options: labelled(BILLING_CYCLE_LABELS) },
    additional,
  ],
  SEM: [
    { key: "searchAds", label: "Search ads", kind: "flag", group: "Ad types" },
    { key: "displayAds", label: "Display ads", kind: "flag", group: "Ad types" },
    { key: "youtubeAds", label: "YouTube ads", kind: "flag", group: "Ad types" },
    { key: "campaigns", label: "Number of campaigns", kind: "count" },
    { key: "campaignDurationMonths", label: "Campaign duration (months)", kind: "count" },
    { key: "targetLocations", label: "Target locations", kind: "tags", wide: true, hint: "Press Enter after each location" },
    { key: "targetAudience", label: "Target audience", kind: "longtext", wide: true },
    additional,
  ],
  SEO: [
    { key: "websiteSeo", label: "Website SEO", kind: "flag", group: "Scope" },
    { key: "onPage", label: "On-page SEO", kind: "flag", group: "Scope" },
    { key: "offPage", label: "Off-page SEO", kind: "flag", group: "Scope" },
    { key: "technical", label: "Technical SEO", kind: "flag", group: "Scope" },
    { key: "targetKeywords", label: "Number of target keywords", kind: "count" },
    { key: "localSeoCampaigns", label: "Local SEO campaigns", kind: "count" },
    { key: "localSeoLocations", label: "Local SEO locations", kind: "count" },
    { key: "blogsPerMonth", label: "Blogs per month", kind: "count" },
    { key: "contractDurationMonths", label: "Contract duration (months)", kind: "count" },
    additional,
  ],
  WEBSITE: [
    { key: "websiteType", label: "Website type", kind: "select", options: labelled(WEBSITE_TYPE_LABELS) },
    { key: "pages", label: "Number of pages", kind: "count" },
    { key: "integrations", label: "Required integrations", kind: "tags", wide: true, hint: "Payment gateway, CRM, WhatsApp… press Enter after each" },
    { key: "ecommerce", label: "E-commerce required", kind: "flag" },
    { key: "domainHosting", label: "Domain and hosting", kind: "select", options: labelled(DOMAIN_HOSTING_LABELS) },
    { key: "deliveryWeeks", label: "Expected delivery (weeks)", kind: "count" },
    additional,
  ],
  VIDEO: [
    { key: "fullAiVideo", label: "Full AI video", kind: "flag", group: "Video types" },
    { key: "microAiVideo", label: "Micro AI video", kind: "flag", group: "Video types" },
    { key: "anchorVideo", label: "Anchor-based video", kind: "flag", group: "Video types" },
    { key: "cameraAd", label: "Camera-based advertisement", kind: "flag", group: "Video types" },
    { key: "videos", label: "Number of videos", kind: "count" },
    { key: "durationSeconds", label: "Video duration (seconds)", kind: "count" },
    { key: "language", label: "Language", kind: "text" },
    { key: "scriptRequired", label: "Script required", kind: "flag" },
    { key: "voiceOverRequired", label: "Voice-over required", kind: "flag" },
    { key: "platforms", label: "Platforms", kind: "multi", options: opts(VIDEO_PLATFORMS), wide: true },
    additional,
  ],
  QUICK_WORK: [
    { key: "title", label: "Work title", kind: "text", required: true, wide: true },
    { key: "description", label: "Work description", kind: "longtext", wide: true },
    { key: "entryDate", label: "Entry date", kind: "auto-date", hint: "Set automatically when saved" },
    { key: "deadline", label: "Expected deadline", kind: "date" },
    { key: "maxHours", label: "Maximum estimated hours", kind: "number" },
    { key: "priority", label: "Priority", kind: "select", options: TASK_PRIORITIES.map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() })) },
    additional,
  ],
};

/** Label for the single budget a service carries (or the two SEM amounts). */
export const BUDGET_LABEL: Record<ServiceType, string> = {
  SMM: "Proposed budget",
  SEM: "Proposed budget",
  SEO: "Proposed monthly budget",
  WEBSITE: "Proposed budget",
  VIDEO: "Proposed budget",
  QUICK_WORK: "Proposed budget (optional)",
};

/** Non-empty configuration as label/value rows for display. */
export function configRows(type: ServiceType, config: RequirementConfig): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const f of SERVICE_FIELDS[type]) {
    const v = config?.[f.key];
    if (f.kind === "flag") { if (v) rows.push({ label: f.group ? `${f.group}: ${f.label}` : f.label, value: "Yes" }); continue; }
    if (v === null || v === undefined || v === "" || v === 0 || (Array.isArray(v) && !v.length)) continue;
    const display = Array.isArray(v) ? v.join(", ") : f.kind === "select" ? f.options?.find((o) => o.value === v)?.label ?? String(v) : String(v);
    rows.push({ label: f.label, value: display });
  }
  return rows;
}
