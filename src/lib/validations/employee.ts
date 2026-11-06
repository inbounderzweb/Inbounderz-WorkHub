import { z } from "zod";
import { ROLE_KEYS, USER_STATUSES } from "@/lib/constants";
import { optionalDateString, optionalObjectId, passwordSchema } from "./common";

const phoneRegex = /^[+()\-\s\d]{6,30}$/;

/** Field definitions without defaults, so partial (PATCH) parsing never injects values. */
const employeeFields = {
  name: z.string().trim().min(2, "Name is too short").max(120),
  email: z.email("Enter a valid email").trim().toLowerCase().max(254),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v === "" || phoneRegex.test(v), "Enter a valid phone number"),
  employeeId: z
    .string()
    .trim()
    .toUpperCase()
    .max(30)
    .refine((v) => v === "" || /^[A-Z0-9\-_/]+$/.test(v), "Letters, numbers, - _ / only"),
  designation: z.string().trim().max(120),
  role: z.enum(ROLE_KEYS, "Select a role"),
  department: optionalObjectId,
  reportingManager: optionalObjectId,
  joiningDate: optionalDateString,
  status: z.enum(USER_STATUSES),
};

export const employeeBaseSchema = z.object({
  ...employeeFields,
  phone: employeeFields.phone.optional().default(""),
  employeeId: employeeFields.employeeId.optional().default(""),
  designation: employeeFields.designation.optional().default(""),
  status: employeeFields.status.default("ACTIVE"),
});

export const createEmployeeSchema = employeeBaseSchema.extend({
  password: passwordSchema,
});
export type CreateEmployeeInput = z.input<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z.object(employeeFields).partial();
export type UpdateEmployeeInput = z.input<typeof updateEmployeeSchema>;

export const employeeStatusSchema = z.object({
  status: z.enum(USER_STATUSES),
});

export const adminResetPasswordSchema = z.object({
  password: passwordSchema,
});

export const employeeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(100).optional().default(""),
  department: z.string().optional().default(""),
  role: z.union([z.literal(""), z.enum(ROLE_KEYS)]).optional().default(""),
  status: z.union([z.literal(""), z.enum(USER_STATUSES)]).optional().default(""),
  sort: z
    .enum(["name", "-name", "createdAt", "-createdAt", "joiningDate", "-joiningDate", "employeeId", "-employeeId"])
    .optional()
    .default("-createdAt"),
  /** Lightweight list for pickers: id, name, email, role, department only. */
  minimal: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false"), z.literal("")])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});
