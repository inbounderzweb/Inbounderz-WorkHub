import { z } from "zod";

const category = z.enum(["", "NONE", "LOW", "MODERATE", "HIGH", "OVERLOADED"]);

export const workloadQuerySchema = z.object({
  period: z.enum(["week", "month"]).default("week"),
  department: z.string().optional().default(""),
  project: z.string().optional().default(""),
});

export const workloadEmployeesQuerySchema = workloadQuerySchema.extend({
  status: category.optional().default(""),
  q: z.string().trim().max(100).optional().default(""),
  sort: z.enum(["highest", "lowest", "available", "overdue"]).default("highest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export const workloadSettingsSchema = z
  .object({
    hoursPerDay: z.number().min(1).max(24),
    daysPerWeek: z.number().min(1).max(7),
    moderateFrom: z.number().min(1).max(500),
    highFrom: z.number().min(1).max(500),
    overloadedAbove: z.number().min(1).max(500),
    onHoldWeight: z.number().min(0).max(1),
    reviewWeight: z.number().min(0).max(1),
    fallbackHours: z.number().min(0).max(200),
  })
  .refine((v) => v.moderateFrom < v.highFrom && v.highFrom <= v.overloadedAbove, {
    message: "Thresholds must increase: moderate < high ≤ overloaded",
    path: ["highFrom"],
  });
