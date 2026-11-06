import { z } from "zod";
import { DEPARTMENT_STATUSES } from "@/lib/constants";
import { objectId, optionalObjectId } from "./common";

/** Field definitions without defaults, so partial (PATCH) parsing never injects values. */
const departmentFields = {
  name: z.string().trim().min(2, "Name is too short").max(100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "Use 2–12 characters")
    .max(12, "Use 2–12 characters")
    .regex(/^[A-Z0-9-]+$/, "Letters, numbers and dashes only"),
  description: z.string().trim().max(1000),
  head: optionalObjectId,
  teamLeaders: z.array(objectId).max(50),
  status: z.enum(DEPARTMENT_STATUSES),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Invalid color"),
};

export const departmentBaseSchema = z.object({
  ...departmentFields,
  description: departmentFields.description.optional().default(""),
  teamLeaders: departmentFields.teamLeaders.optional().default([]),
  status: departmentFields.status.default("ACTIVE"),
  color: departmentFields.color.optional().default("#16a34a"),
});

export const createDepartmentSchema = departmentBaseSchema;
export type CreateDepartmentInput = z.input<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object(departmentFields).partial();

export const departmentMembersSchema = z.object({
  add: z.array(objectId).max(200).optional().default([]),
  remove: z.array(objectId).max(200).optional().default([]),
});

export const departmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
  q: z.string().trim().max(100).optional().default(""),
  status: z.union([z.literal(""), z.enum(DEPARTMENT_STATUSES)]).optional().default(""),
  all: z
    .union([z.literal("1"), z.literal("true"), z.literal("")])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});
