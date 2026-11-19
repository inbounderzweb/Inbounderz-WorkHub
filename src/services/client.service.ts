import "server-only";
import type { Types } from "mongoose";
import type { z } from "zod";
import type { CurrentUser } from "@/lib/auth/current-user";
import { ApiError, conflictWith, escapeRegex, forbidden, notFound, paginate, unprocessable, type Paginated } from "@/lib/api";
import { diffFields, recordAudit } from "@/lib/audit";
import { withTransaction } from "@/lib/transaction";
import { notify } from "@/lib/notify";
import { getRoleByKey } from "@/lib/roles";
import { hasPermission } from "@/lib/permissions";
import { CLIENT_NAME_SIMILARITY_THRESHOLD, type ClientHistoryAction, type ClientStatus } from "@/lib/constants";
import { validateGstin, GST_STATE_NAMES } from "@/lib/gst";
import {
  classifyDuplicate,
  dedupeKey,
  looseName,
  nameKey,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  pairKey,
  type DuplicateHit,
} from "@/lib/clients/normalize";
import { Client, ClientContact, ClientHistory, DuplicateReview, nextSequence, Project, User } from "@/models";
import type { ClientContactDTO, ClientDTO, ClientHistoryDTO, ClientProjectDTO, DuplicateMatchDTO, DuplicateReviewDTO } from "@/types/dto";
import type {
  checkDuplicatesSchema,
  clientContactSchema,
  clientListQuerySchema,
  createClientSchema,
  duplicateReviewQuerySchema,
  historyQuerySchema,
  resolveDuplicateReviewSchema,
  updateClientContactSchema,
  updateClientSchema,
} from "@/lib/validations/client";
import { accessContext, projectVisibilityFilter } from "./access";
import { auditRequirementSync, insertRequirements, prepareNewRequirements, syncRequirementsInTransaction } from "./requirement.service";
import { loadVisible, POPULATE_PEOPLE, requireFull, touch } from "./client-core";
import { clientRights, clientVisibilityFilter, roleViewLevel, type ClientRights } from "./client-access";
import { iso, toUserRef, USER_REF_FIELDS } from "./mappers";
import { oid, type Filter } from "./scope";

/* eslint-disable @typescript-eslint/no-explicit-any */

type CreateInput = z.output<typeof createClientSchema>;
type UpdateInput = z.output<typeof updateClientSchema>;

const MIN_OVERRIDE_REASON = 10;

type HistoryRow = { client: any; actor: any; action: ClientHistoryAction; changes?: Record<string, { from: unknown; to: unknown }> | null; reason?: string; summary: string };

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

const addr = (a: any) => ({
  line1: a?.line1 ?? "",
  line2: a?.line2 ?? "",
  city: a?.city ?? "",
  state: a?.state ?? "",
  postalCode: a?.postalCode ?? "",
  country: a?.country ?? "",
});

/** Builds the DTO a viewer is allowed to see. Restricted keys are absent, not blank, for lower levels. */
function toClientDTO(c: any, rights: ClientRights, extra: { projectCount?: number } = {}): ClientDTO {
  const base: ClientDTO = {
    id: c._id.toString(),
    clientCode: c.clientCode,
    name: c.name,
    status: c.status,
    businessCategory: c.businessCategory ?? "",
    website: c.website ?? "",
    viewLevel: rights.level,
    can: { update: rights.update, editRestricted: rights.editRestricted, changeOwner: rights.changeOwner, changeStatus: rights.changeStatus, archive: rights.archive },
  };
  if (rights.level === "MINIMAL") return base;
  base.contactPerson = c.contactPerson ?? "";
  base.salesOwner = toUserRef(c.salesOwner);
  base.projectManager = toUserRef(c.projectManager);
  if (rights.level === "LIMITED") return base;
  const gstin = c.gst?.gstin ?? "";
  return {
    ...base,
    email: c.email ?? "",
    phone: c.phone ?? "",
    contactDesignation: c.contactDesignation ?? "",
    contactEmail: c.contactEmail ?? "",
    contactPhone: c.contactPhone ?? "",
    alternatePhone: c.alternatePhone ?? "",
    alternateContact: { name: c.alternateContact?.name ?? "", email: c.alternateContact?.email ?? "", phone: c.alternateContact?.phone ?? "" },
    businessAddress: addr(c.businessAddress),
    billingSameAsBusiness: c.billingSameAsBusiness ?? true,
    billingAddress: addr(c.billingAddress),
    gst: { gstin, legalName: c.gst?.legalName ?? "", stateCode: c.gst?.stateCode ?? "", stateName: GST_STATE_NAMES[c.gst?.stateCode ?? ""] ?? "" },
    defaultCurrency: c.defaultCurrency,
    notes: c.notes ?? "",
    createdBy: toUserRef(c.createdBy),
    updatedBy: toUserRef(c.updatedBy),
    createdAt: iso(c.createdAt)!,
    updatedAt: iso(c.updatedAt)!,
    migratedFromProjects: !!c.migration?.source,
    ...(extra.projectCount !== undefined ? { projectCount: extra.projectCount } : {}),
  };
}


