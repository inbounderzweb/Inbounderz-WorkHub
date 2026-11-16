import { z } from "zod";
import { TASK_PRIORITIES, TICKET_STATUSES } from "@/lib/constants";
import { objectId, optionalDateString, optionalObjectId } from "./common";

const link = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https?:\/\//i.test(v), "Links must start with http:// or https://");

const ticketFields = {
  title: z.string().trim().min(3, "Title is too short").max(200),
  description: z.string().trim().min(1, "Describe what you need").max(10000),
  category: z.string().trim().max(60),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: optionalDateString,
  suggestedEmployee: optionalObjectId,
  projectManager: optionalObjectId,
  referenceLinks: z.array(link).max(10),
};

export const createTicketSchema = z.object({
  ...ticketFields,
  category: ticketFields.category.optional().default("Other"),
  priority: ticketFields.priority.default("MEDIUM"),
  referenceLinks: ticketFields.referenceLinks.optional().default([]),
  targetDepartment: objectId,
  /** Other departments to involve as well (optional). */
  additionalDepartments: z.array(objectId).max(5).optional().default([]),
  /** Save without submitting; the ticket stays private to the requester. */
  draft: z.boolean().optional().default(false),
});
export type CreateTicketInput = z.input<typeof createTicketSchema>;

export const updateTicketSchema = z.object({ ...ticketFields, targetDepartment: objectId, additionalDepartments: z.array(objectId).max(5) }).partial();

const message = z.string().trim().min(1, "A message is required").max(2000);
const assignFields = {
  assignee: objectId,
  estimatedHours: z.number().min(0).max(1000).nullable().optional(),
  expectedCompletion: optionalDateString,
  /** Must be set to assign someone who is already Fully Occupied. */
  overrideCapacity: z.boolean().optional().default(false),
  /** Independent reviewer of the finished work. Optional: without one the requester reviews (legacy). */
  reviewer: optionalObjectId,
};

/** Every state change goes through one validated action endpoint. */
export const ticketActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit") }),
  z.object({ action: z.literal("start_review") }),
  z.object({ action: z.literal("request_info"), message }),
  z.object({ action: z.literal("respond"), message }),
  z.object({ action: z.literal("reject"), message }),
  z.object({
    action: z.literal("approve"),
    /** Leave empty when nobody is available: the ticket stays in the Unassigned queue. */
    assignee: optionalObjectId,
    reviewer: assignFields.reviewer,
    estimatedHours: assignFields.estimatedHours,
    expectedCompletion: assignFields.expectedCompletion,
    overrideCapacity: assignFields.overrideCapacity,
    message: z.string().trim().max(2000).optional().default(""),
  }),
  z.object({ action: z.literal("assign"), ...assignFields, message: z.string().trim().max(2000).optional().default("") }),
  z.object({ action: z.literal("reassign"), ...assignFields, message }),
  /** Name or change the reviewer. A reason is required once the work is already waiting for review. */
  z.object({ action: z.literal("set_reviewer"), reviewer: objectId, message: z.string().trim().max(2000).optional().default("") }),
  z.object({ action: z.literal("set_dates"), estimatedHours: assignFields.estimatedHours, expectedCompletion: assignFields.expectedCompletion }),
  z.object({ action: z.literal("set_priority"), priority: z.enum(TASK_PRIORITIES), message: z.string().trim().max(2000).optional().default("") }),
  z.object({ action: z.literal("start"), pausePrevious: z.boolean().optional() }),
  z.object({ action: z.literal("hold"), message }),
  z.object({ action: z.literal("resume"), pausePrevious: z.boolean().optional() }),
  /** Work timer while In Progress. The pause note is optional. */
  z.object({ action: z.literal("start_timer"), pausePrevious: z.boolean().optional() }),
  z.object({ action: z.literal("pause_timer"), message: z.string().trim().max(500).optional().default("") }),
  z.object({ action: z.literal("submit_work"), message: z.string().trim().max(2000).optional().default("") }),
  z.object({ action: z.literal("accept"), message: z.string().trim().max(2000).optional().default("") }),
  z.object({ action: z.literal("request_changes"), message }),
  z.object({ action: z.literal("cancel"), message: z.string().trim().max(2000).optional().default("") }),
  z.object({ action: z.literal("escalate"), message }),
  z.object({ action: z.literal("comment"), message }),
]);
export type TicketActionInput = z.output<typeof ticketActionSchema>;

export const TICKET_SCOPES = ["raised", "assigned", "employee", "queue", "department", "all"] as const;
export const ticketListQuerySchema = z.object({
  scope: z.enum(TICKET_SCOPES).default("raised"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(100).optional().default(""),
  status: z.union([z.literal(""), z.enum(TICKET_STATUSES)]).optional().default(""),
  priority: z.union([z.literal(""), z.enum(TASK_PRIORITIES)]).optional().default(""),
  department: z.string().optional().default(""),
  /** Whose queue to show (scope "employee"). */
  assignee: z.string().optional().default(""),
  overdue: z.enum(["", "1"]).optional().default(""),
  /** "open" = still in play, "closed" = completed / rejected / cancelled. Empty = both. */
  view: z.enum(["", "open", "closed"]).optional().default(""),
  sort: z.enum(["manager", "-createdAt", "createdAt", "dueDate", "priority", "-updatedAt"]).optional().default("-createdAt"),
});

/** Move a ticket to an absolute 1-based place in its assignee's queue. */
export const reorderTicketSchema = z.object({
  position: z.number().int().min(1).max(10_000),
});

/** Review queue: tickets whose deliverable is (or was) under review. */
export const REVIEW_QUEUE_FILTERS = ["all", "pending", "changes", "approved", "overdue"] as const;
export const reviewQueueQuerySchema = z.object({
  filter: z.enum(REVIEW_QUEUE_FILTERS).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(100).optional().default(""),
});
