import "server-only";
import type { ClientSession } from "mongoose";
import type { z } from "zod";
import type { CurrentUser } from "@/lib/auth/current-user";
import { conflict, forbidden, notFound, unprocessable } from "@/lib/api";
import { diffFields, recordAudit } from "@/lib/audit";
import { withTransaction } from "@/lib/transaction";
import type { ClientHistoryAction, RequirementStatus } from "@/lib/constants";
import { parseRequirement, type NormalizedRequirement } from "@/lib/clients/service-requirements";
import type { requirementInputSchema } from "@/lib/clients/service-requirements";
import type { requirementPatchSchema } from "@/lib/validations/handover";
import { ClientHistory, ClientServiceRequirement, Project, ProjectService } from "@/models";
import type { RequirementDTO } from "@/types/dto";
import { iso, toUserRef, USER_REF_FIELDS } from "./mappers";
import { loadVisible, requireFull, touch } from "./client-core";
import type { ClientRights } from "./client-access";
import { oid } from "./scope";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Input = z.input<typeof requirementInputSchema>;
type Change = Record<string, { from: unknown; to: unknown }>;

const MONEY_FIELDS = new Set(["proposedBudget", "adSpend", "agencyFee", "currency"]);

/** Requirements carry the quote, so only the client's owner (and Admin) may write them. */
function requireWrite(rights: ClientRights) {
  requireFull(rights, "this client's service requirements");
  if (!rights.editRestricted) throw forbidden("Only the client's Sales owner or an Admin can change service requirements");
}

/** Flat view of a requirement for history diffs: scalars plus `config.*`. */
function flatReq(r: any): Record<string, unknown> {
  const out: Record<string, unknown> = {
    status: r.status,
    currency: r.currency,
    proposedBudget: r.proposedBudget ?? null,
    adSpend: r.adSpend ?? null,
    agencyFee: r.agencyFee ?? null,
  };
  for (const [k, v] of Object.entries(r.config ?? {})) out[`config.${k}`] = Array.isArray(v) ? v.join(", ") : v;
  return out;
}
function diffReq(before: any, after: any): Change {
  const b = flatReq(before);
  const a = flatReq(after);
  return diffFields(b, a, Object.keys(a));
}
/** The shared audit log is readable by more roles than the client history, so amounts are masked there. */
const maskedForAudit = (c: Change): Change => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, MONEY_FIELDS.has(k) ? { from: "[restricted]", to: "[restricted]" } : v]));

const label = (r: { serviceType: string; summary?: string }) => `${r.serviceType}${r.summary ? ` (${r.summary.slice(0, 60)})` : ""}`;

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

async function linkedProjects(ids: any[], session?: ClientSession): Promise<Map<string, RequirementDTO["linkedProject"]>> {
  const out = new Map<string, RequirementDTO["linkedProject"]>();
  if (!ids.length) return out;
  const services: any[] = await ProjectService.find({ requirement: { $in: ids }, isActive: true }).select("requirement project").session(session ?? null).lean();
  if (!services.length) return out;
  const projects = new Map((await Project.find({ _id: { $in: services.map((s) => s.project) } }).select("code name status").session(session ?? null).lean()).map((p: any) => [String(p._id), p]));
  for (const s of services) {
    const p: any = projects.get(String(s.project));
    if (p) out.set(String(s.requirement), { id: String(p._id), code: p.code, name: p.name, status: p.status });
  }
  return out;
}

function toDTO(r: any, rights: ClientRights, link: RequirementDTO["linkedProject"]): RequirementDTO {
  const writable = rights.level === "FULL" && rights.editRestricted;
  return {
    id: String(r._id),
    clientId: String(r.client),
    serviceType: r.serviceType,
    status: r.status,
    config: r.config ?? {},
    summary: r.summary ?? "",
    currency: r.currency,
    proposedBudget: r.proposedBudget ?? null,
    adSpend: r.adSpend ?? null,
    agencyFee: r.agencyFee ?? null,
    createdBy: toUserRef(r.createdBy),
    updatedBy: toUserRef(r.updatedBy),
    createdAt: iso(r.createdAt)!,
    updatedAt: iso(r.updatedAt)!,
    linkedProject: link,
    can: { edit: writable && !link, remove: writable && !link },
  };
}

