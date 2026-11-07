import { z } from "zod";
import { APPROVAL_MODES, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/constants";
import { objectId, optionalDateString, optionalObjectId } from "./common";

const hours = z
  .union([z.number(), z.null(), z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 10000), "Enter hours between 0 and 10,000");

const datesInOrder = (v: { startDate?: string | null; dueDate?: string | null }) =>
  !v.startDate || !v.dueDate || v.dueDate >= v.startDate;
const datesMessage = { path: ["dueDate"], message: "Due date must be on or after the start date" };

/** Field definitions without defaults, so PATCH parsing never injects values. */
const taskFields = {
  title: z.string().trim().min(3, "Title is too short").max(200),
  description: z.string().trim().max(10000),
  priority: z.enum(TASK_PRIORITIES),
  startDate: optionalDateString,
  dueDate: optionalDateString,
  estimatedHours: hours,
  actualHours: hours,
  milestone: optionalObjectId,
  collaborators: z.array(objectId).max(30),
  dependencies: z.array(objectId).max(30),
  approvalRequired: z.boolean(),
  approvalMode: z.enum(APPROVAL_MODES),
};

export const createTaskSchema = z
  .object({
    ...taskFields,
    project: objectId,
    department: objectId,
    owner: objectId,
    parentTask: optionalObjectId,
    status: z.enum(["BACKLOG", "TODO"]).default("TODO"),
    description: taskFields.description.optional().default(""),
    priority: taskFields.priority.default("MEDIUM"),
    estimatedHours: hours.optional().default(null),
    collaborators: taskFields.collaborators.optional().default([]),
    dependencies: taskFields.dependencies.optional().default([]),
    checklist: z.array(z.string().trim().min(1).max(300)).max(50).optional().default([]),
    approvalRequired: z.boolean().default(true),
    approvalMode: z.enum(APPROVAL_MODES).optional(),
  })
  .omit({ actualHours: true })
  .refine((v) => !v.collaborators.includes(v.owner), {
    path: ["collaborators"],
    message: "The owner can't also be a collaborator",
  })
  .refine(datesInOrder, datesMessage);
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z.object(taskFields).partial().refine(datesInOrder, datesMessage);

export const assignTaskSchema = z.object({ department: objectId, owner: objectId });
export const taskStatusSchema = z.object({
  status: z.enum(TASK_STATUSES),
  note: z.string().trim().max(2000).optional().default(""),
});
export const taskReviewSchema = z
  .object({
    decision: z.enum(["APPROVE", "REQUEST_CHANGES"]),
    comment: z.string().trim().max(5000).optional().default(""),
  })
  .refine((v) => v.decision === "APPROVE" || v.comment.length >= 3, {
    path: ["comment"],
    message: "Explain what needs to change",
  });
export const taskBlockerSchema = z
  .object({ action: z.enum(["REPORT", "CLEAR"]), reason: z.string().trim().max(2000).optional().default("") })
  .refine((v) => v.action === "CLEAR" || v.reason.length >= 3, { path: ["reason"], message: "Describe the blocker" });
export const taskCommentSchema = z.object({ body: z.string().trim().min(1, "Write a comment").max(5000) });
export const checklistAddSchema = z.object({ text: z.string().trim().min(1, "Enter an item").max(300) });
export const checklistUpdateSchema = z.object({
  text: z.string().trim().min(1).max(300).optional(),
  done: z.boolean().optional(),
});

const csvStatuses = z
  .string()
  .optional()
  .default("")
  .transform((v) => v.split(",").filter(Boolean))
  .pipe(z.array(z.enum(TASK_STATUSES)));

export const taskListQuerySchema = z.object({
  scope: z.enum(["mine", "all"]).optional().default("mine"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(300).default(20),
  q: z.string().trim().max(100).optional().default(""),
  project: z.string().optional().default(""),
  department: z.string().optional().default(""),
  owner: z.string().optional().default(""),
  status: csvStatuses,
  priority: z.union([z.literal(""), z.enum(TASK_PRIORITIES)]).optional().default(""),
  due: z.enum(["", "overdue", "today", "week", "none"]).optional().default(""),
  from: optionalDateString,
  to: optionalDateString,
  topLevel: z
    .enum(["", "1", "true"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
  sort: z.enum(["dueDate", "-dueDate", "-updatedAt", "-createdAt", "priority", "title"]).optional().default("dueDate"),
  /** "internal_ticket" = internal requests only, "project" = project tasks only. */
  source: z.enum(["", "project", "internal_ticket"]).optional().default(""),
});
