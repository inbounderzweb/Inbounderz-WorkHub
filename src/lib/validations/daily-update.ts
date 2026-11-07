import { z } from "zod";
import { DAILY_UPDATE_STATUSES } from "@/lib/constants";
import { objectId, optionalObjectId } from "./common";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const hours = z.coerce
  .number({ message: "Enter the hours spent" })
  .min(0.25, "At least 15 minutes (0.25 h)")
  .max(24, "At most 24 hours")
  .refine((v) => Math.round(v * 4) === v * 4, "Use quarter hours (e.g. 1.5, 2.25)");

/** Field definitions without defaults so PATCH parsing never injects values. */
const fields = {
  workCompleted: z.string().trim().min(5, "Describe the work you completed").max(5000),
  pendingWork: z.string().trim().max(3000),
  blockers: z.string().trim().max(2000),
  hoursSpent: hours,
};

export const createDailyUpdateSchema = z.object({
  ...fields,
  date: dateString,
  project: objectId,
  task: optionalObjectId,
  pendingWork: fields.pendingWork.optional().default(""),
  blockers: fields.blockers.optional().default(""),
});
export type CreateDailyUpdateInput = z.input<typeof createDailyUpdateSchema>;

export const updateDailyUpdateSchema = z.object(fields).partial();

export const reviewDailyUpdateSchema = z
  .object({
    decision: z.enum(["APPROVE", "REQUEST_CHANGES"]),
    comment: z.string().trim().max(2000).optional().default(""),
  })
  .refine((v) => v.decision === "APPROVE" || v.comment.length >= 3, { path: ["comment"], message: "Explain what needs to change" });

export const dailyUpdateListQuerySchema = z.object({
  scope: z.enum(["mine", "team"]).optional().default("mine"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  from: z.union([z.literal(""), dateString]).optional().default(""),
  to: z.union([z.literal(""), dateString]).optional().default(""),
  user: z.string().optional().default(""),
  project: z.string().optional().default(""),
  department: z.string().optional().default(""),
  status: z.union([z.literal(""), z.enum(DAILY_UPDATE_STATUSES)]).optional().default(""),
  q: z.string().trim().max(100).optional().default(""),
});

export const dailySummaryQuerySchema = z.object({
  view: z.enum(["day", "week"]).optional().default("day"),
  date: z.union([z.literal(""), dateString]).optional().default(""),
  scope: z.enum(["mine", "team"]).optional().default("team"),
  department: z.string().optional().default(""),
  project: z.string().optional().default(""),
});