async function loadRows(clientId: any, extra: Record<string, unknown> = {}) {
  return ClientServiceRequirement.find({ client: clientId, isActive: true, ...extra })
    .sort({ createdAt: 1 })
    .populate("createdBy", USER_REF_FIELDS)
    .populate("updatedBy", USER_REF_FIELDS)
    .lean() as Promise<any[]>;
}

/** Requirements of a client the user may see. Requirements carry quotes, so FULL client access is required. */
export async function listRequirements(user: CurrentUser, clientId: string): Promise<RequirementDTO[]> {
  const { client, rights } = await loadVisible(user, clientId);
  requireFull(rights, "this client's service requirements");
  const rows = await loadRows(client._id);
  const links = await linkedProjects(rows.map((r) => r._id));
  return rows.map((r) => toDTO(r, rights, links.get(String(r._id)) ?? null));
}

async function readOne(user: CurrentUser, clientId: string, requirementId: string): Promise<RequirementDTO> {
  const { client, rights } = await loadVisible(user, clientId);
  const [row] = await loadRows(client._id, { _id: oid(requirementId) });
  if (!row) throw notFound("Requirement not found");
  const links = await linkedProjects([row._id]);
  return toDTO(row, rights, links.get(String(row._id)) ?? null);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** Parses a batch; on failure reports every problem as `<prefix>.<index>.<field>` so the form can place it. */
function parseAll(items: Input[], prefix: string, existing: Map<string, any> = new Map()): NormalizedRequirement[] {
  const errors: Record<string, string> = {};
  const out: NormalizedRequirement[] = [];
  items.forEach((raw, i) => {
    const prior = raw.id ? existing.get(String(raw.id)) : null;
    const r = parseRequirement(raw, { existingEntryDate: (prior?.config?.entryDate as string | undefined) ?? null });
    if (r.ok) out.push(r.value);
    else for (const [k, m] of Object.entries(r.errors)) errors[`${prefix}.${i}.${k}`] = m;
  });
  if (Object.keys(errors).length) throw unprocessable("Some service requirements need attention", errors);
  return out;
}

const docFrom = (v: NormalizedRequirement) => ({
  serviceType: v.serviceType,
  status: v.status,
  currency: v.currency,
  proposedBudget: v.proposedBudget,
  adSpend: v.adSpend,
  agencyFee: v.agencyFee,
  config: v.config,
  summary: v.summary,
});

/** Asserts a requirement may be edited/removed/closed: not while it backs a live project. */
async function assertUnlinked(requirementId: any, what: string, session?: ClientSession) {
  const link = (await linkedProjects([requirementId], session)).get(String(requirementId));
  if (link) throw conflict(`This requirement is part of project ${link.code} (${link.name}). It cannot be ${what} while the project uses it.`);
}

/* ------------------------------------------------------------------ */
/* Writes (callable inside a caller's transaction)                     */
/* ------------------------------------------------------------------ */

export type RequirementContext = { actor: CurrentUser; client: { _id: any; clientCode: string }; session: ClientSession | undefined };
const hist = (c: RequirementContext, action: ClientHistoryAction, summary: string, changes?: Change | null) =>
  ({ client: c.client._id, actor: oid(c.actor.id), action, summary, changes: changes ?? null });

/** Inserts new requirements and their history. Used by client creation and by the requirement APIs. */
export async function insertRequirements(c: RequirementContext, items: NormalizedRequirement[]) {
  const created: any[] = [];
  for (const v of items) {
    const [doc] = await ClientServiceRequirement.create([{ ...docFrom(v), client: c.client._id, createdBy: oid(c.actor.id), updatedBy: null }], { session: c.session });
    created.push(doc);
    await ClientHistory.create([hist(c, "REQUIREMENT_ADDED", `Added ${label(v)} requirement`, { requirement: { from: null, to: label(v) }, status: { from: null, to: v.status } })], { session: c.session });
  }
  return created;
}

async function applyUpdate(c: RequirementContext, existing: any, v: NormalizedRequirement) {
  if (v.serviceType !== existing.serviceType) throw unprocessable("The service type of a requirement cannot be changed. Add a new requirement instead.", { serviceType: "Cannot be changed" });
  const changes = diffReq(existing, v);
  if (!Object.keys(changes).length) return null;
  const statusChanged = existing.status !== v.status;
  await assertUnlinked(existing._id, "edited", c.session);
  const updated = await ClientServiceRequirement.updateOne({ _id: existing._id, isActive: true, updatedAt: existing.updatedAt }, { $set: { ...docFrom(v), updatedBy: oid(c.actor.id) } }, { session: c.session });
  if (!updated.matchedCount) throw conflict("This requirement changed. Reload before saving.");
  await ClientHistory.create(
    [hist(c, statusChanged ? "REQUIREMENT_STATUS_CHANGED" : "REQUIREMENT_UPDATED",
      statusChanged ? `${label(v)}: ${existing.status} → ${v.status}` : `Updated ${label(v)} requirement`, changes)],
    { session: c.session }
  );
  return changes;
}

async function applyRemove(c: RequirementContext, existing: any) {
  await ClientServiceRequirement.updateOne({ _id: existing._id }, { $set: { isActive: false, removedAt: new Date(), removedBy: oid(c.actor.id), updatedBy: oid(c.actor.id) } }, { session: c.session });
  await ClientHistory.create([hist(c, "REQUIREMENT_REMOVED", `Removed ${label(existing)} requirement`, { requirement: { from: label(existing), to: null } })], { session: c.session });
}

/** Validation used by client creation: returns normalised items or throws field errors. */
export const prepareNewRequirements = (items: Input[]) => parseAll(items, "requirements");

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function addRequirement(user: CurrentUser, clientId: string, input: Input): Promise<RequirementDTO> {
  const { client, rights } = await loadVisible(user, clientId);
  requireWrite(rights);
  if (client.status === "ARCHIVED") throw unprocessable("Reactivate this client before changing requirements.");
  if (client.status === "ARCHIVED") throw unprocessable("This client is archived. Reactivate it to add requirements.");
  const [item] = parseAll([input], "requirement");
  const doc = await withTransaction(async (session) => {
    await touch(client._id, user.id, session);
    const [created] = await insertRequirements({ actor: user, client, session }, [item]);
    await touch(client._id, user.id, session);
    return created;
  });
  await recordAudit({ actorId: user.id, action: "client.requirement_add", entityType: "Client", entityId: client._id, summary: `${client.clientCode}: added ${label(item)} requirement` });
  return readOne(user, clientId, String(doc._id));
}

export async function updateRequirement(user: CurrentUser, clientId: string, requirementId: string, input: z.input<typeof requirementPatchSchema>): Promise<RequirementDTO> {
  const { client, rights } = await loadVisible(user, clientId);
  requireWrite(rights);
  if (client.status === "ARCHIVED") throw unprocessable("Reactivate this client before changing requirements.");
  const existing: any = await ClientServiceRequirement.findOne({ _id: oid(requirementId), client: client._id, isActive: true }).lean();
  if (!existing) throw notFound("Requirement not found");
  if (input.expectedUpdatedAt && iso(existing.updatedAt) !== input.expectedUpdatedAt) {
    throw conflict("This requirement was changed by someone else. Reload it and apply your edit again.");
  }
  await assertUnlinked(existing._id, "edited");
  // Partial edits merge onto what is stored; the merged result is validated as a whole.
  const merged: Input = {
    id: requirementId,
    serviceType: existing.serviceType,
    status: input.status ?? existing.status,
    currency: input.currency ?? existing.currency,
    proposedBudget: input.proposedBudget !== undefined ? input.proposedBudget : existing.proposedBudget,
    adSpend: input.adSpend !== undefined ? input.adSpend : existing.adSpend,
    agencyFee: input.agencyFee !== undefined ? input.agencyFee : existing.agencyFee,
    config: input.config ? { ...(existing.config ?? {}), ...input.config } : existing.config,
  };
  const [item] = parseAll([merged], "requirement", new Map([[requirementId, existing]]));
  const changes = await withTransaction(async (session) => {
    await touch(client._id, user.id, session);
    const ch = await applyUpdate({ actor: user, client, session }, existing, item);
    if (ch) await touch(client._id, user.id, session);
    return ch;
  });
  if (changes) await recordAudit({ actorId: user.id, action: "client.requirement_update", entityType: "Client", entityId: client._id, summary: `${client.clientCode}: updated ${label(item)} requirement`, changes: maskedForAudit(changes) });
  return readOne(user, clientId, requirementId);
}

export async function removeRequirement(user: CurrentUser, clientId: string, requirementId: string): Promise<void> {
  const { client, rights } = await loadVisible(user, clientId);
  requireWrite(rights);
  if (client.status === "ARCHIVED") throw unprocessable("Reactivate this client before changing requirements.");
  const existing: any = await ClientServiceRequirement.findOne({ _id: oid(requirementId), client: client._id, isActive: true }).lean();
  if (!existing) throw notFound("Requirement not found");
  await assertUnlinked(existing._id, "removed");
  await withTransaction(async (session) => {
    await touch(client._id, user.id, session);
    await assertUnlinked(existing._id, "removed", session);
    await applyRemove({ actor: user, client, session }, existing);
    await touch(client._id, user.id, session);
  });
  await recordAudit({ actorId: user.id, action: "client.requirement_remove", entityType: "Client", entityId: client._id, summary: `${client.clientCode}: removed ${label(existing)} requirement` });
}

/**
 * Saves the whole list from the client form in one atomic step: items with an id are updated, items
 * without are added, stored requirements missing from the list are removed. Everything is validated
 * before anything is written.
 */
export async function syncRequirements(user: CurrentUser, clientId: string, items: Input[], expectedUpdatedAt?: string): Promise<RequirementDTO[]> {
  const { client, rights } = await loadVisible(user, clientId);
  requireWrite(rights);
  if (client.status === "ARCHIVED") throw unprocessable("Reactivate this client before changing requirements.");
  const audits = await withTransaction(async (session) => {
    await touch(client._id, user.id, session, expectedUpdatedAt);
    return syncRequirementsInTransaction({ actor: user, client, session }, items);
  });
  await auditRequirementSync(user, client, audits);
  return listRequirements(user, clientId);
}

/** Shared by the requirements endpoint and the atomic client edit. Caller locks the client first. */
export async function syncRequirementsInTransaction(c: RequirementContext, items: Input[]) {
  const stored: any[] = await ClientServiceRequirement.find({ client: c.client._id, isActive: true }).session(c.session ?? null).lean();
  const byId = new Map(stored.map((r) => [String(r._id), r]));
  for (const [i, it] of items.entries()) {
    if (it.id && !byId.has(String(it.id))) throw unprocessable("A requirement was not found. Reload the client and try again.", { [`requirements.${i}`]: "Not found" });
  }
  const dupIds = items.map((i) => i.id).filter(Boolean);
  if (new Set(dupIds).size !== dupIds.length) throw unprocessable("A requirement was listed twice", { requirements: "Duplicate requirement" });
  const parsed = parseAll(items, "requirements", byId);
  const keep = new Set(dupIds.map(String));
  const removed = stored.filter((r) => !keep.has(String(r._id)));
  for (const r of removed) await assertUnlinked(r._id, "removed", c.session);
  const audits: { summary: string; changes?: Change }[] = [];
  const fresh: NormalizedRequirement[] = [];
  for (const [i, v] of parsed.entries()) {
    const id = items[i].id;
    if (!id) { fresh.push(v); continue; }
    const ch = await applyUpdate(c, byId.get(String(id)), v);
    if (ch) audits.push({ summary: `updated ${label(v)}`, changes: maskedForAudit(ch) });
  }
  if (fresh.length) { await insertRequirements(c, fresh); audits.push({ summary: `added ${fresh.map(label).join(", ")}` }); }
  for (const r of removed) { await applyRemove(c, r); audits.push({ summary: `removed ${label(r)}` }); }
  return audits;
}

export async function auditRequirementSync(user: CurrentUser, client: RequirementContext["client"], audits: { summary: string; changes?: Change }[]) {
  for (const a of audits) await recordAudit({ actorId: user.id, action: "client.requirement_sync", entityType: "Client", entityId: client._id, summary: `${client.clientCode}: ${a.summary}`, changes: a.changes });
}

export type { RequirementStatus };