/* ------------------------------------------------------------------ */
/* Flat field view (history diffs)                                     */
/* ------------------------------------------------------------------ */

const SCALARS = ["name", "contactPerson", "contactDesignation", "contactEmail", "contactPhone", "alternatePhone", "email", "phone", "businessCategory", "website", "billingSameAsBusiness", "defaultCurrency", "notes", "status"] as const;
const NESTED: Record<string, string[]> = {
  alternateContact: ["name", "email", "phone"],
  businessAddress: ["line1", "line2", "city", "state", "postalCode", "country"],
  billingAddress: ["line1", "line2", "city", "state", "postalCode", "country"],
  gst: ["gstin", "legalName", "stateCode"],
};
/** Fields only restricted viewers' roles may edit or see; masked in the shared audit log. */
const RESTRICTED_PREFIXES = ["gst.", "billingAddress.", "billingSameAsBusiness", "defaultCurrency"];
const isRestrictedField = (f: string) => RESTRICTED_PREFIXES.some((p) => f === p || f.startsWith(p));

function flat(c: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SCALARS) out[k] = c?.[k];
  for (const [parent, keys] of Object.entries(NESTED)) for (const k of keys) out[`${parent}.${k}`] = c?.[parent]?.[k];
  out.salesOwner = c?.salesOwner ? String(c.salesOwner._id ?? c.salesOwner) : null;
  out.projectManager = c?.projectManager ? String(c.projectManager._id ?? c.projectManager) : null;
  return out;
}

function diffClient(before: any, after: any): Record<string, { from: unknown; to: unknown }> {
  const b = flat(before);
  const a = flat(after);
  return diffFields(b, a, Object.keys(a));
}

/** The same diff with restricted values replaced, for the audit log that more roles can read. */
function maskedForAudit(changes: Record<string, { from: unknown; to: unknown }>) {
  return Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, isRestrictedField(k) ? { from: "[restricted]", to: "[restricted]" } : v]));
}

/* ------------------------------------------------------------------ */
/* Duplicate detection                                                 */
/* ------------------------------------------------------------------ */

type Probe = { name: string; email?: string | null; phone?: string | null };
type FoundHit = DuplicateHit & { doc: any };

const LEVEL_ORDER = { BLOCK: 0, CONTACT: 1, NAME: 2 } as const;

async function findDuplicates(probe: Probe, excludeId?: string | null): Promise<FoundHit[]> {
  const email = normalizeEmail(probe.email);
  const phone = normalizePhone(probe.phone);
  const loose = looseName(probe.name);
  const or: Filter[] = [];
  if (email) or.push({ normEmail: email });
  if (phone) or.push({ normPhone: phone });
  if (loose) or.push({ looseName: loose }, { nameKey: nameKey(probe.name) });
  if (!or.length) return [];
  const rows: any[] = await Client.find({ $or: or, ...(excludeId ? { _id: { $ne: oid(excludeId) } } : {}) })
    .select("clientCode name status salesOwner normEmail normPhone")
    .populate("salesOwner", USER_REF_FIELDS)
    .limit(50)
    .lean();
  const hits: FoundHit[] = [];
  for (const row of rows) {
    const hit = classifyDuplicate(probe, { id: row._id.toString(), normEmail: row.normEmail ?? "", normPhone: row.normPhone ?? "", name: row.name }, CLIENT_NAME_SIMILARITY_THRESHOLD);
    if (!hit) continue;
    // An archived client has released its unique key, so it can only warn, never block.
    if (hit.level === "BLOCK" && row.status === "ARCHIVED") hit.level = "CONTACT";
    hits.push({ ...hit, doc: row });
  }
  return hits.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.score - a.score);
}

/** What a warning reveals: identity and owner, never contact details. */
async function toMatchDTOs(user: CurrentUser, hits: FoundHit[]): Promise<DuplicateMatchDTO[]> {
  if (!hits.length) return [];
  const visibility = await clientVisibilityFilter(user);
  const visible = new Set((await Client.find({ $and: [{ _id: { $in: hits.map((h) => oid(h.id)) } }, visibility] }).select("_id").lean()).map((r) => r._id.toString()));
  return hits.map((h) => ({
    id: h.id,
    clientCode: h.doc.clientCode,
    name: h.doc.name,
    status: h.doc.status,
    salesOwner: toUserRef(h.doc.salesOwner),
    level: h.level,
    matched: h.matched,
    score: Math.round(h.score * 100) / 100,
    canOpen: visible.has(h.id),
  }));
}

