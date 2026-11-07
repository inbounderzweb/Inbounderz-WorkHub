import { z } from "zod";
import { TASK_PRIORITIES, TICKET_STATUSES } from "@/lib/constants";
import { objectId, optionalObjectId } from "./common";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

/** http(s) only: links are rendered as anchors, so `javascript:` etc. must never get through. */
const referenceLink = z
  .string()
  .trim()
  .max(2000, "Link is too long")
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "Enter a full link starting with https://");

export const createTicketSchema = z.object({
  title: z.string().trim().min(5, "Give the request a short, specific title").max(200),
  description: z.string().trim().min(10, "Describe what you need (at least 10 characters)").max(10000),
  targetDepartment: objectId,
  project: optionalObjectId,
  category: objectId,
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  dueDate: dateString,
  referenceLinks: z.array(referenceLink).max(10, "Add at most 10 links").optional().default([]),
});
export type CreateTicketInput = z.input<typeof createTicketSchema>;

/** Manager edits (no defaults, so PATCH never injects values). */
export const updateTicketSchema = z
  .object({
    priority: z.enum(TASK_PRIORITIES),
    dueDate: dateString,
    category: objectId,
    targetDepartment: objectId,
  })
  .partial();

export const assignTicketSchema = z.object({
  department: objectId,
  employee: objectId,
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: dateString.optional(),
  note: z.string().trim().max(2000).optional().default(""),
});

const message = (label: string) => z.string().trim().min(3, label).max(5000);

export const ticketActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START_REVIEW"), note: z.string().trim().max(2000).optional().default("") }),
  z.object({ action: z.literal("REJECT"), reason: message("Explain why the request is rejected") }),
  z.object({ action: z.literal("REQUEST_INFO"), message: message("Say what information you need") }),
  z.object({ action: z.literal("PROVIDE_INFO"), message: message("Write your response") }),
  z.object({ action: z.literal("START_WORK") }),
  z.object({ action: z.literal("RESOLVE"), note: z.string().trim().max(5000).optional().default("") }),
  z.object({ action: z.literal("ACCEPT"), note: z.string().trim().max(5000).optional().default("") }),
  z.object({ action: z.literal("REQUEST_CHANGES"), feedback: message("Describe the changes you need") }),
  z.object({ action: z.literal("REOPEN"), reason: message("Explain why the ticket is being reopened") }),
]);
export type TicketActionInput = z.output<typeof ticketActionSchema>;

export const ticketCommentSchema = z.object({ body: z.string().trim().min(1, "Write a comment").max(5000) });

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .default("")
    .transform((v) => v.split(",").filter(Boolean))
    .pipe(z.array(z.enum(values)));

export const ticketListQuerySchema = z.object({
  scope: z.enum(["mine", "manage"]).optional().default("mine"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional().default(""),
  status: csv(TICKET_STATUSES),
  department: z.string().optional().default(""),
  requester: z.string().optional().default(""),
  assignee: z.string().optional().default(""),
  priority: z.union([z.literal(""), z.enum(TASK_PRIORITIES)]).optional().default(""),
  due: z.enum(["", "overdue", "today", "week", "none"]).optional().default(""),
  from: z.union([z.literal(""), dateString]).optional().default(""),
  to: z.union([z.literal(""), dateString]).optional().default(""),
  sort: z.enum(["-createdAt", "createdAt", "dueDate", "-dueDate", "priority", "-updatedAt"]).optional().default("-createdAt"),
});

export const ticketCategorySchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(80),
  description: z.string().trim().max(300).optional().default(""),
  defaultDepartment: optionalObjectId,
  isActive: z.boolean().optional().default(true),
});
export type TicketCategoryInput = z.input<typeof ticketCategorySchema>;

export const updateTicketCategorySchema = z
  .object({
    name: z.string().trim().min(2, "Name is too short").max(80),
    description: z.string().trim().max(300),
    defaultDepartment: optionalObjectId,
    isActive: z.boolean(),
    order: z.number().int().min(0).max(1000),
  })
  .partial();
