import { z } from "zod";

export const objectIdRegex = /^[a-f\d]{24}$/i;

export const objectId = z.string().regex(objectIdRegex, "Invalid id");
/** Optional reference coming from a <select>: "" / null means "none". */
export const optionalObjectId = z
  .union([z.literal(""), z.null(), objectId])
  .optional();

/** yyyy-MM-dd from <input type="date">, or empty. */
export const optionalDateString = z
  .union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")])
  .optional();

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Use at most 128 characters")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/\d/, "Include a number");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(100).optional().default(""),
});