export async function checkDuplicates(user: CurrentUser, input: z.output<typeof checkDuplicatesSchema>) {
  if (!hasPermission(user.role, "client:create") && !hasPermission(user.role, "client:update")) throw forbidden();
  const hits = await findDuplicates(input, input.excludeId || null);
  const duplicates = await toMatchDTOs(user, hits);
  return { duplicates, blocked: duplicates.some((d) => d.level === "BLOCK"), canOverride: hasPermission(user.role, "client:manage") };
}

/**
 * Decides whether a create/edit may proceed given the duplicates found.
 * Returns whether an Admin override was used. Throws a 409 carrying the candidates otherwise.
 */
async function enforceDuplicatePolicy(
  user: CurrentUser,
  hits: FoundHit[],
  input: { acknowledgeDuplicates: boolean; duplicateOverrideReason: string }
): Promise<{ overridden: boolean; acknowledged: boolean }> {
  if (!hits.length) return { overridden: false, acknowledged: false };
  const canOverride = hasPermission(user.role, "client:manage");
  const blocked = hits.some((h) => h.level === "BLOCK");
  if (blocked) {
    if (canOverride && input.duplicateOverrideReason.length >= MIN_OVERRIDE_REASON) return { overridden: true, acknowledged: false };
    const reasonProblem = canOverride && input.duplicateOverrideReason ? `Give a reason of at least ${MIN_OVERRIDE_REASON} characters to override` : undefined;
    throw conflictWith(
      reasonProblem ?? "A client with the same email and phone already exists",
      { code: "DUPLICATE_BLOCK", duplicates: await toMatchDTOs(user, hits), canOverride, minReasonLength: MIN_OVERRIDE_REASON }
    );
  }
  if (!input.acknowledgeDuplicates) {
    throw conflictWith("Similar clients already exist. Review them, then confirm to continue.", {
      code: "DUPLICATE_WARNING",
      duplicates: await toMatchDTOs(user, hits),
      canOverride,
    });
  }
  return { overridden: false, acknowledged: true };
}

/** Records a review pair for each hit (idempotent per pair). */
async function queueReviews(newId: any, hits: FoundHit[], source: "CREATE_WARNING" | "CREATE_OVERRIDE", actorId: string, session: any) {
  for (const h of hits) {
    const reasons = [
      h.matched.includes("email") && "Same email",
      h.matched.includes("phone") && "Same phone",
      h.matched.includes("name") && `Similar name (${Math.round(h.score * 100)}%)`,
    ].filter(Boolean) as string[];
    await DuplicateReview.updateOne(
      { pairKey: pairKey(newId.toString(), h.id) },
      { $setOnInsert: { clientA: newId, clientB: oid(h.id), pairKey: pairKey(newId.toString(), h.id), source, score: h.score, reasons, status: "OPEN", createdBy: oid(actorId) } },
      { upsert: true, session }
    );
  }
}

const isDedupeCollision = (err: any) => err?.code === 11000 && (err.keyPattern?.dedupeKey || String(err.message).includes("dedupeKey"));

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

async function resolveOwner(user: CurrentUser, requested: string | null | undefined) {
  if (user.role !== "SUPER_ADMIN") {
    if (requested && requested !== user.id) throw forbidden("Only an Admin can assign a different Sales Executive");
    return oid(user.id);
  }
  if (!requested) return oid(user.id);
  const owner = await User.findById(requested).select("status role").lean();
  if (!owner || owner.status !== "ACTIVE") throw unprocessable("Choose an active Sales Executive", { salesOwner: "Owner must be an active user" });
  const sales = await getRoleByKey("SALES_EXECUTIVE");
  const admin = await getRoleByKey("SUPER_ADMIN");
  if (![sales.id, admin.id].includes(owner.role.toString())) throw unprocessable("The owner must be a Sales Executive or an Admin", { salesOwner: "Not a Sales Executive" });
  return oid(requested);
}

function gstFields(gst: { gstin?: string; legalName?: string } | undefined) {
  const gstin = gst?.gstin?.trim() ?? "";
  if (!gstin) return { gstin: "", legalName: gst?.legalName ?? "", stateCode: "" };
  const r = validateGstin(gstin); // schema already validated; this derives the normalised value
  if (!r.valid) throw unprocessable(r.reason, { "gst.gstin": r.reason });
  return { gstin: r.gstin, legalName: gst?.legalName ?? "", stateCode: r.stateCode };
}

function derived(c: { name: string; email?: string; phone?: string }) {
  return {
    normName: normalizeName(c.name),
    looseName: looseName(c.name),
    nameKey: nameKey(c.name),
    normEmail: normalizeEmail(c.email),
    normPhone: normalizePhone(c.phone),
  };
}

