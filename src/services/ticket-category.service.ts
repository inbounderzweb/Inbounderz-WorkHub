import "server-only";
import type { z } from "zod";
import type { CurrentUser } from "@/lib/auth/current-user";
import { conflict, forbidden, notFound, unprocessable } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import type { ticketCategorySchema, updateTicketCategorySchema } from "@/lib/validations/ticket";
import { Department, Ticket, TicketCategory } from "@/models";
import type { TicketCategoryDTO } from "@/types/dto";
import { DEPT_REF_FIELDS, toDepartmentRef } from "./mappers";
import { ensureDefaultTicketCategories } from "./ticket-category-defaults";

export { ensureDefaultTicketCategories };
import { oid } from "./scope";

/* eslint-disable @typescript-eslint/no-explicit-any */

function toDTO(c: any, counts?: Map<string, number>): TicketCategoryDTO {
  return {
    id: c._id.toString(),
    name: c.name,
    description: c.description ?? "",
    defaultDepartment: toDepartmentRef(c.defaultDepartment),
    isActive: c.isActive !== false,
    order: c.order ?? 0,
    ...(counts ? { ticketCount: counts.get(c._id.toString()) ?? 0 } : {}),
  };
}

/** Active categories for the create form; `all` (Super Admin settings) includes inactive ones and usage counts. */
export async function listTicketCategories(user: CurrentUser, all: boolean): Promise<TicketCategoryDTO[]> {
  await ensureDefaultTicketCategories();
  const includeInactive = all && hasPermission(user.role, "settings:manage");
  const rows = await TicketCategory.find(includeInactive ? {} : { isActive: true })
    .sort({ order: 1, name: 1 })
    .populate("defaultDepartment", DEPT_REF_FIELDS)
    .lean();
  if (!includeInactive) return rows.map((r) => toDTO(r));
  const usage = await Ticket.aggregate<{ _id: any; n: number }>([{ $group: { _id: "$category", n: { $sum: 1 } } }]);
  return rows.map((r) => toDTO(r, new Map(usage.map((u) => [String(u._id), u.n]))));
}

async function validateDepartment(id: string | null | undefined) {
  if (!id) return null;
  const d = await Department.findById(id).select("status").lean();
  if (!d) throw unprocessable("Department not found", { defaultDepartment: "Department not found" });
  return d._id;
}

export async function createTicketCategory(user: CurrentUser, input: z.output<typeof ticketCategorySchema>): Promise<TicketCategoryDTO> {
  if (!hasPermission(user.role, "settings:manage")) throw forbidden();
  await ensureDefaultTicketCategories();
  const exists = await TicketCategory.findOne({ name: input.name }).collation({ locale: "en", strength: 2 }).lean();
  if (exists) throw conflict("A category with this name already exists", { name: "Already exists" });
  const last = await TicketCategory.findOne().sort({ order: -1 }).select("order").lean();
  const doc = await TicketCategory.create({
    name: input.name,
    description: input.description,
    defaultDepartment: await validateDepartment(input.defaultDepartment),
    isActive: input.isActive,
    order: (last?.order ?? 0) + 1,
    createdBy: oid(user.id),
  });
  await recordAudit({ actorId: user.id, action: "ticket_category.create", entityType: "TicketCategory", entityId: doc._id, summary: `Created ticket category ${doc.name}` });
  const populated = await TicketCategory.findById(doc._id).populate("defaultDepartment", DEPT_REF_FIELDS).lean();
  return toDTO(populated);
}

export async function updateTicketCategory(
  user: CurrentUser,
  id: string,
  input: z.output<typeof updateTicketCategorySchema>
): Promise<TicketCategoryDTO> {
  if (!hasPermission(user.role, "settings:manage")) throw forbidden();
  const current = await TicketCategory.findById(id).lean();
  if (!current) throw notFound("Category not found");
  const set: Record<string, unknown> = {};
  if (input.name !== undefined && input.name !== current.name) {
    const clash = await TicketCategory.findOne({ name: input.name, _id: { $ne: current._id } }).collation({ locale: "en", strength: 2 }).lean();
    if (clash) throw conflict("A category with this name already exists", { name: "Already exists" });
    set.name = input.name;
  }
  if (input.description !== undefined) set.description = input.description;
  if (input.defaultDepartment !== undefined) set.defaultDepartment = await validateDepartment(input.defaultDepartment);
  if (input.order !== undefined) set.order = input.order;
  if (input.isActive !== undefined) {
    if (!input.isActive && current.isActive) {
      const active = await TicketCategory.countDocuments({ isActive: true });
      if (active <= 1) throw unprocessable("Keep at least one active category so employees can raise tickets");
    }
    set.isActive = input.isActive;
  }
  if (Object.keys(set).length) {
    await TicketCategory.updateOne({ _id: current._id }, { $set: set }, { runValidators: true });
    await recordAudit({
      actorId: user.id,
      action: "ticket_category.update",
      entityType: "TicketCategory",
      entityId: current._id,
      summary: `Updated ticket category ${set.name ?? current.name}`,
    });
  }
  const populated = await TicketCategory.findById(current._id).populate("defaultDepartment", DEPT_REF_FIELDS).lean();
  return toDTO(populated);
}
