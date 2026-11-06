import { z } from "zod";
import {
  APPROVAL_MODES,
  MILESTONE_STATUSES,
  PROJECT_MEMBER_ROLES,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
} from "@/lib/constants";
import { objectId, optionalDateString, optionalObjectId } from "./common";

const ASSIGNABLE_PROJECT_ROLES = PROJECT_MEMBER_ROLES.filter((r) => r !== "MANAGER") as [
  "LEAD",
  "MEMBER",
  "REVIEWER",
  "OBSERVER",
];

export const projectMemberInputSchema = z.object({
  user: objectId,
  department: objectId,
  projectRole: z.enum(ASSIGNABLE_PROJECT_ROLES).default("MEMBER"),
});

const budgetSchema = z
  .union([z.number(), z.null(), z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 1e12), "Enter a valid amount");

/** Field definitions without defaults, so PATCH parsing never injects values. */
const projectFields = {
  name: z.string().trim().min(3, "Name is too short").max(150),
  client: z.string().trim().max(150),
  description: z.string().trim().max(5000),
  notes: z.string().trim().max(10000),
  manager: optionalObjectId,
  startDate: optionalDateString,
  endDate: optionalDateString,
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(PROJECT_STATUSES),
  budget: budgetSchema,
  approvalMode: z.enum(APPROVAL_MODES),
  departments: z.array(objectId).min(1, "Select at least one department").max(30),
};

const datesInOrder = (v: { startDate?: string | null; endDate?: string | null }) =>
  !v.startDate || !v.endDate || v.endDate >= v.startDate;
const datesMessage = { path: ["endDate"], message: "Deadline must be on or after the start date" };

export const createProjectSchema = z
  .object({
    ...projectFields,
    client: projectFields.client.optional().default(""),
    description: projectFields.description.optional().default(""),
    notes: projectFields.notes.optional().default(""),
    priority: projectFields.priority.default("MEDIUM"),
    status: projectFields.status.default("PLANNING"),
    budget: budgetSchema.optional().default(null),
    approvalMode: projectFields.approvalMode.default("DEPARTMENT"),
    members: z.array(projectMemberInputSchema).max(300).optional().default([]),
  })
  .refine(datesInOrder, datesMessage);
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z.object(projectFields).partial().refine(datesInOrder, datesMessage);

export const projectMembersSchema = z.object({
  add: z.array(projectMemberInputSchema).max(300).optional().default([]),
  remove: z.array(objectId).max(300).optional().default([]),
  update: z
    .array(z.object({ user: objectId, projectRole: z.enum(ASSIGNABLE_PROJECT_ROLES) }))
    .max(300)
    .optional()
    .default([]),
});

export const projectArchiveSchema = z.object({ archived: z.boolean() });

export const projectListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(100).optional().default(""),
  status: z.union([z.literal(""), z.enum(PROJECT_STATUSES)]).optional().default(""),
  priority: z.union([z.literal(""), z.enum(TASK_PRIORITIES)]).optional().default(""),
  department: z.string().optional().default(""),
  archived: z.enum(["", "include", "only"]).optional().default(""),
  sort: z.enum(["-createdAt", "createdAt", "name", "endDate", "-endDate", "-progress"]).optional().default("-createdAt"),
  minimal: z
    .enum(["", "1", "true"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

const milestoneFields = {
  title: z.string().trim().min(2, "Title is too short").max(150),
  description: z.string().trim().max(2000),
  dueDate: optionalDateString,
  status: z.enum(MILESTONE_STATUSES),
};
export const createMilestoneSchema = z.object({
  ...milestoneFields,
  description: milestoneFields.description.optional().default(""),
  status: milestoneFields.status.default("PENDING"),
});
export type CreateMilestoneInput = z.input<typeof createMilestoneSchema>;
export const updateMilestoneSchema = z.object(milestoneFields).partial();