async function notifyAdmins(actor: CurrentUser, title: string, message: string, client: any) {
  const admin = await getRoleByKey("SUPER_ADMIN");
  const admins = await User.find({ role: oid(admin.id), status: "ACTIVE" }).select("_id").lean();
  await notify({
    recipients: admins.map((a) => a._id),
    actorId: actor.id,
    type: "CLIENT",
    title,
    message,
    link: `/clients/${client._id}`,
    entityType: "Client",
    entityId: client._id,
  });
}

/** The Project Manager a client is nominated to must be an active Project Manager. */
async function resolveProjectManager(id: string | null): Promise<Types.ObjectId | null> {
  if (!id) return null;
  const role = await getRoleByKey("PROJECT_MANAGER");
  const pm: any = await User.findOne({ _id: oid(id), role: oid(role.id), status: "ACTIVE" }).select("_id").lean();
  if (!pm) throw unprocessable("Choose an active Project Manager", { projectManager: "Project Manager not found or inactive" });
  return pm._id;
}

export async function createClient(user: CurrentUser, input: CreateInput): Promise<ClientDTO> {
  if (!hasPermission(user.role, "client:create")) throw forbidden();
  if (input.status === "ARCHIVED") throw unprocessable("A new client cannot be archived", { status: "Choose another status" });
  const owner = await resolveOwner(user, input.salesOwner || null);
  const projectManager = await resolveProjectManager(input.projectManager || null);
  const requirements = prepareNewRequirements(input.requirements);
  const hits = await findDuplicates(input);
  const policy = await enforceDuplicatePolicy(user, hits, input);

  const email = normalizeEmail(input.email);
  const key = policy.overridden ? "" : dedupeKey(input.email, input.phone);
  const code = `CLT-${String(await nextSequence("clientCode")).padStart(5, "0")}`;
  const doc = {
    clientCode: code,
    name: input.name,
    contactPerson: input.contactPerson,
    contactDesignation: input.contactDesignation,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    alternatePhone: input.alternatePhone,
    email,
    phone: input.phone,
    alternateContact: input.alternateContact ?? { name: "", email: "", phone: "" },
    businessCategory: input.businessCategory,
    website: input.website,
    businessAddress: input.businessAddress ?? {},
    billingSameAsBusiness: input.billingSameAsBusiness ?? true,
    billingAddress: input.billingAddress ?? {},
    gst: gstFields(input.gst),
    defaultCurrency: input.defaultCurrency,
    notes: input.notes,
    salesOwner: owner,
    projectManager,
    status: (input.status ?? "PROSPECT") as ClientStatus,
    ...derived(input),
    ...(key ? { dedupeKey: key } : {}),
    createdBy: oid(user.id),
    updatedBy: null,
  };

  let created: any;
  try {
    created = await withTransaction(async (session) => {
      const [c] = await Client.create([doc], { session });
      const snapshot = diffClient({}, c.toObject());
      const rows: HistoryRow[] = [{ client: c._id, actor: oid(user.id), action: "CREATED", changes: snapshot, summary: `Client ${c.clientCode} created` }];
      if (policy.overridden) {
        rows.push({ client: c._id, actor: oid(user.id), action: "DUPLICATE_OVERRIDE", reason: input.duplicateOverrideReason, summary: `Admin override: duplicate of ${hits.filter((h) => h.level === "BLOCK").map((h) => h.doc.clientCode).join(", ")}`, changes: { duplicateOf: { from: null, to: hits.map((h) => h.doc.clientCode) } } });
      } else if (policy.acknowledged) {
        rows.push({ client: c._id, actor: oid(user.id), action: "DUPLICATE_ACKNOWLEDGED", summary: `Created after reviewing similar clients ${hits.map((h) => h.doc.clientCode).join(", ")}` });
      }
      await ClientHistory.create(rows, { session, ordered: true });
      if (requirements.length) await insertRequirements({ actor: user, client: c, session }, requirements);
      if (hits.length) await queueReviews(c._id, hits, policy.overridden ? "CREATE_OVERRIDE" : "CREATE_WARNING", user.id, session);
      return c;
    });
  } catch (err) {
    // Two people creating the same client at once: the unique key decided; report it as the block it is.
    if (isDedupeCollision(err)) {
      const again = await findDuplicates(input);
      throw conflictWith("A client with the same email and phone already exists", { code: "DUPLICATE_BLOCK", duplicates: await toMatchDTOs(user, again), canOverride: hasPermission(user.role, "client:manage"), minReasonLength: MIN_OVERRIDE_REASON });
    }
    throw err;
  }

  await recordAudit({ actorId: user.id, action: "client.create", entityType: "Client", entityId: created._id, summary: `Created client ${created.name} (${created.clientCode})` });
  if (policy.overridden) {
    await recordAudit({ actorId: user.id, action: "client.duplicate_override", entityType: "Client", entityId: created._id, summary: `Duplicate block overridden for ${created.clientCode}: ${input.duplicateOverrideReason.slice(0, 200)}` });
  }
  if (projectManager) {
    await notify({
      recipients: [projectManager], actorId: user.id, type: "CLIENT", link: `/clients/${created._id}`, entityType: "Client", entityId: created._id,
      title: "New client onboarding request",
      message: `${user.name} added ${created.name} (${created.clientCode}) and asked you to review it. Check the requirements, then create the project handover.`,
    });
  }
  if (user.role !== "SUPER_ADMIN") await notifyAdmins(user, "New client created", `${user.name} added ${created.name} (${created.clientCode}).`, created);
  else if (owner.toString() !== user.id) await notify({ recipients: [owner], actorId: user.id, type: "CLIENT", title: "You own a new client", message: `${created.name} (${created.clientCode}) was assigned to you.`, link: `/clients/${created._id}`, entityType: "Client", entityId: created._id });

  return getClient(user, created._id.toString());
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export async function getClient(user: CurrentUser, id: string): Promise<ClientDTO> {
  const { client, rights } = await loadVisible(user, id);
  const projectCount = rights.level === "FULL" ? await Project.countDocuments({ clientRef: client._id }) : undefined;
  return toClientDTO(client, rights, { projectCount });
}

export async function listClients(user: CurrentUser, query: z.output<typeof clientListQuerySchema>): Promise<Paginated<ClientDTO>> {
  const visibility = await clientVisibilityFilter(user);
  const level = roleViewLevel(user);
  const and: Filter[] = [visibility];
  if (query.status) and.push({ status: query.status });
  else if (user.role !== "SUPER_ADMIN") and.push({ status: { $ne: "ARCHIVED" } });
  if (query.owner && level !== "MINIMAL") and.push({ salesOwner: oid(query.owner) });
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    // Search only the fields the viewer may see, so search cannot be used to probe hidden data.
    const fields = level === "FULL" ? ["name", "contactPerson", "email", "clientCode"] : level === "LIMITED" ? ["name", "contactPerson", "clientCode"] : ["name", "clientCode"];
    and.push({ $or: fields.map((f) => ({ [f]: rx })) });
  }
  const filter = { $and: and };
  const sort: Record<string, 1 | -1> = query.sort === "name" ? { name: 1 } : { updatedAt: -1 };
  const [rows, total] = await Promise.all([
    Client.find(filter).sort(sort).collation({ locale: "en", strength: 2 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).populate(POPULATE_PEOPLE).lean(),
    Client.countDocuments(filter),
  ]);
  let counts = new Map<string, number>();
  if (level === "FULL" && rows.length) {
    const agg = await Project.aggregate([{ $match: { clientRef: { $in: rows.map((r) => r._id) } } }, { $group: { _id: "$clientRef", n: { $sum: 1 } } }]);
    counts = new Map(agg.map((a) => [a._id.toString(), a.n]));
  }
  const items = rows.map((r: any) => toClientDTO(r, clientRights(user, r), level === "FULL" ? { projectCount: counts.get(r._id.toString()) ?? 0 } : {}));
  return paginate(items, total, query.page, query.pageSize);
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

const RESTRICTED_INPUT_KEYS = ["gst", "billingAddress", "billingSameAsBusiness", "defaultCurrency"] as const;

export async function updateClient(user: CurrentUser, id: string, input: UpdateInput): Promise<ClientDTO> {
  const { client, rights } = await loadVisible(user, id);
  if (!rights.update || !hasPermission(user.role, "client:update")) throw forbidden("You cannot edit this client");

  for (const k of RESTRICTED_INPUT_KEYS) {
    if (input[k] !== undefined && !rights.editRestricted) throw forbidden("Only an Admin or the owning Sales Executive can change GST, billing or currency details");
  }
  if (input.salesOwner !== undefined && (input.salesOwner || null) !== (client.salesOwner?._id?.toString() ?? null)) {
    if (!rights.changeOwner) throw forbidden("Only an Admin can reassign the Sales Executive");
  }
  if (input.status !== undefined && input.status !== client.status) {
    if (!rights.changeStatus) throw forbidden("You cannot change this client's status");
    if ((input.status === "ARCHIVED" || client.status === "ARCHIVED") && !rights.archive) throw forbidden("Only an Admin can archive or restore a client");
  }
  if (input.requirements !== undefined && !rights.editRestricted) throw forbidden("Only the Sales owner or an Admin can change requirements");
  if (input.requirements !== undefined && client.status === "ARCHIVED") throw unprocessable("Reactivate this client before changing requirements.");
  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(client.updatedAt).getTime()) {
    throw new ApiError(409, "This client was changed by someone else. Reload and try again.");
  }

  // Build the next state from the stored one, replacing only what was sent.
  const next: any = { ...client };
  for (const k of ["name", "contactPerson", "contactDesignation", "contactEmail", "contactPhone", "alternatePhone", "email", "phone", "businessCategory", "website", "notes", "defaultCurrency", "billingSameAsBusiness", "status"] as const) {
    if (input[k] !== undefined) next[k] = input[k];
  }
  if (input.email !== undefined) next.email = normalizeEmail(input.email);
  if (input.alternateContact) next.alternateContact = input.alternateContact;
  if (input.businessAddress) next.businessAddress = input.businessAddress;
  if (input.billingAddress) next.billingAddress = input.billingAddress;
  if (input.gst) next.gst = gstFields(input.gst);
  let ownerChange: { from: any; to: any } | null = null;
  if (input.salesOwner !== undefined) {
    const owner = input.salesOwner ? await resolveOwner(user, input.salesOwner) : null;
    if (!owner) throw unprocessable("A client needs a Sales Executive owner", { salesOwner: "Choose an owner" });
    if (owner.toString() !== client.salesOwner?._id?.toString()) {
      ownerChange = { from: client.salesOwner, to: await User.findById(owner).select(USER_REF_FIELDS).lean() };
      next.salesOwner = owner;
    }
  }

  let pmChanged = false;
  if (input.projectManager !== undefined && (input.projectManager || null) !== (client.projectManager?._id?.toString() ?? null)) {
    next.projectManager = await resolveProjectManager(input.projectManager || null);
    pmChanged = !!next.projectManager;
  }

  const changes = diffClient(client, next);
  if (!Object.keys(changes).length && input.requirements === undefined) return toClientDTO(client, rights, { projectCount: await Project.countDocuments({ clientRef: client._id }) });

  // Duplicate policy applies when identity or contact data changed, or a client is being restored.
  const identityChanged = ["name", "email", "phone"].some((f) => f in changes) || ("status" in changes && client.status === "ARCHIVED");
  let policy = { overridden: false, acknowledged: false };
  let hits: FoundHit[] = [];
  if (identityChanged && next.status !== "ARCHIVED") {
    hits = await findDuplicates({ name: next.name, email: next.email, phone: next.phone }, id);
    policy = await enforceDuplicatePolicy(user, hits, input);
  }

  const keyAffected = ["email", "phone", "status"].some((f) => f in changes);
  const set: any = { ...derived(next), updatedBy: oid(user.id) };
  for (const f of Object.keys(input)) {
    if (["name", "contactPerson", "contactDesignation", "contactEmail", "contactPhone", "alternatePhone", "email", "phone", "businessCategory", "website", "notes", "defaultCurrency", "billingSameAsBusiness", "status", "alternateContact", "businessAddress", "billingAddress", "gst", "salesOwner", "projectManager"].includes(f) && f in next) set[f] = next[f];
  }
  const unset: any = {};
  if (keyAffected) {
    const key = next.status === "ARCHIVED" || policy.overridden ? "" : dedupeKey(next.email, next.phone);
    if (key) set.dedupeKey = key;
    else unset.dedupeKey = 1;
  }

  const onlyStatus = Object.keys(changes).every((k) => k === "status");
  const onlyOwner = Object.keys(changes).every((k) => k === "salesOwner");
  const action: ClientHistoryAction = onlyStatus ? "STATUS_CHANGED" : onlyOwner ? "OWNER_CHANGED" : "UPDATED";
  const summary = ownerChange
    ? `Owner changed from ${ownerChange.from?.name ?? "none"} to ${ownerChange.to?.name ?? "none"}`
    : `Changed ${Object.keys(changes).join(", ")}`;

  let requirementAudits: Awaited<ReturnType<typeof syncRequirementsInTransaction>> = [];
  try {
    await withTransaction(async (session) => {
      // Compare-and-set on updatedAt so two simultaneous edits cannot silently overwrite each other.
      const res = await Client.updateOne({ _id: client._id, updatedAt: client.updatedAt }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { session });
      if (!res.matchedCount) throw new ApiError(409, "This client was changed by someone else. Reload and try again.");
      requirementAudits = input.requirements === undefined ? [] : await syncRequirementsInTransaction({ actor: user, client, session }, input.requirements);
      const rows: HistoryRow[] = Object.keys(changes).length ? [{ client: client._id, actor: oid(user.id), action, changes, reason: input.reason, summary }] : [];
      if (policy.overridden) rows.push({ client: client._id, actor: oid(user.id), action: "DUPLICATE_OVERRIDE", reason: input.duplicateOverrideReason, summary: "Admin override of a duplicate block", changes: { duplicateOf: { from: null, to: hits.map((h) => h.doc.clientCode) } } });
      if (rows.length) await ClientHistory.create(rows, { session, ordered: true });
      if (hits.length && next.status !== "ARCHIVED") await queueReviews(client._id, hits, policy.overridden ? "CREATE_OVERRIDE" : "CREATE_WARNING", user.id, session);
    });
  } catch (err) {
    if (isDedupeCollision(err)) {
      throw conflictWith("A client with the same email and phone already exists", { code: "DUPLICATE_BLOCK", duplicates: await toMatchDTOs(user, await findDuplicates({ name: next.name, email: next.email, phone: next.phone }, id)), canOverride: hasPermission(user.role, "client:manage"), minReasonLength: MIN_OVERRIDE_REASON });
    }
    throw err;
  }

  await auditRequirementSync(user, client, requirementAudits);
  if (Object.keys(changes).length) await recordAudit({ actorId: user.id, action: `client.${action.toLowerCase()}`, entityType: "Client", entityId: client._id, summary: `${client.clientCode}: ${summary}`.slice(0, 480), changes: maskedForAudit(changes) });
  if (policy.overridden) await recordAudit({ actorId: user.id, action: "client.duplicate_override", entityType: "Client", entityId: client._id, summary: `Duplicate block overridden for ${client.clientCode}: ${input.duplicateOverrideReason.slice(0, 200)}` });
  if (pmChanged) {
    await notify({ recipients: [next.projectManager], actorId: user.id, type: "CLIENT", title: "New client onboarding request", message: `${user.name} asked you to review ${client.name} (${client.clientCode}).`, link: `/clients/${client._id}`, entityType: "Client", entityId: client._id });
  }
  if (ownerChange) {
    await notify({ recipients: [ownerChange.to?._id, ownerChange.from?._id], actorId: user.id, type: "CLIENT", title: "Client ownership changed", message: `${client.name} (${client.clientCode}) is now owned by ${ownerChange.to?.name ?? "nobody"}.`, link: `/clients/${client._id}`, entityType: "Client", entityId: client._id });
  }
  return getClient(user, id);
}

/* ------------------------------------------------------------------ */
/* History, projects, contacts                                         */
/* ------------------------------------------------------------------ */


export async function getClientHistory(user: CurrentUser, id: string, query: z.output<typeof historyQuerySchema>): Promise<Paginated<ClientHistoryDTO>> {
  const { client, rights } = await loadVisible(user, id);
  requireFull(rights, "this client's history");
  const [rows, total] = await Promise.all([
    ClientHistory.find({ client: client._id }).sort({ createdAt: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).populate("actor", USER_REF_FIELDS).lean(),
    ClientHistory.countDocuments({ client: client._id }),
  ]);
  const items = rows.map((r: any) => ({ id: r._id.toString(), action: r.action, actor: toUserRef(r.actor), summary: r.summary ?? "", reason: r.reason ?? "", changes: r.changes ?? null, createdAt: iso(r.createdAt)! }));
  return paginate(items, total, query.page, query.pageSize);
}

export async function getClientProjects(user: CurrentUser, id: string): Promise<ClientProjectDTO[]> {
  const { client, rights } = await loadVisible(user, id);
  const filter: Filter = { clientRef: client._id };
  // Admin and the owning Sales Executive see every project of the client; others only projects they can see.
  const seesAll = user.role === "SUPER_ADMIN" || (user.role === "SALES_EXECUTIVE" && rights.level === "FULL");
  if (!seesAll) {
    const vis = projectVisibilityFilter(await accessContext(user));
    if (Object.keys(vis).length) filter.$and = [vis];
  }
  const rows: any[] = await Project.find(filter).sort({ createdAt: -1 }).limit(200).populate("manager", USER_REF_FIELDS).select("code name status manager startDate endDate").lean();
  return rows.map((p) => ({ id: p._id.toString(), code: p.code, name: p.name, status: p.status, manager: toUserRef(p.manager), startDate: iso(p.startDate), endDate: iso(p.endDate) }));
}

const toContactDTO = (c: any): ClientContactDTO => ({ id: c._id.toString(), name: c.name, designation: c.designation ?? "", email: c.email ?? "", phone: c.phone ?? "", notes: c.notes ?? "", createdAt: iso(c.createdAt)! });

export async function listContacts(user: CurrentUser, id: string): Promise<ClientContactDTO[]> {
  const { client, rights } = await loadVisible(user, id);
  requireFull(rights, "this client's contacts");
  const rows = await ClientContact.find({ client: client._id, isActive: true }).sort({ createdAt: 1 }).lean();
  return rows.map(toContactDTO);
}


export async function addContact(user: CurrentUser, id: string, input: z.output<typeof clientContactSchema>): Promise<ClientContactDTO> {
  const { client, rights } = await loadVisible(user, id);
  if (!rights.update) throw forbidden("You cannot edit this client");
  const contact = await withTransaction(async (session) => {
    const [c] = await ClientContact.create([{ ...input, client: client._id, createdBy: oid(user.id) }], { session });
    await ClientHistory.create([{ client: client._id, actor: oid(user.id), action: "CONTACT_ADDED", summary: `Added contact ${c.name}`, changes: { contact: { from: null, to: c.name } } }], { session });
    await touch(client._id, user.id, session);
    return c;
  });
  await recordAudit({ actorId: user.id, action: "client.contact_add", entityType: "Client", entityId: client._id, summary: `${client.clientCode}: added contact ${contact.name}` });
  return toContactDTO(contact);
}

export async function updateContact(user: CurrentUser, id: string, contactId: string, input: z.output<typeof updateClientContactSchema>): Promise<ClientContactDTO> {
  const { client, rights } = await loadVisible(user, id);
  if (!rights.update) throw forbidden("You cannot edit this client");
  const existing: any = await ClientContact.findOne({ _id: oid(contactId), client: client._id, isActive: true }).lean();
  if (!existing) throw notFound("Contact not found");
  const before = { name: existing.name, designation: existing.designation, email: existing.email, phone: existing.phone, notes: existing.notes };
  const changes = diffFields(before as Record<string, unknown>, input as Record<string, unknown>, Object.keys(input));
  if (!Object.keys(changes).length) return toContactDTO(existing);
  const updated = await withTransaction(async (session) => {
    const u = await ClientContact.findOneAndUpdate({ _id: existing._id }, { $set: { ...input, updatedBy: oid(user.id) } }, { returnDocument: "after", session });
    await ClientHistory.create([{ client: client._id, actor: oid(user.id), action: "CONTACT_UPDATED", summary: `Updated contact ${existing.name}`, changes }], { session });
    await touch(client._id, user.id, session);
    return u!;
  });
  await recordAudit({ actorId: user.id, action: "client.contact_update", entityType: "Client", entityId: client._id, summary: `${client.clientCode}: updated contact ${existing.name}`, changes });
  return toContactDTO(updated);
}

export async function removeContact(user: CurrentUser, id: string, contactId: string): Promise<void> {
  const { client, rights } = await loadVisible(user, id);
  if (!rights.update) throw forbidden("You cannot edit this client");
  const existing: any = await ClientContact.findOne({ _id: oid(contactId), client: client._id, isActive: true }).lean();
  if (!existing) throw notFound("Contact not found");
  await withTransaction(async (session) => {
    await ClientContact.updateOne({ _id: existing._id }, { $set: { isActive: false, updatedBy: oid(user.id) } }, { session });
    await ClientHistory.create([{ client: client._id, actor: oid(user.id), action: "CONTACT_REMOVED", summary: `Removed contact ${existing.name}`, changes: { contact: { from: existing.name, to: null } } }], { session });
    await touch(client._id, user.id, session);
  });
  await recordAudit({ actorId: user.id, action: "client.contact_remove", entityType: "Client", entityId: client._id, summary: `${client.clientCode}: removed contact ${existing.name}` });
}

/* ------------------------------------------------------------------ */
/* Duplicate review queue (Admin)                                      */
/* ------------------------------------------------------------------ */

function requireManage(user: CurrentUser) {
  if (!hasPermission(user.role, "client:manage")) throw forbidden();
}

export async function listDuplicateReviews(user: CurrentUser, query: z.output<typeof duplicateReviewQuerySchema>): Promise<Paginated<DuplicateReviewDTO>> {
  requireManage(user);
  const filter: Filter = query.status === "ALL" ? {} : { status: query.status };
  const [rows, total] = await Promise.all([
    DuplicateReview.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).populate("clientA", "clientCode name status").populate("clientB", "clientCode name status").populate("resolvedBy", USER_REF_FIELDS).lean(),
    DuplicateReview.countDocuments(filter),
  ]);
  const ref = (c: any) => (c && c.name ? { id: c._id.toString(), clientCode: c.clientCode, name: c.name, status: c.status } : null);
  const items = rows.map((r: any) => ({ id: r._id.toString(), clientA: ref(r.clientA), clientB: ref(r.clientB), source: r.source, score: r.score, reasons: r.reasons ?? [], status: r.status, resolutionNote: r.resolutionNote ?? "", resolvedBy: toUserRef(r.resolvedBy), resolvedAt: iso(r.resolvedAt), createdAt: iso(r.createdAt)! }));
  return paginate(items, total, query.page, query.pageSize);
}

/** Records the Admin's decision. It never merges, archives or relinks anything by itself. */
export async function resolveDuplicateReview(user: CurrentUser, id: string, input: z.output<typeof resolveDuplicateReviewSchema>): Promise<void> {
  requireManage(user);
  const res: any = await DuplicateReview.findOneAndUpdate(
    { _id: oid(id), status: "OPEN" },
    { $set: { status: input.decision, resolutionNote: input.note, resolvedBy: oid(user.id), resolvedAt: new Date() } },
    { returnDocument: "after" }
  ).lean();
  if (!res) throw new ApiError(409, "This review was already resolved or does not exist");
  await recordAudit({ actorId: user.id, action: "client.duplicate_review", entityType: "Client", entityId: res.clientA, summary: `Duplicate review ${input.decision.toLowerCase().replace("_", " ")}: ${input.note.slice(0, 200)}` });
}
